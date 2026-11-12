#!/bin/sh
# Provision the private Node.js/SQLite leaderboard behind Nginx.
# Called by deploy/vps.sh after an eligible Node runtime is available.
set -eu
SRC=$1
NODE=$2
DOMAIN=$3
[ -n "$DOMAIN" ] || DOMAIN='*'
APP_DIR='/opt/rust-signal/leaderboard'
DATA_DIR='/var/lib/rust-signal/leaderboard'
SYSTEMD_UNIT='/etc/systemd/system/rust-signal-leaderboard.service'
NGINX_SNIPPET='/etc/nginx/snippets/rust-signal-api.conf'
[ -f "$SRC" ] || { echo 'Missing server/leaderboard.mjs' >&2; exit 1; }
[ -x "$NODE" ] || { echo 'Node binary missing' >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo 'Online leaderboard requires systemd.' >&2; exit 1; }
command -v useradd >/dev/null 2>&1 || { echo 'useradd not found.' >&2; exit 1; }

# Never reuse service/snippet/source paths belonging to another application.
if [ -e "$SYSTEMD_UNIT" ] && ! grep -Fq 'Description=Rust Signal global leaderboard API (loopback only)' "$SYSTEMD_UNIT"; then
  echo "Unmanaged systemd service exists: $SYSTEMD_UNIT. Refusing to overwrite." >&2
  exit 1
fi
if [ -e "$NGINX_SNIPPET" ] && ! grep -Fq '# Rust Signal global scoreboard.' "$NGINX_SNIPPET"; then
  echo "Unmanaged Nginx snippet exists: $NGINX_SNIPPET. Refusing to overwrite." >&2
  exit 1
fi
if [ -e "$APP_DIR/leaderboard.mjs" ] && ! grep -Fq 'Rust Signal global leaderboard on ' "$APP_DIR/leaderboard.mjs"; then
  echo "Unmanaged API source exists: $APP_DIR/leaderboard.mjs. Refusing to overwrite." >&2
  exit 1
fi
for owned_path in "$APP_DIR" "$DATA_DIR"; do
  [ ! -L "$owned_path" ] || { echo "Refusing symlinked API directory: $owned_path" >&2; exit 1; }
done
if id rustsignal >/dev/null 2>&1; then
  account=$(getent passwd rustsignal || :)
  case "$account" in
    *:"$DATA_DIR":*/nologin|*:"$DATA_DIR":*/false) ;;
    *) echo 'Existing rustsignal account is not a restricted service account.' >&2; exit 1 ;;
  esac
else
  useradd --system --no-create-home --home-dir "$DATA_DIR" --shell /usr/sbin/nologin rustsignal
fi
mkdir -p "$APP_DIR" "$DATA_DIR" "$(dirname "$NGINX_SNIPPET")"
chown rustsignal:rustsignal "$DATA_DIR"
chmod 700 "$DATA_DIR"
install -m 644 "$SRC" "$APP_DIR/leaderboard.mjs"
chown root:root "$APP_DIR/leaderboard.mjs"

cat >"$SYSTEMD_UNIT" <<EOF
[Unit]
Description=Rust Signal global leaderboard API (loopback only)
After=network.target

[Service]
Type=simple
User=rustsignal
Group=rustsignal
WorkingDirectory=$APP_DIR
ExecStart=$NODE $APP_DIR/leaderboard.mjs
Environment=RS_LEADERBOARD_DB=$DATA_DIR/leaderboard.sqlite
Environment=RS_PUBLIC_HOST=$DOMAIN
Environment=RS_LEADERBOARD_PORT=32741
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateDevices=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
SystemCallArchitectures=native
MemoryMax=192M
TasksMax=64
LimitNOFILE=512
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
cat >"$NGINX_SNIPPET" <<'EOF'
# Rust Signal global scoreboard. Include inside each game server { } vhost.
location ^~ /api/ {
    client_max_body_size 4k;
    proxy_pass http://127.0.0.1:32741;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 3s;
    proxy_read_timeout 12s;
    add_header Cache-Control "no-store" always;
}
EOF
systemctl daemon-reload
systemctl enable rust-signal-leaderboard.service >/dev/null
systemctl restart rust-signal-leaderboard.service
tries=0
until "$NODE" -e "fetch('http://127.0.0.1:32741/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  tries=$((tries+1))
  if [ "$tries" -ge 20 ]; then
    systemctl status rust-signal-leaderboard.service --no-pager >&2 || :
    echo 'Leaderboard API failed health check' >&2
    exit 1
  fi
  sleep 1
done
echo '[Rust Signal] Online leaderboard API healthy on 127.0.0.1:32741'

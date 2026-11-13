#!/bin/sh
# FreeBSD rc.d service and private SQLite API for Rust Signal.
set -eu
[ "$#" -eq 3 ] || { echo 'Usage: SOURCE NODE DOMAIN' >&2; exit 1; }
[ "$(uname -s)" = FreeBSD ] && [ "$(id -u)" -eq 0 ] ||
  { echo 'FreeBSD root required' >&2; exit 1; }
SRC=$1
NODE=$2
DOMAIN=$3
[ -n "$DOMAIN" ] || DOMAIN='*'
case "$DOMAIN" in
  '*') ;;
  *[!a-zA-Z0-9.-]*|.*|*..*|*-|*-.*|*.-*|*.) echo 'Invalid domain' >&2; exit 1;;
esac
case "$NODE" in /usr/local/bin/node|/usr/local/bin/node24) ;; *) echo 'Unexpected Node path' >&2; exit 1;; esac
[ -f "$SRC" ] && [ ! -L "$SRC" ] && [ -x "$NODE" ] || { echo 'Missing API or Node' >&2; exit 1; }
"$NODE" -e 'const s=require("node:sqlite");process.exit(typeof s.DatabaseSync==="function"?0:1)' ||
  { echo 'FreeBSD Node is missing node:sqlite' >&2; exit 1; }
APP_DIR=/opt/rust-signal/leaderboard
DATA_DIR=/var/db/rust-signal/leaderboard
RC=/usr/local/etc/rc.d/rust_signal_leaderboard
SNIPPET=/usr/local/etc/nginx/snippets/rust-signal-api.conf
[ ! -e "$RC" ] || grep -Fq '# Rust Signal FreeBSD rc service (loopback only)' "$RC" ||
  { echo 'Unmanaged service exists' >&2; exit 1; }
[ ! -e "$SNIPPET" ] || grep -Fq '# Rust Signal global scoreboard.' "$SNIPPET" ||
  { echo 'Unmanaged API Nginx snippet exists' >&2; exit 1; }
[ ! -e "$APP_DIR/leaderboard.mjs" ] ||
  grep -Fq 'Rust Signal global leaderboard on ' "$APP_DIR/leaderboard.mjs" ||
  { echo 'Unmanaged API source exists' >&2; exit 1; }
for dir in "$APP_DIR" "$DATA_DIR"; do
  [ ! -L "$dir" ] || { echo "Symlinked managed directory: $dir" >&2; exit 1; }
done
if id rustsignal >/dev/null 2>&1; then
  account=$(getent passwd rustsignal)
  case "$account" in *:"$DATA_DIR":*/nologin) ;; *) echo 'Wrong service account' >&2; exit 1;; esac
else
  pw useradd rustsignal -d "$DATA_DIR" -s /usr/sbin/nologin -c 'Rust Signal leaderboard API'
fi
mkdir -p "$APP_DIR" "$DATA_DIR" "$(dirname "$SNIPPET")"
chown rustsignal:rustsignal "$DATA_DIR"
chmod 700 "$DATA_DIR"
install -m 644 "$SRC" "$APP_DIR/leaderboard.mjs"
chown root:wheel "$APP_DIR/leaderboard.mjs"
cat >"$SNIPPET" <<'EOF'
# Rust Signal global scoreboard. Include inside the game server { } vhost.
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
cat >"$RC" <<EOF
#!/bin/sh
# PROVIDE: rust_signal_leaderboard
# REQUIRE: NETWORKING LOGIN
# KEYWORD: shutdown
# Rust Signal FreeBSD rc service (loopback only)
. /etc/rc.subr
name="rust_signal_leaderboard"
rcvar="rust_signal_leaderboard_enable"
load_rc_config "\$name"
: ${rust_signal_leaderboard_enable:=NO}
pidfile="/var/run/rust_signal_leaderboard.pid"
export RS_LEADERBOARD_DB="$DATA_DIR/leaderboard.sqlite"
export RS_PUBLIC_HOST="$DOMAIN"
export RS_LEADERBOARD_PORT=32741
command="/usr/sbin/daemon"
command_args="-f -r -P \$pidfile -u rustsignal $NODE $APP_DIR/leaderboard.mjs"
run_rc_command "\$1"
EOF
chmod 755 "$RC"
chown root:wheel "$RC" "$SNIPPET"
service rust_signal_leaderboard onestop >/dev/null 2>&1 || :
sysrc rust_signal_leaderboard_enable=YES >/dev/null
service rust_signal_leaderboard start
tries=0
until "$NODE" -e "fetch('http://127.0.0.1:32741/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  tries=$((tries+1))
  [ "$tries" -lt 25 ] || {
    service rust_signal_leaderboard status >&2 || :
    echo 'FreeBSD API health check failed' >&2
    exit 1
  }
  sleep 1
done
echo '[Rust Signal] FreeBSD leaderboard API healthy on 127.0.0.1:32741'

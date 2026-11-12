#!/bin/sh
# Deploy Rust Signal onto a shared Nginx stream SNI gateway without changing
# ANY pre-existing Nginx conf/stream routes: add only a named HTTP TLS vhost
# on the existing default SNI backend. Also installs local Node/SQLite API.
#
# Usage: sh stream-default-site.sh install|resume|update DOMAIN HTTPS_PORT CERT KEY MAP_NAME
set -eu
umask 022
say(){ printf '\n[Rust Signal shared gateway] %s\n' "$*"; }
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 6 ] || die 'Usage: install|resume|update DOMAIN BACKEND_HTTPS_PORT CERT KEY MAP_NAME'
ACTION=$1
DOMAIN=$2
PORT=$3
CERT=$4
KEY=$5
MAP_NAME=$6
case "$MAP_NAME" in ''|[0-9]*|*[!a-zA-Z0-9_]*) die 'Invalid SNI map variable name';; esac
case "$ACTION" in install|resume|update) ;; *) die 'Action must be install, resume or update';; esac
[ "$(id -u)" -eq 0 ] || die 'Run as root.'
[ -x /usr/sbin/nginx ] && [ -f /etc/nginx/nginx.conf ] ||
  die 'Requires system Nginx using /etc/nginx.'
systemctl is-active --quiet nginx.service || die 'Nginx must already be running.'
/usr/sbin/nginx -t || die 'Nginx configuration currently invalid.'
case "$DOMAIN" in ''|*[!a-z0-9.-]*|.*|*..*|*-|*-.*|*.-*|*.) die 'Invalid domain';; esac
case "$DOMAIN" in *.*) ;; *) die 'Domain must contain a dot';; esac
case "$PORT" in ''|*[!0-9]*) die 'Invalid port';; esac
[ "$PORT" -gt 0 ] && [ "$PORT" -le 65535 ] || die 'Invalid port range.'
for p in "$CERT" "$KEY"; do
  case "$p" in /*) ;; *) die 'TLS file paths must be absolute';; esac
  case "$p" in *'..'*|*' '*|*'
'*) die 'Unsafe TLS file path';; esac
  [ -s "$p" ] && [ -f "$p" ] || die "TLS file missing: $p"
done
openssl x509 -in "$CERT" -noout -checkhost "$DOMAIN" >/dev/null ||
  die 'Certificate does not cover domain.'
openssl x509 -in "$CERT" -noout -checkend 86400 >/dev/null ||
  die 'Certificate expires in less than one day.'
cert_hash=$(openssl x509 -in "$CERT" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
key_hash=$(openssl pkey -in "$KEY" -pubout -outform DER | sha256sum | cut -d' ' -f1)
[ "$cert_hash" = "$key_hash" ] || die 'TLS certificate/private key mismatch.'

VHOST="/etc/nginx/conf.d/rust-signal-shared-$DOMAIN.conf"
WEBROOT="/var/www/$DOMAIN"
STATE="/var/lib/rust-signal-selfmask/$DOMAIN"
TMP=''
CREATED_VHOST=0
WEBROOT_CREATED=0
COMMITTED=0
cleanup(){
  status=$?
  trap - 0
  if [ "$COMMITTED" -eq 0 ] && [ "$CREATED_VHOST" -eq 1 ]; then
    rm -f -- "$VHOST" || :
    /usr/sbin/nginx -t >/dev/null 2>&1 &&
      systemctl reload nginx.service >/dev/null 2>&1 || :
  fi
  # The webroot did not exist before this fresh install. On an early
  # build failure without a valid managed manifest, remove only our staging.
  if [ "$WEBROOT_CREATED" -eq 1 ] && [ ! -f "$STATE/entries" ]; then
    rm -rf -- "$WEBROOT" || :
  fi
  [ -z "$TMP" ] || rm -rf -- "$TMP"
  exit "$status"
}
trap cleanup 0
trap 'exit 1' 1 2 3 15
TMP=$(mktemp -d /tmp/rust-signal-shared.XXXXXXXX)
nginx -T > "$TMP/nginx-dump" 2>&1
# Verify that the active stream SNI default resolves to THIS exact HTTPS port.
# This is the observed shared-gateway topology, NOT a generic Nginx installer.
# Refuse other gateway layouts and prevent accidental use of a VPN socket.
backend=$(awk -v mapname="$MAP_NAME" '
  $1 == "map" && $2 == "$ssl_preread_server_name" && $3 == "$" mapname && $4 == "{" {
    in_map=1; next
  }
  in_map && $1 == "default" && $2 ~ /^[A-Za-z0-9_]+;$/ {
    gsub(/;/, "", $2); print $2; exit
  }
  in_map && $1 == "}" { in_map=0 }
' "$TMP/nginx-dump")
case "$backend" in ''|*[!a-zA-Z0-9_]*) die 'Cannot determine the default SNI upstream';; esac
grep -Fq "proxy_pass \$$MAP_NAME;" "$TMP/nginx-dump" ||
  die 'Selected SNI map is not used by a stream proxy_pass.'
grep -Eq "^[[:space:]]*upstream[[:space:]]+$backend[[:space:]]*\\{" "$TMP/nginx-dump" ||
  die 'Default SNI upstream definition is missing.'
grep -Eq "^[[:space:]]*server[[:space:]]+127\.0\.0\.1:$PORT;" "$TMP/nginx-dump" ||
  die 'Default SNI upstream does not target the supplied HTTPS port.'
grep -Eq "^[[:space:]]*listen[[:space:]]+(0\.0\.0\.0:)?$PORT[[:space:]]+ssl[[:space:]]+http2[[:space:]]+default_server" "$TMP/nginx-dump" ||
  die 'Existing HTTPS default_server does not use supplied port.'
# HTTP MIME types are essential: a wrong JS MIME broke the prior VPS site.
grep -Fq 'include /etc/nginx/mime.types;' "$TMP/nginx-dump" ||
  die 'Nginx MIME types are not configured.'
[ ! -L "$VHOST" ] || die 'Refusing symlinked virtual host.'
if [ "$ACTION" = install ]; then
  [ ! -e "$VHOST" ] || die 'A managed virtual host already exists.'
  [ ! -e "$WEBROOT" ] && [ ! -L "$WEBROOT" ] ||
    die 'Webroot already exists: refusing to replace another site.'
  [ ! -e "$STATE/entries" ] || die 'Existing static deployment state.'
  ! grep -Fq "$DOMAIN" "$TMP/nginx-dump" ||
    die 'Domain already mentioned in Nginx. Refusing to hijack it.'
  for reserved in /etc/systemd/system/rust-signal-leaderboard.service \
    /etc/nginx/snippets/rust-signal-api.conf \
    /opt/rust-signal/leaderboard/leaderboard.mjs; do
    [ ! -e "$reserved" ] && [ ! -L "$reserved" ] ||
      die "Reserved API component exists: $reserved"
  done
elif [ "$ACTION" = resume ]; then
  [ ! -e "$VHOST" ] || die 'Resume requires an unpublished new virtual host.'
  [ -f "$STATE/entries" ] && [ -s "$WEBROOT/index.html" ] &&
    [ "$(cat "$STATE/webroot")" = "$WEBROOT" ] ||
    die 'No previously staged Rust Signal website to resume.'
  for reserved in /etc/systemd/system/rust-signal-leaderboard.service     /etc/nginx/snippets/rust-signal-api.conf     /opt/rust-signal/leaderboard/leaderboard.mjs; do
    if [ -e "$reserved" ]; then
      case "$reserved" in
        *.service) grep -Fq 'Description=Rust Signal global leaderboard API (loopback only)' "$reserved" || die "Unmanaged service: $reserved";;
        *.conf) grep -Fq '# Rust Signal global scoreboard.' "$reserved" || die "Unmanaged snippet: $reserved";;
        *) grep -Fq 'Rust Signal global leaderboard on ' "$reserved" || die "Unmanaged API source: $reserved";;
      esac
    fi
  done
else
  [ -f "$VHOST" ] && grep -Fxq '# Managed by Rust Signal shared-gateway installer' "$VHOST" ||
    die 'No previously installed managed HTTPS host.'
  [ -f "$STATE/entries" ] || die 'No managed website to update.'
fi

if ! command -v curl >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 || die 'curl is missing and apt-get is unavailable.'
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl
fi
# The static installer installs git if needed before we clone API sources.
if [ "$ACTION" != resume ]; then
  curl -fsSL --retry 2 \
    https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/selfmask-webroot.sh \
    -o "$TMP/static.sh"
  sh -n "$TMP/static.sh" || die 'Invalid static installer.'
  if [ "$ACTION" = install ]; then
    mkdir -p "$WEBROOT"
    WEBROOT_CREATED=1
    printf '%s\n' '<!doctype html><title>Rust Signal staging</title>' > "$WEBROOT/index.html"
  fi
  say "Building website in $WEBROOT; Nginx and VPN unchanged"
  sh "$TMP/static.sh" "$ACTION" "$DOMAIN" "$WEBROOT"
  # On this dedicated webroot, published files should not be owned by the build user.
  # Do not change ownership of ACME material should .well-known be added.
  find "$WEBROOT" -mindepth 1 -maxdepth 1 ! -name .well-known -exec chown -R root:root -- {} +
  chown root:root "$WEBROOT"
fi

git clone --quiet --depth 1 --single-branch --branch main \
  https://github.com/serbo26-lab/RUST-SIGNAL.git "$TMP/source"
if [ -x /opt/rust-signal-selfmask/node/bin/node ]; then
  NODE=/opt/rust-signal-selfmask/node/bin/node
else
  NODE=$(command -v node || :)
fi
[ -n "$NODE" ] && [ -x "$NODE" ] || die 'Node.js missing.'
"$NODE" -e 'const v=process.versions.node.split(".").map(Number);process.exit(v[0]>25||(v[0]===25&&v[1]>=1)||(v[0]===24&&v[1]>=14)?0:1)' ||
  die 'Leaderboard requires Node.js 24.14+.'
if [ "$ACTION" = install ] || [ "$ACTION" = resume ]; then
  [ -e /etc/systemd/system/rust-signal-leaderboard.service ] || ! ss -ltn | grep -Eq '127\.0\.0\.1:32741[[:space:]]' ||
    die 'Local API port 32741 is occupied.'
fi
say 'Installing isolated SQLite leaderboard (loopback-only port 32741)'
sh "$TMP/source/deploy/install-leaderboard.sh" \
  "$TMP/source/server/leaderboard.mjs" "$NODE" "$DOMAIN"
if [ "$ACTION" = update ]; then
  COMMITTED=1
  say 'Website and API updated without modifying Nginx or SNI routing.'
  exit 0
fi

# Use the ALREADY ACTIVE HTTPS listener for the default SNI backend.
# Named virtual host matching does the final TLS/certificate selection.
cat > "$TMP/vhost.conf" <<EOF
# Managed by Rust Signal shared-gateway installer
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    return 301 https://$DOMAIN\$request_uri;
}
server {
    listen 0.0.0.0:$PORT ssl http2;
    listen [::]:$PORT ssl http2;
    server_name $DOMAIN;
    ssl_certificate $CERT;
    ssl_certificate_key $KEY;
    root $WEBROOT;
    index index.html;
    charset utf-8;
    autoindex off;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    location ^~ /assets/ {
        expires 1y;
        try_files \$uri =404;
    }
    location ~ /\\.(?!well-known(?:/|\$)) {
        deny all;
    }
    include /etc/nginx/snippets/rust-signal-api.conf;
    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF
install -m 644 "$TMP/vhost.conf" "$VHOST"
CREATED_VHOST=1
say 'Validating Nginx with one new named HTTPS vhost (stream untouched)'
/usr/sbin/nginx -t || die 'Vhost failed Nginx validation; removing it.'
systemctl reload nginx.service || die 'Graceful reload failed; removing the new vhost.'
# A successful systemctl reload only signals Nginx. With stream reuseport, old
# workers can still accept the first TLS connections with the old default
# certificate before newly configured workers start accepting connections.
# Check the named HTTPS backend first, then the REAL 443 SNI path, and require
# a verified TLS handshake and HTTP 200 at both. Do not use -k or weaken TLS.
say 'Waiting for the named HTTPS vhost and stream gateway to serve the new certificate'
tls_ready=0
attempt=0
while [ "$attempt" -lt 24 ]; do
  attempt=$((attempt+1))
  if curl -fsS --noproxy '*' --connect-timeout 2 --max-time 6 \
      --resolve "$DOMAIN:$PORT:127.0.0.1" \
      "https://$DOMAIN:$PORT/" -o "$TMP/backend.html" 2>"$TMP/backend.err" &&
    curl -fsS --noproxy '*' --connect-timeout 2 --max-time 6 \
      --resolve "$DOMAIN:443:127.0.0.1" \
      "https://$DOMAIN/" -o "$TMP/index.html" 2>"$TMP/stream.err"; then
    tls_ready=1
    break
  fi
  sleep 1
done
if [ "$tls_ready" -ne 1 ]; then
  echo 'Backend HTTPS check:' >&2
  cat "$TMP/backend.err" >&2 || :
  echo 'Stream SNI HTTPS check:' >&2
  if [ -f "$TMP/stream.err" ]; then cat "$TMP/stream.err" >&2; fi
  die 'New certificate not consistently selected after graceful reload; vhost rollback will restore Nginx. Confirm SNI/backend routing before another attempt.'
fi
say 'HTTPS certificate verified on both backend and port 443; checking JS, CSS, graphics, API'
grep -Fq '/assets/' "$TMP/index.html" || die 'Home page does not link JS assets.'
asset=$(grep -Eo '/assets/[^" ]+\.js' "$TMP/index.html" | head -1)
[ -n "$asset" ] || die 'No JavaScript asset found.'
curl -fsSI --noproxy '*' --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" \
  "https://$DOMAIN$asset" > "$TMP/headers" ||
  die 'JavaScript asset is not served.'
grep -Eqi '^content-type:[[:space:]]*(application|text)/javascript' "$TMP/headers" ||
  die 'JavaScript asset has the wrong Content-Type.'
curl -fsS --noproxy '*' --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" \
  "https://$DOMAIN/api/health" > "$TMP/api-health" ||
  die 'Leaderboard API is not served through HTTPS.'
css_asset=$(grep -Eo '/assets/[^" ]+\.css' "$TMP/index.html" | head -1 || :)
if [ -n "$css_asset" ]; then
  curl -fsSI --noproxy '*' --max-time 15 --resolve "$DOMAIN:443:127.0.0.1"     "https://$DOMAIN$css_asset" > "$TMP/css-headers" ||
    die 'Stylesheet is not served.'
  grep -Eqi '^content-type:[[:space:]]*text/css' "$TMP/css-headers" ||
    die 'Stylesheet has wrong MIME type.'
fi
curl -fsSI --noproxy '*' --max-time 15 --resolve "$DOMAIN:443:127.0.0.1"   "https://$DOMAIN/remaster/atlas.webp" > "$TMP/image-headers" ||
  die 'Game graphics are not served.'
grep -Eqi '^content-type:[[:space:]]*image/webp' "$TMP/image-headers" ||
  die 'Graphics have the wrong MIME type.'

COMMITTED=1
say "Success: https://$DOMAIN/ (game + online leaderboard)"
say 'Existing stream SNI routing, SUI, VPN and certificates were not modified.'

#!/bin/sh
# Install/update the static Rust Signal website directly from GitHub.
# Usage: .../vps.sh | sudo sh -s -- install [domain]
#        .../vps.sh | sudo sh -s -- update
set -eu
# This script is also invoked by replace-domain.sh, whose private backup
# workflow uses umask 077. Public executables and assets built here must be
# traversable by rustsignalbuild and the runtime service, so normalize the
# inherited mask. Secrets remain protected separately by the private data
# directory (0700), systemd UMask=0077, and mktemp (0700).
umask 022

REPO_URL='https://github.com/serbo26-lab/RUST-SIGNAL.git'
SITE_ROOT='/var/www/rust-signal'
RUNTIME_ROOT='/opt/rust-signal/runtime'
BRANCH='main'
ACTION=${1:-}
DOMAIN=${2:-}
REPLACEMENT_CONFIG=${RUST_SIGNAL_REPLACEMENT_CONFIG:-}
WORK=''
TEMP_NODE=''
NEW_RELEASE=''
COMMITTED=0
SWITCHED=0
PREVIOUS=''
NEW_CONF=0
OLD_CONF=''
API_PREPARED=0
API_PREVIOUS_ACTIVE=0
API_OLD_UNIT=0
API_OLD_CODE=0
API_OLD_SNIPPET=0
NGINX_ROOT_BACKUP=''
NGINX_MAIN=''
CONFIG=''
CURRENT="$SITE_ROOT/current"

say() { printf '\n[Rust Signal] %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

atomic_symlink() {
  target=$1
  name="$SITE_ROOT/.current-$$"
  rm -f "$name"
  ln -s "$target" "$name"
  if [ "$OS" = freebsd ]; then
    mv -fh "$name" "$CURRENT"
  else
    mv -Tf "$name" "$CURRENT"
  fi
}

cleanup() {
  status=$?
  trap - 0
  if [ "$COMMITTED" -eq 0 ] && [ "$SWITCHED" -eq 1 ]; then
    printf 'ERROR: reverting incomplete deployment\n' >&2
    if [ -n "$PREVIOUS" ]; then
      atomic_symlink "$PREVIOUS" || :
    else
      rm -f "$CURRENT" || :
    fi
    if [ "$NEW_CONF" -eq 1 ]; then rm -f "$CONFIG" || :; fi
    if [ -n "$OLD_CONF" ] && [ -f "$OLD_CONF" ]; then cp "$OLD_CONF" "$CONFIG" || :; fi
    if [ -n "$NGINX_ROOT_BACKUP" ] && [ -f "$NGINX_ROOT_BACKUP" ]; then
      cp "$NGINX_ROOT_BACKUP" "$NGINX_MAIN" || :
    fi
    if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then
      if [ "$OS" = freebsd ]; then
        service nginx status >/dev/null 2>&1 && service nginx reload >/dev/null 2>&1 || :
      else
        systemctl is-active --quiet nginx && systemctl reload nginx >/dev/null 2>&1 || :
      fi
    fi
  fi
  # Restore old API service files on failed build/provisioning/Nginx checks.
  # Persist SQLite itself across updates and failed deployments.
  if [ "$API_PREPARED" -eq 1 ] && [ "$COMMITTED" -eq 0 ]; then
    if [ "$OS" = freebsd ]; then
      service rust_signal_leaderboard onestop >/dev/null 2>&1 || :
      api_unit=/usr/local/etc/rc.d/rust_signal_leaderboard
      api_snippet=/usr/local/etc/nginx/snippets/rust-signal-api.conf
      if [ "$API_OLD_UNIT" -eq 1 ]; then
        cp -p "$WORK/api-unit.original" "$api_unit" || :
      else
        rm -f "$api_unit" || :
        sysrc -x rust_signal_leaderboard_enable >/dev/null 2>&1 || :
      fi
      if [ "$API_OLD_SNIPPET" -eq 1 ]; then
        cp -p "$WORK/api-snippet.original" "$api_snippet" || :
      else
        rm -f "$api_snippet" || :
      fi
      if [ "$API_OLD_CODE" -eq 1 ]; then
        cp -p "$WORK/api-code.original" /opt/rust-signal/leaderboard/leaderboard.mjs || :
      else
        rm -f /opt/rust-signal/leaderboard/leaderboard.mjs || :
      fi
      if [ "$API_PREVIOUS_ACTIVE" -eq 1 ]; then
        service rust_signal_leaderboard start >/dev/null 2>&1 || :
      fi
      if nginx -t >/dev/null 2>&1 && service nginx status >/dev/null 2>&1; then
        service nginx reload >/dev/null 2>&1 || :
      fi
    else
    systemctl stop rust-signal-leaderboard.service >/dev/null 2>&1 || :
    if [ "$API_OLD_UNIT" -eq 1 ]; then
      cp -p "$WORK/api-unit.original" /etc/systemd/system/rust-signal-leaderboard.service || :
    else
      rm -f /etc/systemd/system/rust-signal-leaderboard.service
    fi
    if [ "$API_OLD_SNIPPET" -eq 1 ]; then
      cp -p "$WORK/api-snippet.original" /etc/nginx/snippets/rust-signal-api.conf || :
    else
      rm -f /etc/nginx/snippets/rust-signal-api.conf
    fi
    if [ "$API_OLD_CODE" -eq 1 ]; then
      cp -p "$WORK/api-code.original" /opt/rust-signal/leaderboard/leaderboard.mjs || :
    else
      rm -f /opt/rust-signal/leaderboard/leaderboard.mjs
    fi
    systemctl daemon-reload >/dev/null 2>&1 || :
    if [ "$API_PREVIOUS_ACTIVE" -eq 1 ]; then
      systemctl start rust-signal-leaderboard.service >/dev/null 2>&1 || :
    elif [ "$API_OLD_UNIT" -eq 0 ]; then
      systemctl disable rust-signal-leaderboard.service >/dev/null 2>&1 || :
    fi
    # Reload after restoring the old snippet so running workers use the
    # original proxy configuration rather than the rejected version.
    if nginx -t >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
      systemctl reload nginx >/dev/null 2>&1 || :
    fi
    fi
  fi
  [ -z "$WORK" ] || rm -rf "$WORK"
  [ -z "$TEMP_NODE" ] || rm -rf "$TEMP_NODE"
  if [ "$COMMITTED" -eq 0 ] && [ -n "$NEW_RELEASE" ]; then
    rm -rf "$NEW_RELEASE"
  fi
  exit "$status"
}
trap 'cleanup' 0
trap 'exit 1' 1 2 3 15

[ "$(id -u)" -eq 0 ] || fail 'Run with root privileges (sudo or su).'
case "$ACTION" in install|update) ;; *) fail 'Usage: vps.sh install [DOMAIN] | vps.sh update';; esac
[ "$#" -le 2 ] || fail 'Too many arguments.'
case "$(uname -s)" in
  FreeBSD)
    [ "$(uname -m)" = amd64 ] || fail 'FreeBSD build is supported on amd64 (x86_64) only.'
    OS=freebsd
    STATE_DIR='/var/db/rust-signal'
    NGINX_DIR='/usr/local/etc/nginx'
    export PATH="/usr/local/bin:/usr/local/sbin:$PATH"
    ;;
  Linux)
    [ -r /etc/os-release ] || fail 'No /etc/os-release, cannot determine Linux distribution.'
    . /etc/os-release
    case "${ID:-}" in
      ubuntu|debian) OS=apt;;
      centos|rhel|rocky|almalinux) OS=dnf;;
      *) fail "Unsupported Linux distribution: ${ID:-unknown}. Supported: Ubuntu, Debian, CentOS Stream 9/10.";;
    esac
    STATE_DIR='/var/lib/rust-signal'
    NGINX_DIR='/etc/nginx'
    ;;
  *) fail 'Supported operating systems: Ubuntu, Debian, CentOS Stream, FreeBSD.';;
esac

if [ "$ACTION" = update ]; then
  [ -z "$DOMAIN" ] || fail 'Update does not accept a domain; it uses the installed configuration.'
  [ -f "$STATE_DIR/domain" ] || fail 'No installed website detected. Run install first.'
  DOMAIN=$(cat "$STATE_DIR/domain")
fi
# Optional reuse of the existing domain's certificate during an explicit
# replace-domain operation. Ordinary installs/updates never set these values.
TLS_CERT=${RUST_SIGNAL_TLS_CERT:-}
TLS_KEY=${RUST_SIGNAL_TLS_KEY:-}
TLS_OPTIONS=${RUST_SIGNAL_TLS_OPTIONS:-}
TLS_DHPARAM=${RUST_SIGNAL_TLS_DHPARAM:-}
if [ -n "$TLS_CERT" ] || [ -n "$TLS_KEY" ]; then
  [ -n "$DOMAIN" ] && [ -n "$TLS_CERT" ] && [ -n "$TLS_KEY" ] ||
    fail 'HTTPS replacement needs a domain, certificate and private key.'
  for tls_file in "$TLS_CERT" "$TLS_KEY"; do
    case "$tls_file" in /*) ;; *) fail 'TLS files must use absolute paths.';; esac
    case "$tls_file" in *[!a-zA-Z0-9_./-]*) fail 'Unsafe TLS file path.';; esac
    [ -r "$tls_file" ] && [ -f "$tls_file" ] || fail "Cannot read TLS file: $tls_file"
  done
  for tls_file in "$TLS_OPTIONS" "$TLS_DHPARAM"; do
    [ -n "$tls_file" ] || continue
    case "$tls_file" in /*) ;; *) fail 'TLS include must be an absolute path.';; esac
    case "$tls_file" in *[!a-zA-Z0-9_./-]*) fail 'Unsafe TLS include path.';; esac
    [ -r "$tls_file" ] && [ -f "$tls_file" ] || fail "Cannot read TLS include: $tls_file"
  done
elif [ -n "$TLS_OPTIONS" ] || [ -n "$TLS_DHPARAM" ]; then
  fail 'TLS options require a certificate and key.'
fi
# An empty domain selects IP-only HTTP access; existing sites remain untouched.
# Strict DNS validation prevents shell/sed/Nginx interpolation from input.
if [ -n "$DOMAIN" ]; then
  case "$DOMAIN" in *[!a-zA-Z0-9.-]*|.*|*..*|*-|*-.*|*.-*|*.) fail "Invalid domain: $DOMAIN";; esac
  case "$DOMAIN" in *.*) ;; *) fail 'Domain must contain at least one dot.';; esac
  [ "${#DOMAIN}" -le 253 ] || fail 'Domain too long.'
  oldIFS=$IFS; IFS=.
  for label in $DOMAIN; do
    [ -n "$label" ] && [ "${#label}" -le 63 ] || fail 'Invalid DNS label length.'
    case "$label" in -*|*-) fail 'DNS label cannot start or end with hyphen.';; esac
  done
  IFS=$oldIFS
  DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')
fi
if [ -f "$STATE_DIR/domain" ]; then
  saved=$(cat "$STATE_DIR/domain")
  [ "$saved" = "$DOMAIN" ] || fail "Already configured for $saved; not overwriting."
fi
if [ -n "$REPLACEMENT_CONFIG" ]; then
  [ "$ACTION" = install ] && [ -n "$DOMAIN" ] ||
    fail 'Replacement configuration requires install DOMAIN.'
  [ -f "$REPLACEMENT_CONFIG" ] && [ ! -L "$REPLACEMENT_CONFIG" ] ||
    fail 'Replacement vhost is missing or symlinked.'
  grep -Fq '# Rust Signal managed vhost' "$REPLACEMENT_CONFIG" ||
    fail 'Unrecognized replacement vhost.'
  grep -Fq "server_name $DOMAIN;" "$REPLACEMENT_CONFIG" ||
    fail 'Replacement vhost domain mismatch.'
fi

APT_REFRESHED=0
pkg_install() {
  case "$OS" in
    apt)
      if [ "$APT_REFRESHED" -eq 0 ]; then
        DEBIAN_FRONTEND=noninteractive apt-get update -qq
        APT_REFRESHED=1
      fi
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
      ;;
    dnf)
      command -v dnf >/dev/null 2>&1 || fail 'CentOS Stream requires dnf.'
      dnf install -y "$@"
      ;;
    freebsd) env ASSUME_ALWAYS_YES=yes pkg install -y "$@";;
  esac
}
ensure_command() {
  bin=$1
  pkg=$2
  if command -v "$bin" >/dev/null 2>&1; then return; fi
  say "Installing missing component: $bin"
  pkg_install "$pkg"
  command -v "$bin" >/dev/null 2>&1 || fail "Component $bin was not installed."
}
ensure_command git git
ensure_command nginx nginx

node_ok=0
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  node -e 'const v=process.versions.node.split(".").map(Number); process.exit(v[0]>25||(v[0]===25&&v[1]>=1)||(v[0]===24&&v[1]>=14)?0:1)' && node_ok=1 || :
fi
if [ "$node_ok" -eq 0 ]; then
  if [ "$OS" = freebsd ]; then
    say 'Installing compatible Node.js 24 and npm from FreeBSD pkg'
    pkg_install node24 npm-node24
  else
    # Install an isolated official runtime rather than replacing system Node.
    ensure_command curl curl
    if [ "$OS" = apt ]; then ensure_command xz xz-utils; else ensure_command xz xz; fi
    ensure_command tar tar
    ensure_command sha256sum coreutils
    case "$(uname -m)" in
      x86_64|amd64) node_arch=x64;;
      aarch64|arm64) node_arch=arm64;;
      *) fail "Unsupported Node.js binary architecture: $(uname -m)";;
    esac
    if [ -x "$RUNTIME_ROOT/node/bin/node" ] && [ -x "$RUNTIME_ROOT/node/bin/npm" ] &&
      "$RUNTIME_ROOT/node/bin/node" -e 'const v=process.versions.node.split(".").map(Number);process.exit(v[0]>25||(v[0]===25&&v[1]>=1)||(v[0]===24&&v[1]>=14)?0:1)'; then
      PATH="$RUNTIME_ROOT/node/bin:$PATH"; export PATH
    else
      say 'Downloading official Node.js 24 and verifying SHA256'
      temp_node=$(mktemp -d "${TMPDIR:-/tmp}/rust-node.XXXXXX")
      TEMP_NODE="$temp_node"
      curl -fsSL --retry 2 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$temp_node/SHASUMS256.txt"
      file=$(awk -v a="linux-$node_arch.tar.xz" '$2 ~ ("^node-v[0-9.]+-" a "$") { print $2; exit }' "$temp_node/SHASUMS256.txt")
      [ -n "$file" ] || fail "Node.js 24 archive unavailable for $node_arch"
      curl -fsSL --retry 2 "https://nodejs.org/dist/latest-v24.x/$file" -o "$temp_node/$file"
      (cd "$temp_node" && grep "  $file\$" SHASUMS256.txt | sha256sum -c -) || fail 'Node SHA256 verification failed'
      mkdir -p "$RUNTIME_ROOT"
      tar -xJf "$temp_node/$file" -C "$RUNTIME_ROOT"
      new_node="${file%.tar.xz}"
      ln -sfn "$RUNTIME_ROOT/$new_node" "$RUNTIME_ROOT/.node-$$"
      mv -Tf "$RUNTIME_ROOT/.node-$$" "$RUNTIME_ROOT/node"
      rm -rf "$temp_node"
      TEMP_NODE=''
      PATH="$RUNTIME_ROOT/node/bin:$PATH"; export PATH
    fi
  fi
fi
# Recover an isolated runtime left with root-only (0700) parent directories
# by a previous failed replace-domain attempt. Never recurse into code/data
# or alter unrelated directories: only these dedicated runtime ancestors
# need traversal permission for the non-root builder and API service.
if [ "$OS" != freebsd ] && [ -d "$RUNTIME_ROOT" ]; then
  runtime_parent=$(dirname "$RUNTIME_ROOT")
  [ ! -L "$runtime_parent" ] && [ ! -L "$RUNTIME_ROOT" ] ||
    fail 'The isolated Node.js runtime path contains a symlinked directory.'
  chmod 755 "$runtime_parent" "$RUNTIME_ROOT"
fi
command -v npm >/dev/null 2>&1 || fail 'npm unavailable.'
node -e 'const v=process.versions.node.split(".").map(Number); process.exit(v[0]>25||(v[0]===25&&v[1]>=1)||(v[0]===24&&v[1]>=14)?0:1)' || fail 'Node.js 24.14+ required for built-in SQLite.'

say "Using Node.js $(node -v), npm $(npm -v)"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/rust-signal.XXXXXX")
say 'Fetching current game source from GitHub'
git clone --quiet --depth 1 --single-branch --branch "$BRANCH" "$REPO_URL" "$WORK/source"
cd "$WORK/source"
revision=$(git rev-parse --short=12 HEAD)
say "Building commit $revision"
if [ "$OS" = freebsd ] && [ -z "$(printenv RUST_SIGNAL_SKIP_NONROOT_BUILD 2>/dev/null || :)" ]; then
  # FreeBSD has no runuser; su -m preserves the controlled HOME/PATH environment.
  # Never execute npm package lifecycle scripts as root on a real VPS.
  if id rustsignalbuild >/dev/null 2>&1; then
    account=$(getent passwd rustsignalbuild)
    case "$account" in *:/nonexistent:*/nologin) ;;
      *) fail 'Existing rustsignalbuild account is not a restricted build user.';;
    esac
  else
    pw useradd rustsignalbuild -d /nonexistent -s /usr/sbin/nologin -c RustSignalBuild
  fi
  chown -R rustsignalbuild "$WORK"
  say 'Building website as unprivileged rustsignalbuild user on FreeBSD'
  env HOME="$WORK" NPM_CONFIG_CACHE="$WORK/npm-cache" PATH="$PATH" CI=1 \
    su -m rustsignalbuild -c 'npm ci --no-audit --no-fund && npm run build'
elif [ "$OS" != freebsd ] && [ -z "$(printenv RUST_SIGNAL_SKIP_NONROOT_BUILD 2>/dev/null || :)" ]; then
  # npm lifecycle scripts and bundlers must never run with root privileges.
  if [ "$OS" = apt ]; then ensure_command useradd passwd
  else ensure_command useradd shadow-utils; fi
  ensure_command runuser util-linux
  if id rustsignalbuild >/dev/null 2>&1; then
    account=$(getent passwd rustsignalbuild || :)
    case "$account" in
      *:/nonexistent:*/nologin|*:/nonexistent:*/false) ;;
      *) fail 'Existing rustsignalbuild account is not a restricted build user.';;
    esac
  else
    useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin rustsignalbuild
  fi
  chown -R rustsignalbuild "$WORK"
  say 'Building website as unprivileged rustsignalbuild user'
  runuser -u rustsignalbuild -- env HOME="$WORK" NPM_CONFIG_CACHE="$WORK/npm-cache" PATH="$PATH" CI=1 npm ci --no-audit --no-fund
  runuser -u rustsignalbuild -- env HOME="$WORK" NPM_CONFIG_CACHE="$WORK/npm-cache" PATH="$PATH" npm run build
else
  CI=1 npm ci --no-audit --no-fund
  npm run build
fi
# Reject symlink escape from the generated web root.
if [ -n "$(find dist -type l -print -quit)" ]; then
  fail 'Build output contains symlinks; refusing to deploy.'
fi
[ -s dist/index.html ] && [ -d dist/assets ] && [ -s dist/remaster/atlas.webp ] ||
  fail 'Production build incomplete (index, assets, or graphics missing).'
[ -f deploy/nginx-site.conf.template ] || fail 'Missing Nginx site template.'
mkdir -p "$SITE_ROOT/releases"
release="$SITE_ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$revision"
if [ -e "$release" ]; then release="$release-$$"; fi
mkdir -p "$release"
NEW_RELEASE="$release"
cp -R dist/. "$release/"
chmod -R a+rX "$release"

CONFIG="$NGINX_DIR/conf.d/rust-signal.conf"
LEGACY_CONFIG=''
if [ -n "$DOMAIN" ]; then LEGACY_CONFIG="$NGINX_DIR/conf.d/rust-signal-$DOMAIN.conf"; fi
NGINX_MAIN="$NGINX_DIR/nginx.conf"
[ -f "$NGINX_MAIN" ] || fail "Nginx main config not found: $NGINX_MAIN"
mkdir -p "$NGINX_DIR/conf.d"
# Existing installs made with the previous installer stay fully compatible.
if [ -n "$LEGACY_CONFIG" ] && [ -f "$LEGACY_CONFIG" ] && grep -q '^# Managed by Rust Signal installer' "$LEGACY_CONFIG"; then
  [ ! -e "$CONFIG" ] || fail 'Both legacy and new managed Nginx configs exist; manual review needed.'
  CONFIG="$LEGACY_CONFIG"
fi
if [ -e "$CONFIG" ] && [ ! -f "$STATE_DIR/domain" ]; then
  fail "Found a previous managed Nginx vhost but no install metadata. Refusing to reuse without review."
fi
if [ -e "$CONFIG" ] && ! grep -Eq '^# (Rust Signal managed vhost|Managed by Rust Signal installer)' "$CONFIG"; then
  fail "Unmanaged Nginx config exists: $CONFIG. Refusing to overwrite."
fi
if [ -e "$CURRENT" ] && [ ! -L "$CURRENT" ]; then
  fail "$CURRENT exists but is not a symlink. Refusing to overwrite."
fi

# Never steal a domain already configured in another Nginx virtual host.
nginx -T > "$WORK/nginx-dump" 2>&1 || fail 'Nginx configuration already invalid.'
# Parse Nginx directives, not lines: server_name may be inline in
# "server { listen 80; server_name example.com; }" or span several lines.
# Also consider wildcard names that would otherwise lose traffic to us.
nginx_claims_domain() {
  awk -v domain="$DOMAIN" '
    function suffix_match(s, suffix) {
      return length(s) >= length(suffix) &&
        substr(s, length(s)-length(suffix)+1) == suffix
    }
    function inspect(stmt, n, items, i, name) {
      gsub(/[{}]/, " ", stmt)
      sub(/^[[:space:]]+/, "", stmt)
      if (stmt !~ /^server_name[[:space:]]+/) return
      sub(/^server_name[[:space:]]+/, "", stmt)
      n = split(stmt, items, /[[:space:]]+/)
      for (i = 1; i <= n; ++i) {
        name = items[i]
        if (name == domain ||
            (substr(name, 1, 2) == "*." && suffix_match(domain, substr(name, 2))) ||
            (substr(name, 1, 1) == "." && (domain == substr(name, 2) || suffix_match(domain, name))) ||
            (substr(name, length(name)-1) == ".*" && substr(domain, 1, length(name)-1) == substr(name, 1, length(name)-1))) {
          found = 1
        }
      }
    }
    {
      line = $0
      sub(/#.*/, "", line)
      buffer = buffer " " line
      while ((semi = index(buffer, ";")) > 0) {
        inspect(substr(buffer, 1, semi-1))
        buffer = substr(buffer, semi+1)
      }
    }
    END { exit found ? 0 : 1 }
  ' "$WORK/nginx-dump"
}
if [ -n "$DOMAIN" ] && [ ! -f "$CONFIG" ]; then
  if nginx_claims_domain; then
    fail "The domain $DOMAIN already belongs to another Nginx site."
  fi
fi

# Domain ownership checks above must pass before touching the API service.
if [ "$OS" != freebsd ] && [ -z "$(printenv RUST_SIGNAL_SKIP_ONLINE_API 2>/dev/null || :)" ]; then
  [ -f deploy/install-leaderboard.sh ] && [ -f server/leaderboard.mjs ] ||
    fail 'Missing server leaderboard deployment files.'
  # Do not touch a pre-existing service belonging to another application.
  [ ! -e /etc/systemd/system/rust-signal-leaderboard.service ] ||
    grep -Fq 'Description=Rust Signal global leaderboard API (loopback only)' /etc/systemd/system/rust-signal-leaderboard.service ||
    fail 'Unmanaged leaderboard systemd unit already exists.'
  [ ! -e /etc/nginx/snippets/rust-signal-api.conf ] ||
    grep -Fq '# Rust Signal global scoreboard.' /etc/nginx/snippets/rust-signal-api.conf ||
    fail 'Unmanaged Nginx snippet at reserved leaderboard path.'
  [ ! -e /opt/rust-signal/leaderboard/leaderboard.mjs ] ||
    grep -Fq 'Rust Signal global leaderboard on ' /opt/rust-signal/leaderboard/leaderboard.mjs ||
    fail 'Unmanaged API source at reserved leaderboard path.'
  if [ -f /etc/systemd/system/rust-signal-leaderboard.service ]; then
    cp -p /etc/systemd/system/rust-signal-leaderboard.service "$WORK/api-unit.original"
    API_OLD_UNIT=1
  fi
  if [ -f /etc/nginx/snippets/rust-signal-api.conf ]; then
    cp -p /etc/nginx/snippets/rust-signal-api.conf "$WORK/api-snippet.original"
    API_OLD_SNIPPET=1
  fi
  if [ -f /opt/rust-signal/leaderboard/leaderboard.mjs ]; then
    cp -p /opt/rust-signal/leaderboard/leaderboard.mjs "$WORK/api-code.original"
    API_OLD_CODE=1
  fi
  systemctl is-active --quiet rust-signal-leaderboard.service && API_PREVIOUS_ACTIVE=1 || :
  API_PREPARED=1
  sh deploy/install-leaderboard.sh "$PWD/server/leaderboard.mjs" "$(command -v node)" "$DOMAIN"
elif [ "$OS" = freebsd ] && [ -z "$(printenv RUST_SIGNAL_SKIP_ONLINE_API 2>/dev/null || :)" ]; then
  [ -f deploy/install-leaderboard-freebsd.sh ] && [ -f server/leaderboard.mjs ] ||
    fail 'Missing FreeBSD leaderboard deployment files.'
  api_unit=/usr/local/etc/rc.d/rust_signal_leaderboard
  api_snippet=/usr/local/etc/nginx/snippets/rust-signal-api.conf
  [ ! -e "$api_unit" ] ||
    grep -Fq '# Rust Signal FreeBSD rc service (loopback only)' "$api_unit" ||
    fail 'Unmanaged FreeBSD leaderboard service.'
  [ ! -e "$api_snippet" ] ||
    grep -Fq '# Rust Signal global scoreboard.' "$api_snippet" ||
    fail 'Unmanaged FreeBSD leaderboard Nginx snippet.'
  [ ! -e /opt/rust-signal/leaderboard/leaderboard.mjs ] ||
    grep -Fq 'Rust Signal global leaderboard on ' /opt/rust-signal/leaderboard/leaderboard.mjs ||
    fail 'Unmanaged FreeBSD leaderboard source.'
  if [ -f "$api_unit" ]; then
    cp -p "$api_unit" "$WORK/api-unit.original"
    API_OLD_UNIT=1
  fi
  if [ -f "$api_snippet" ]; then
    cp -p "$api_snippet" "$WORK/api-snippet.original"
    API_OLD_SNIPPET=1
  fi
  if [ -f /opt/rust-signal/leaderboard/leaderboard.mjs ]; then
    cp -p /opt/rust-signal/leaderboard/leaderboard.mjs "$WORK/api-code.original"
    API_OLD_CODE=1
  fi
  service rust_signal_leaderboard status >/dev/null 2>&1 && API_PREVIOUS_ACTIVE=1 || :
  API_PREPARED=1
  sh deploy/install-leaderboard-freebsd.sh "$PWD/server/leaderboard.mjs" "$(command -v node)" "$DOMAIN"
fi

if [ -L "$CURRENT" ]; then PREVIOUS=$(readlink "$CURRENT"); fi
if [ -f "$CONFIG" ]; then OLD_CONF="$WORK/rust-signal.conf.original"; cp "$CONFIG" "$OLD_CONF"; else NEW_CONF=1; fi
# All changes after this point are rolled back on failure.
SWITCHED=1
# FreeBSD's stock nginx.conf may not include conf.d. Add a scoped include
# inside http { }, with backup and rollback, without changing other sites.
if [ "$OS" = freebsd ] && ! grep -Eq '^[[:space:]]*include[[:space:]]+(/usr/local/etc/nginx/)?conf.d/\*\.conf;' "$NGINX_MAIN"; then
  grep -Eq '^[[:space:]]*http[[:space:]]*\{' "$NGINX_MAIN" ||
    fail "Cannot safely add conf.d include to $NGINX_MAIN."
  NGINX_ROOT_BACKUP="$WORK/nginx.conf.original"
  cp "$NGINX_MAIN" "$NGINX_ROOT_BACKUP"
  awk '/^[[:space:]]*http[[:space:]]*\{/ && !done {print; print "    include /usr/local/etc/nginx/conf.d/*.conf;"; done=1; next} {print}'     "$NGINX_MAIN" > "$WORK/nginx.conf.new"
  cp "$WORK/nginx.conf.new" "$NGINX_MAIN"
fi
atomic_symlink "$release"
# Preserve any existing TLS / reverse-proxy customizations on updates.
if [ "$NEW_CONF" -eq 1 ]; then
  if [ -n "$REPLACEMENT_CONFIG" ]; then
    # Explicit domain replacement preserves verified original listen sockets.
    cp "$REPLACEMENT_CONFIG" "$CONFIG"
  else
  # The IP-host regex is matched before the default virtual host, so the
  # distro's Nginx welcome site and other named sites need not be changed.
  NGINX_SERVER_NAME="$DOMAIN"
  if [ -z "$NGINX_SERVER_NAME" ]; then
    NGINX_SERVER_NAME='~^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+$'
  fi
  if [ -n "$TLS_CERT" ]; then
    {
      printf '%s\n' '# Rust Signal managed vhost'
      # Redirect plaintext traffic to HTTPS, then serve the game over the
      # already-issued certificate without touching its original files.
      printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n    return 301 https://%s$request_uri;\n}\n' "$DOMAIN" "$DOMAIN"
      sed -e 's/listen 80;/listen 443 ssl;/' \
          -e 's/listen \[::\]:80;/listen [::]:443 ssl;/' \
          -e "s|__DOMAIN__|$NGINX_SERVER_NAME|g" \
          -e "s|__WEB_ROOT__|$CURRENT|g" deploy/nginx-site.conf.template |
        awk -v cert="$TLS_CERT" -v key="$TLS_KEY" -v opts="$TLS_OPTIONS" -v dh="$TLS_DHPARAM" '
          /^[[:space:]]*server_name[[:space:]]/ {
            print
            print "    ssl_certificate " cert ";"
            print "    ssl_certificate_key " key ";"
            if (opts != "") print "    include " opts ";"
            if (dh != "") print "    ssl_dhparam " dh ";"
            next
          }
          { print }
        '
    } > "$CONFIG"
  else
    {
      printf '%s\n' '# Rust Signal managed vhost'
      sed -e "s|__DOMAIN__|$NGINX_SERVER_NAME|g" -e "s|__WEB_ROOT__|$CURRENT|g" deploy/nginx-site.conf.template
    } > "$CONFIG"
  fi
  fi
fi
# New sites get the same API include as existing managed sites.
if [ -z "$(printenv RUST_SIGNAL_SKIP_ONLINE_API 2>/dev/null || :)" ] &&
   ! grep -Fq 'rust-signal-api.conf' "$CONFIG"; then
  if [ "$OS" = freebsd ]; then
    awk '/^[[:space:]]*server_name[[:space:]]/ {
      print
      print "    include /usr/local/etc/nginx/snippets/rust-signal-api.conf;"
      next
    } { print }' "$CONFIG" > "$WORK/nginx-with-api.conf"
  else
    sed '/^[[:space:]]*server_name /a\    include /etc/nginx/snippets/rust-signal-api.conf;' "$CONFIG" > "$WORK/nginx-with-api.conf"
  fi
  cp "$WORK/nginx-with-api.conf" "$CONFIG"
fi
nginx -t || fail 'Nginx validation failed; previous release restored.' 
nginx -T > "$WORK/nginx-new-dump" 2>&1 || fail 'Cannot inspect Nginx includes.'
grep -Fq "configuration file $CONFIG:" "$WORK/nginx-new-dump" ||
  fail "Nginx did not load $CONFIG; previous release restored."
if [ "$OS" = freebsd ]; then
  sysrc nginx_enable=YES >/dev/null
  if service nginx status >/dev/null 2>&1; then service nginx reload; else service nginx start; fi
else
  if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl enable --now nginx; fi
fi
mkdir -p "$STATE_DIR"
printf '%s\n' "$DOMAIN" > "$STATE_DIR/domain"
printf '%s\n' "$revision" > "$STATE_DIR/revision"
COMMITTED=1
say "Deployed $revision; previous release: ${PREVIOUS:-none}"
if [ -n "$DOMAIN" ]; then
  say "Game URL: http://$DOMAIN/"
else
  say 'Game URL: http://<YOUR_VPS_PUBLIC_IP>/ (port 80)'
  say 'Open the public IPv4 address of your VPS in a browser.'
fi
say 'TLS is not changed automatically; configure HTTPS in your existing certificate/reverse-proxy setup.'

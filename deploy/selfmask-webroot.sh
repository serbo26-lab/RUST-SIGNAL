#!/bin/sh
# Deploy Rust Signal's static site into an existing webroot WITHOUT editing Nginx,
# TLS, systemd proxy services, port bindings, or any .well-known/ ACME files.
# Usage: selfmask-webroot.sh install|update DOMAIN ABSOLUTE_WEBROOT
set -eu
umask 022
say() { printf '\n[Rust Signal selfmask] %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 3 ] || fail 'Usage: selfmask-webroot.sh install|update DOMAIN ABSOLUTE_WEBROOT'
ACTION=$1
DOMAIN=$2
WEBROOT=$3
case "$ACTION" in install|update) ;; *) fail 'Choose install or update.';; esac
[ "$(id -u)" = 0 ] || fail 'Run as root.'
[ "$(uname -s)" = Linux ] || fail 'Linux is required.'
case "$DOMAIN" in *[!a-z0-9.-]*|.*|*..*|*-|*-.*|*.-*|*.) fail 'Invalid domain';; esac
case "$DOMAIN" in *.*) ;; *) fail 'Domain must contain a dot.';; esac
case "$WEBROOT" in /*) ;; *) fail 'Webroot must be an absolute path.';; esac
case "$WEBROOT" in *'
'*|*'	'*|*' '*|*'..'*|*'/./'*|*/|/) fail 'Unsafe/non-canonical webroot path.';; esac
[ -d "$WEBROOT" ] && [ ! -L "$WEBROOT" ] ||
  fail "Site webroot does not exist or is symlinked: $WEBROOT"
[ "$(readlink -f "$WEBROOT")" = "$WEBROOT" ] || fail 'Webroot contains a symlink.'
[ -f "$WEBROOT/index.html" ] && [ ! -L "$WEBROOT/index.html" ] ||
  fail 'Existing static index.html required; refusing to claim an unknown site.'
if [ -e "$WEBROOT/.well-known" ] || [ -L "$WEBROOT/.well-known" ]; then
  [ -d "$WEBROOT/.well-known" ] && [ ! -L "$WEBROOT/.well-known" ] ||
    fail '.well-known must be a normal directory.'
fi

STATE_PARENT=/var/lib/rust-signal-selfmask
STATE="$STATE_PARENT/$DOMAIN"
BACKUP_BASE=/var/backups/rust-signal-selfmask
BACKUP_PARENT="$BACKUP_BASE/$DOMAIN"
RUNTIME=/opt/rust-signal-selfmask
WORK=''
BACKUP=''
LOCK=''
ACTIVE=0
COMMITTED=0
entries() {
  # Include top-level dotfiles, but never touch ACME's .well-known tree.
  for item in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    [ -e "$item" ] || [ -L "$item" ] || continue
    name=$(basename "$item")
    [ "$name" = .well-known ] && continue
    printf '%s\n' "$item"
  done
}
cleanup() {
  status=$?
  trap - 0
  if [ "$ACTIVE" -eq 1 ] && [ "$COMMITTED" -eq 0 ]; then
    printf 'ERROR: restoring previous webroot from %s\n' "$BACKUP" >&2
    entries "$WEBROOT" | while IFS= read -r item; do rm -rf -- "$item"; done
    cp -a "$BACKUP/site/." "$WEBROOT/" || :
    if [ -f "$BACKUP/previous-entries" ]; then
      cp "$BACKUP/previous-entries" "$STATE/entries" || :
      cp "$BACKUP/previous-webroot" "$STATE/webroot" || :
      cp "$BACKUP/previous-revision" "$STATE/revision" || :
    else
      rm -f "$STATE/entries" "$STATE/webroot" "$STATE/revision" || :
    fi
  fi
  [ -z "$WORK" ] || rm -rf "$WORK"
  [ -z "$LOCK" ] || rmdir "$LOCK" 2>/dev/null || :
  exit "$status"
}
trap cleanup 0
trap 'exit 1' 1 2 3 15

for d in "$STATE_PARENT" "$STATE" "$BACKUP_BASE" "$BACKUP_PARENT" "$RUNTIME"; do
  [ ! -L "$d" ] || fail "Unsafe symlinked managed path: $d"
done
mkdir -p "$STATE_PARENT" "$BACKUP_PARENT"
chmod 700 "$STATE_PARENT" "$BACKUP_BASE" "$BACKUP_PARENT"
if [ "$ACTION" = install ]; then
  [ ! -e "$STATE/entries" ] || fail 'Webroot already managed; use update.'
  # First installation is deliberately restricted to the observed simple
  # selfmask layout. Never remove unrelated files from a shared webroot.
  unexpected=$(entries "$WEBROOT" | grep -v -Fx "$WEBROOT/index.html" || :)
  [ -z "$unexpected" ] || fail "Webroot has unrelated files: $unexpected"
else
  [ -f "$STATE/entries" ] && [ -f "$STATE/webroot" ] ||
    fail 'Webroot is not managed by this installer; use install.'
  [ "$(cat "$STATE/webroot")" = "$WEBROOT" ] ||
    fail 'Refusing to change the managed webroot path.'
  entries "$WEBROOT" | while IFS= read -r item; do
    name=$(basename "$item")
    grep -Fxq "$name" "$STATE/entries" ||
      fail "Unexpected webroot entry, refusing update: $item"
  done
fi
mkdir -p "$STATE"
chmod 700 "$STATE"
mkdir "$STATE/.deploy-lock" || fail 'Another deployment is running.'
# Claim ownership only after mkdir succeeded; a failed contender must never
# delete the first deployment's lock in its EXIT handler.
LOCK="$STATE/.deploy-lock"
# Never traverse an unexpected symlink in previously deployed site contents.
[ -z "$(find "$WEBROOT" -path "$WEBROOT/.well-known" -prune -o -type l -print -quit)" ] ||
  fail 'Webroot contains a symlink outside .well-known.'

ensure() {
  if command -v "$1" >/dev/null 2>&1; then return; fi
  command -v apt-get >/dev/null 2>&1 || fail "Missing $1; apt-get unavailable."
  say "Installing missing package for $1: $2"
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$2"
  command -v "$1" >/dev/null 2>&1 || fail "Failed to install $1."
}
ensure git git
ensure curl curl
ensure xz xz-utils
ensure tar tar
ensure sha256sum coreutils
ensure runuser util-linux
ensure useradd passwd
WORK=$(mktemp -d /tmp/rust-signal-selfmask.XXXXXX)

node_usable=0
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  node -e 'let v=process.versions.node.split(".").map(Number);process.exit(v[0]>=24?0:1)' && node_usable=1 || :
fi
if [ "$node_usable" -eq 0 ]; then
  [ ! -L "$RUNTIME" ] || fail 'Symlinked Node.js runtime.'
  if [ ! -x "$RUNTIME/node/bin/node" ] || [ ! -x "$RUNTIME/node/bin/npm" ]; then
    say 'Installing isolated official Node.js 24 (SHA256 verified)'
    case "$(uname -m)" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *)
      fail 'Unsupported Node.js architecture.';; esac
    curl -fsSL --retry 2 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$WORK/SHASUMS256.txt"
    pkg=$(awk -v a="linux-$arch.tar.xz" '$2 ~ ("^node-v[0-9.]+-" a "$") {print $2; exit}' "$WORK/SHASUMS256.txt")
    [ -n "$pkg" ] || fail 'Node.js 24 archive not found.'
    curl -fsSL --retry 2 "https://nodejs.org/dist/latest-v24.x/$pkg" -o "$WORK/$pkg"
    (cd "$WORK" && grep -F "  $pkg" SHASUMS256.txt | sha256sum -c -) ||
      fail 'Node.js checksum mismatch.'
    mkdir -p "$RUNTIME"
    tar -xJf "$WORK/$pkg" -C "$RUNTIME"
    version_dir=$(basename "$pkg" .tar.xz)
    ln -s "$RUNTIME/$version_dir" "$RUNTIME/.node-$$"
    mv -Tf "$RUNTIME/.node-$$" "$RUNTIME/node"
  fi
  chmod 755 "$RUNTIME"
  PATH="$RUNTIME/node/bin:$PATH"
  export PATH
fi
node -e 'let v=process.versions.node.split(".").map(Number);process.exit(v[0]>=24?0:1)' ||
  fail 'Node.js 24+ is required.'
command -v npm >/dev/null 2>&1 || fail 'npm is missing.'

if id rustsignalbuild >/dev/null 2>&1; then
  account=$(getent passwd rustsignalbuild || :)
  case "$account" in *:/nonexistent:*/nologin|*:/nonexistent:*/false) ;; *)
    fail 'Existing rustsignalbuild account is not a restricted build account.';; esac
else
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin rustsignalbuild
fi
chown -R rustsignalbuild "$WORK"
say 'Fetching the latest Rust Signal source as unprivileged user'
runuser -u rustsignalbuild -- env HOME="$WORK" PATH="$PATH" \
  git clone --quiet --depth 1 --single-branch --branch main \
  https://github.com/serbo26-lab/RUST-SIGNAL.git "$WORK/source"
# The clone belongs to rustsignalbuild. Root may trigger Git safe.directory
# ownership protection; read the revision as the repository owner instead.
revision=$(runuser -u rustsignalbuild -- env HOME="$WORK" PATH="$PATH" \
  git -C "$WORK/source" rev-parse --short=12 HEAD)
say "Building commit $revision"
(
  cd "$WORK/source"
  runuser -u rustsignalbuild -- env HOME="$WORK" NPM_CONFIG_CACHE="$WORK/npm-cache" \
    PATH="$PATH" CI=1 npm ci --no-audit --no-fund
  runuser -u rustsignalbuild -- env HOME="$WORK" NPM_CONFIG_CACHE="$WORK/npm-cache" \
    PATH="$PATH" npm run build
)
DIST="$WORK/source/dist"
[ -s "$DIST/index.html" ] && [ -d "$DIST/assets" ] &&
  [ -s "$DIST/remaster/atlas.webp" ] ||
  fail 'Build output incomplete.'
[ -z "$(find "$DIST" -type l -print -quit)" ] || fail 'Refusing symlinks in built website.'
[ ! -e "$DIST/.well-known" ] && [ ! -L "$DIST/.well-known" ] ||
  fail 'Build must not overwrite .well-known.'
entries "$DIST" | while IFS= read -r p; do basename "$p"; done > "$WORK/entries"
grep -Fxq index.html "$WORK/entries" || fail 'Build has no index.'

BACKUP=$(mktemp -d "$BACKUP_PARENT/backup-XXXXXXXX")
mkdir -m 700 "$BACKUP/site"
entries "$WEBROOT" | while IFS= read -r p; do cp -a "$p" "$BACKUP/site/"; done
if [ -f "$STATE/entries" ]; then
  cp "$STATE/entries" "$BACKUP/previous-entries"
  cp "$STATE/webroot" "$BACKUP/previous-webroot"
  if [ -f "$STATE/revision" ]; then
    cp "$STATE/revision" "$BACKUP/previous-revision"
  else
    : > "$BACKUP/previous-revision"
  fi
fi
say "Backed up current site: $BACKUP (ACME directory untouched)"
ACTIVE=1
# Copy assets/pages before replacing the HTML entry point.
entries "$DIST" | while IFS= read -r p; do
  [ "$(basename "$p")" = index.html ] && continue
  cp -a "$p" "$WEBROOT/"
done
cp "$DIST/index.html" "$WEBROOT/.rs-index-$$"
chmod 644 "$WEBROOT/.rs-index-$$"
mv -f "$WEBROOT/.rs-index-$$" "$WEBROOT/index.html"
# Remove only obsolete top-level entries previously managed by us.
if [ -f "$BACKUP/previous-entries" ]; then
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    if ! grep -Fxq "$old" "$WORK/entries"; then
      [ "$old" != .well-known ] || fail 'Invalid previous deployment manifest.'
      rm -rf -- "$WEBROOT/$old"
    fi
  done < "$BACKUP/previous-entries"
fi
# Never touch ownership/permissions under .well-known.
cp "$WORK/entries" "$STATE/.entries-$$"
printf '%s\n' "$WEBROOT" > "$STATE/.webroot-$$"
printf '%s\n' "$revision" > "$STATE/.revision-$$"
chmod 600 "$STATE/.entries-$$" "$STATE/.webroot-$$" "$STATE/.revision-$$"
mv -f "$STATE/.entries-$$" "$STATE/entries"
mv -f "$STATE/.webroot-$$" "$STATE/webroot"
mv -f "$STATE/.revision-$$" "$STATE/revision"
COMMITTED=1
say "Static Rust Signal deployed to $WEBROOT (commit $revision)"
say "Previous website backup: $BACKUP"
say 'Nginx, Telemt, HTTPS, port bindings and .well-known were not changed.'
say 'IMPORTANT: /api/ online leaderboards require a separate reverse-proxy and service setup.'

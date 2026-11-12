#!/bin/sh
# Deliberate replacement of ONE dedicated Nginx domain. Never deletes old webroot.
# Usage: curl -fsSL .../deploy/replace-domain.sh | sudo sh -s -- example.com
set -eu
umask 077
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
say() { printf '\n[Rust Signal replace] %s\n' "$*"; }
[ "$#" -eq 1 ] || fail 'Usage: replace-domain.sh DOMAIN'
[ "$(id -u)" -eq 0 ] || fail 'Root privileges required.'
[ "$(uname -s)" = Linux ] || fail 'Replacement requires Linux/systemd.'
DOMAIN=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
case "$DOMAIN" in *[!a-z0-9.-]*|.*|*..*|*-|*-.*|*.-*|*.) fail 'Invalid domain';; esac
case "$DOMAIN" in *.*) ;; *) fail 'Domain needs a dot.';; esac
[ "$(expr length "$DOMAIN")" -le 253 ] || fail 'Domain too long.'
oldIFS=$IFS; IFS=.
for label in $DOMAIN; do
  [ -n "$label" ] && [ "$(expr length "$label")" -le 63 ] || fail 'Invalid DNS label.'
  case "$label" in -*|*-) fail 'Invalid DNS label.';; esac
done
IFS=$oldIFS
NGINX=/etc/nginx
STATE=/var/lib/rust-signal
MANAGED=$NGINX/conf.d/rust-signal.conf
WORK=''
BACKUP=''
ORIGINAL=''
DISABLED=0
COMPLETE=0
cleanup() {
  status=$?
  trap - 0
  if [ "$COMPLETE" -eq 0 ] && [ "$DISABLED" -eq 1 ]; then
    say 'Restoring all previously enabled Nginx site files'
    if [ -f "$MANAGED" ] && grep -q '^# Rust Signal managed vhost' "$MANAGED"; then
      rm -f "$MANAGED" || :
    fi
    if [ -f "$BACKUP/original-paths.txt" ]; then
      index=0
      while IFS= read -r previous; do
        index=$((index+1))
        if [ -e "$BACKUP/disabled-$index" ] || [ -L "$BACKUP/disabled-$index" ]; then
          if [ ! -e "$previous" ] && [ ! -L "$previous" ]; then
            mv "$BACKUP/disabled-$index" "$previous" || :
          else
            printf 'ERROR: Nginx path unexpectedly occupied: %s\n' "$previous" >&2
          fi
        fi
      done < "$BACKUP/original-paths.txt"
    fi
    if [ -f "$STATE/domain" ] && [ "$(cat "$STATE/domain")" = "$DOMAIN" ]; then
      rm -f "$STATE/domain" "$STATE/revision" || :
    fi
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx >/dev/null 2>&1 || :
    else
      printf 'ERROR: Nginx rollback validation failed; backup at %s\n' "$BACKUP" >&2
    fi
  fi
  [ -z "$WORK" ] || rm -rf "$WORK"
  exit "$status"
}
trap cleanup 0
trap 'exit 1' 1 2 3 15
[ -f "$NGINX/nginx.conf" ] || fail 'Nginx configuration missing.'
[ ! -f "$STATE/domain" ] || fail 'Rust Signal already installed; use update.'
[ ! -e "$MANAGED" ] && [ ! -L "$MANAGED" ] || fail 'Rust Signal vhost already exists.'
command -v nginx >/dev/null 2>&1 || fail 'Nginx is missing.'
command -v curl >/dev/null 2>&1 || fail 'curl is missing.'
command -v python3 >/dev/null 2>&1 || fail 'Python 3 is required for safe Nginx vhost parsing.'
command -v systemctl >/dev/null 2>&1 || fail 'systemd is missing.'
systemctl is-active --quiet nginx || fail 'Nginx must already be running.'
nginx -t >/dev/null 2>&1 || fail 'Existing Nginx configuration is invalid.'
WORK=$(mktemp -d /tmp/rust-signal-replace.XXXXXX)
nginx -T > "$WORK/nginx-dump" 2>&1 || fail 'Cannot inspect Nginx.'
# nginx -T identifies the actual loaded configuration file before each block.
# Read server_name as a directive (including inline and multi-line forms).
awk '
  /^# configuration file / {
    file=$0
    sub(/^# configuration file /,"",file)
    sub(/:$/,"",file)
    buf=""
    next
  }
  {
    line=$0
    sub(/#.*/,"",line)
    buf=buf " " line
    while ((semi=index(buf,";"))>0) {
      stmt=substr(buf,1,semi-1)
      gsub(/[{}]/," ",stmt)
      sub(/^[[:space:]]+/,"",stmt)
      if(stmt~/^server_name[[:space:]]+/){
        sub(/^server_name[[:space:]]+/,"",stmt)
        n=split(stmt,names,/[[:space:]]+/)
        for(i=1;i<=n;i++) if(names[i]!="") print file "\t" names[i]
      }
      buf=substr(buf,semi+1)
    }
  }
' "$WORK/nginx-dump" > "$WORK/names"
# HTTP and HTTPS may be in separate dedicated Nginx files.
# Enumerate all exact matching vhosts, but never disable a shared config.
awk -F '\t' -v d="$DOMAIN" '$2==d {print $1}' "$WORK/names" |
  sort -u > "$WORK/candidates"
[ -s "$WORK/candidates" ] ||
  fail 'Explicit server_name not found. Default/wildcard hosts require manual migration.'
count=$(wc -l < "$WORK/candidates")
[ "$count" -le 8 ] || fail 'More than eight Nginx files claim this domain; manual migration required.'

while IFS= read -r original; do
  # Nginx may load a dedicated site from any pathname, not necessarily
  # sites-enabled/ or conf.d/. Trust nginx -T provenance and validate content,
  # but never move the main Nginx config itself.
  case "$original" in /*) ;; *) fail "Non-absolute loaded Nginx file path: $original";; esac
  [ "$original" != "$NGINX/nginx.conf" ] ||
    fail 'Refusing to replace the main Nginx configuration.'
  [ "$original" != "$MANAGED" ] && [ -f "$original" ] && [ -r "$original" ] ||
    fail "Cannot safely read dedicated Nginx virtual host: $original"
  awk -F '\t' -v f="$original" -v d="$DOMAIN" '$1==f && $2!=d {exit 1}' "$WORK/names" ||
    fail "File also serves another domain; refusing to disable: $original"
  if sed 's/#.*//' "$original" |
     grep -Eq '(^|[[:space:]])(upstream|map|geo|log_format|split_clients)[[:space:]]'; then
    fail "Selected file contains shared Nginx directives: $original"
  fi
  if grep -Eq 'listen[[:space:]]+[^;]*default_server' "$original"; then
    fail "The site is a default_server: $original. Manual migration is required to preserve other traffic."
  fi
  blocks=$(sed 's/#.*//' "$original" |
    grep -Ec '(^|[[:space:]])server[[:space:]]*\{' || :)
  owned=$(awk -F '\t' -v f="$original" -v d="$DOMAIN" \
    '$1==f && $2==d {n++} END {print n+0}' "$WORK/names")
  [ "$blocks" -gt 0 ] && [ "$blocks" -eq "$owned" ] ||
    fail "Cannot prove every server block belongs only to $DOMAIN: $original"
done < "$WORK/candidates"

# Detect wildcards and regexes outside the selected vhosts.
awk -F '\t' -v d="$DOMAIN" '
  function ends(name,suf){return length(name)>=length(suf) && substr(name,length(name)-length(suf)+1)==suf}
  NR==FNR {selected[$0]=1; next}
  !($1 in selected) {
    n=$2
    if (substr(n,1,1)=="~") exit 1
    if (n==d || (substr(n,1,2)=="*." && ends(d,substr(n,2))) ||
        (substr(n,1,1)=="." && (d==substr(n,2) || ends(d,n))) ||
        (substr(n,length(n)-1)==".*" && substr(d,1,length(n)-1)==substr(n,1,length(n)-1))) exit 1
  }
' "$WORK/candidates" "$WORK/names" || fail 'Another virtual host or wildcard may also claim this domain.'

# Preserve each original listener, including nonstandard HTTP and TLS ports.
# Never invent a public 443 or change loopback bindings during replacement.
curl -fsSL --retry 2 https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o "$WORK/vps.sh"
curl -fsSL --retry 2 https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/render-replacement.py -o "$WORK/render-replacement.py"
curl -fsSL --retry 2 https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/nginx-site.conf.template -o "$WORK/nginx-site.conf.template"
sh -n "$WORK/vps.sh" || fail 'Downloaded installer has a syntax error.'
python3 -I "$WORK/render-replacement.py" "$DOMAIN" "$WORK/candidates" \
  "$WORK/nginx-site.conf.template" /var/www/rust-signal/current \
  "$WORK/replacement.conf" ||
  fail 'Cannot safely retain the existing Nginx listeners/TLS settings.'

mkdir -p /var/backups/rust-signal
chmod 700 /var/backups/rust-signal
BACKUP=/var/backups/rust-signal/replaced-$(date -u +%Y%m%dT%H%M%SZ)-$$
mkdir -m 700 "$BACKUP"
cp "$WORK/candidates" "$BACKUP/original-paths.txt"
printf '%s\n' "$DOMAIN" > "$BACKUP/domain.txt"
index=0
while IFS= read -r original; do
  index=$((index+1))
  # Keep the original symlinks plus exact copies of all config contents.
  if [ "$index" -eq 1 ]; then
    cp -pL "$original" "$BACKUP/original.conf"
    printf '%s\n' "$original" > "$BACKUP/original-path.txt"
  else
    cp -pL "$original" "$BACKUP/original-$index.conf"
  fi
done < "$BACKUP/original-paths.txt"
say "Backed up all $count Nginx vhost file(s): $BACKUP"
# Workers continue serving the old website until Nginx reload.
DISABLED=1
index=0
while IFS= read -r original; do
  index=$((index+1))
  mv "$original" "$BACKUP/disabled-$index"
done < "$BACKUP/original-paths.txt"
nginx -t >/dev/null 2>&1 ||
  fail 'Removing the old Nginx vhosts broke another site; all files will be restored.'

RUST_SIGNAL_REPLACEMENT_CONFIG="$WORK/replacement.conf" \
  sh "$WORK/vps.sh" install "$DOMAIN" || fail 'New game install failed; previous site restored.'
COMPLETE=1
say "Rust Signal now serves $DOMAIN."
say "Original Nginx config is saved at $BACKUP/original.conf"
say 'Original website files and other domains were not deleted.'

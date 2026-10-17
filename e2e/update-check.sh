#!/usr/bin/env bash
# Exercise the real updater with temporary paths and fake network/systemd boundaries.
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_ROOT=$(mktemp -d)
export TEST_ROOT
trap 'rm -rf -- "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/agent" "$TEST_ROOT/config"
sed -e 's|^DIR=/opt/vps-agent$|DIR="$TEST_ROOT/agent"|' \
    -e 's|^CONFIG=/etc/vps-agent$|CONFIG="$TEST_ROOT/config"|' \
    -e 's/\[\[ \$EUID -eq 0 \&\& /[[ /' agent/update.sh > "$TEST_ROOT/update.sh"
printf 'VPS_AGENT_BIND=127.0.0.1:18710\n' > "$TEST_ROOT/config/environment"
printf '%064d' 1 > "$TEST_ROOT/config/token"
printf 'good original\n' > "$TEST_ROOT/agent/vps-agent"
cat > "$TEST_ROOT/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
dest= url=
while [[ $# -gt 0 ]]; do
  case "$1" in -o) dest=$2; shift 2 ;; https://*) url=$1; shift ;; *) shift ;; esac
done
if [[ "$url" == *.sha256 ]]; then cp "$TEST_ROOT/checksum" "$dest"
elif [[ -n "$url" ]]; then cp "$TEST_ROOT/candidate" "$dest"
else cat >/dev/null; ! grep -q bad "$TEST_ROOT/agent/vps-agent"
fi
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_ROOT/bin/systemctl"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_ROOT/bin/sleep"
# flock is unavailable on Git Bash; locking itself is exercised by Linux integration.
if ! command -v flock >/dev/null; then printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_ROOT/bin/flock"; fi
chmod +x "$TEST_ROOT/bin/"*
export PATH="$TEST_ROOT/bin:$PATH"
candidate() {
  printf '\177ELF\002\001\000\000\000\000\000\000\000\000\000\000\000\000' > "$TEST_ROOT/candidate"
  case "$(uname -m)" in x86_64) printf '\076\000' ;; aarch64|arm64) printf '\267\000' ;; *) exit 1 ;; esac >> "$TEST_ROOT/candidate"
  printf '%s\n' "$1" >> "$TEST_ROOT/candidate"
}
candidate 'bad candidate'
sha256sum "$TEST_ROOT/candidate" > "$TEST_ROOT/checksum"
if bash "$TEST_ROOT/update.sh" update; then echo 'Unhealthy update unexpectedly succeeded' >&2; exit 1; fi
[[ $(cat "$TEST_ROOT/agent/vps-agent") == 'good original' ]]
grep -q 'original binary restored and healthy' "$TEST_ROOT/agent/update-status.json"
candidate 'good update'
# A bad checksum must leave the current executable untouched.
if bash "$TEST_ROOT/update.sh" update; then echo 'Checksum mismatch unexpectedly accepted' >&2; exit 1; fi
[[ $(cat "$TEST_ROOT/agent/vps-agent") == 'good original' ]]
sha256sum "$TEST_ROOT/candidate" > "$TEST_ROOT/checksum"
bash "$TEST_ROOT/update.sh" update
grep -q 'good update' "$TEST_ROOT/agent/vps-agent"
[[ $(cat "$TEST_ROOT/agent/vps-agent.previous") == 'good original' ]]
bash "$TEST_ROOT/update.sh" rollback
[[ $(cat "$TEST_ROOT/agent/vps-agent") == 'good original' ]]
grep -q rolled_back "$TEST_ROOT/agent/update-status.json"
printf 'PASS: checksum rejection, failed-health restoration, successful update and explicit rollback\n'

#!/usr/bin/env bash
# Fixed-origin updater, launched only by vps-agent-update@.service.
set -euo pipefail
umask 077
DIR=/opt/vps-agent
CONFIG=/etc/vps-agent
ACTION=${1:-update}
[[ $EUID -eq 0 && "$ACTION" =~ ^(update|rollback)$ ]] || exit 1
exec 9>"$DIR/update.lock"
flock -n 9 || exit 1
WORK=$(mktemp -d "$DIR/.update-XXXXXX")
SWAPPED=0
cleanup() {
  local code=$?
  trap - EXIT
  if [[ $SWAPPED == 1 && -f "$WORK/original" ]]; then
    mv -f "$WORK/original" "$DIR/vps-agent"
    if systemctl restart vps-agent && health; then status failed 'Interrupted maintenance; original restored and healthy'; else status failed 'Interrupted maintenance; original restored; check service health'; fi
  fi
  rm -rf -- "$WORK"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
status() { printf '{"state":"%s","output":"%s"}\n' "$1" "$2" > "$DIR/update-status.json.new"; mv -f "$DIR/update-status.json.new" "$DIR/update-status.json"; }
health() {
  local bind token
  bind=$(sed -n 's/^VPS_AGENT_BIND=//p' "$CONFIG/environment")
  [[ "$bind" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+$ ]] || return 1
  [[ "$bind" != 0.0.0.0:* ]] || bind="127.0.0.1:${bind##*:}"
  token=$(cat "$CONFIG/token")
  # Send the secret through stdin rather than process arguments or logs.
  [[ -n "$token" && ${#token} -le 4096 && "$token" != *$'\n'* && "$token" != *$'\r'* ]] || return 1
  for ((i=0;i<15;i++)); do
    if systemctl is-active --quiet vps-agent && printf 'Authorization: Bearer %s\n' "$token" | curl --header @- --fail --silent --output /dev/null --max-time 2 "http://$bind/api/info"; then return 0; fi
    sleep 1
  done
  return 1
}
status running 'Maintenance in progress'
fail() { status failed "$1"; exit 1; }
case "$(uname -m)" in x86_64) ARCH=x86_64 ;; aarch64|arm64) ARCH=aarch64 ;; *) fail 'Unsupported architecture' ;; esac
if [[ "$ACTION" == update ]]; then
  URL=https://github.com/wignn/catly/releases/latest/download
  ASSET="vps-agent-linux-$ARCH"
  fetch() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --max-time 60 --retry 2 "$1" -o "$2"; }
  fetch "$URL/$ASSET" "$WORK/candidate" || fail 'Binary download failed'
  fetch "$URL/$ASSET.sha256" "$WORK/checksum" || fail 'Checksum download failed'
  EXPECTED=$(awk 'NR==1 {print $1}' "$WORK/checksum")
  [[ "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Invalid checksum'
  ACTUAL=$(sha256sum "$WORK/candidate")
  [[ "${ACTUAL%% *}" == "${EXPECTED,,}" ]] || fail 'Checksum mismatch; binary unchanged'
  MAGIC=$(od -An -tx1 -N6 "$WORK/candidate" | tr -d ' \n')
  MACHINE=$(od -An -tx1 -j18 -N2 "$WORK/candidate" | tr -d ' \n')
  [[ "$MAGIC" == 7f454c460201 ]] || fail 'Expected little-endian 64-bit ELF binary'
  [[ "$ARCH:$MACHINE" == x86_64:3e00 || "$ARCH:$MACHINE" == aarch64:b700 ]] || fail 'Binary architecture mismatch'
else
  [[ -f "$DIR/vps-agent.previous" && ! -L "$DIR/vps-agent.previous" ]] || fail 'No previous binary'
  cp "$DIR/vps-agent.previous" "$WORK/candidate" || fail 'Cannot stage previous binary'
fi
[[ -f "$DIR/vps-agent" && ! -L "$DIR/vps-agent" ]] || fail 'Installed binary is not a regular file'
cp "$DIR/vps-agent" "$WORK/original" || fail 'Cannot preserve current binary'
install -m 755 "$WORK/original" "$DIR/vps-agent.previous.new"
mv -f "$DIR/vps-agent.previous.new" "$DIR/vps-agent.previous"
chmod 755 "$WORK/candidate"
SWAPPED=1
mv -f "$WORK/candidate" "$DIR/vps-agent" || fail 'Cannot replace binary'
if systemctl restart vps-agent && health; then
  if [[ "$ACTION" == update ]]; then status updated 'Update passed health check'; else status rolled_back 'Previous binary restored and healthy'; fi
  SWAPPED=0
else
  mv -f "$WORK/original" "$DIR/vps-agent"
  SWAPPED=0
  if systemctl restart vps-agent && health; then
    status failed 'Candidate failed health check; original binary restored and healthy'
  else
    status failed 'Candidate failed; original restored but service health failed'
  fi
  exit 1
fi

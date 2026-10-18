#!/usr/bin/env bash
# Local: sudo bash install.sh ./vps-agent
# Remote: curl -fsSL "$URL/install.sh" | sudo bash -s -- --release-url "$URL"
set -euo pipefail
umask 077
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Linux ]] || fail 'Linux with systemd is required.'
[[ $EUID -eq 0 ]] || fail 'Run the installer with sudo.'
command -v systemctl >/dev/null || fail 'systemd was not found.'
BIND="${VPS_AGENT_BIND:-127.0.0.1:18710}"
if [[ -z "${VPS_AGENT_BIND:-}" && ! -f /etc/vps-agent/environment ]] && command -v tailscale >/dev/null; then
  TAILSCALE_IP=$(tailscale ip -4 2>/dev/null | head -n 1 || true)
  if [[ "$TAILSCALE_IP" =~ ^100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then BIND="$TAILSCALE_IP:18710"; fi
fi
[[ "$BIND" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+$ ]] || fail 'VPS_AGENT_BIND must use IPv4:port.'
IFS='.' read -r -a OCTETS <<< "${BIND%:*}"
[[ ${#OCTETS[@]} -eq 4 ]] || fail 'Invalid IPv4 address.'
for OCTET in "${OCTETS[@]}"; do
  [[ "$OCTET" =~ ^[0-9]{1,3}$ ]] && (( 10#$OCTET <= 255 )) || fail 'Invalid IPv4 address.'
done
PORT="${BIND##*:}"
[[ ${#PORT} -le 5 ]] && (( 10#$PORT >= 1 && 10#$PORT <= 65535 )) || fail 'Port must be 1-65535.'
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
if [[ $# -eq 0 ]]; then
  set -- --release-url 'https://github.com/wignn/catly/releases/latest/download'
fi
if [[ "${1:-}" == --release-url ]]; then
  RELEASE_URL="${2:-}"
  [[ "$RELEASE_URL" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?(/[a-zA-Z0-9._~/-]*)?$ ]] || fail 'Invalid HTTPS release URL.'
  command -v curl >/dev/null || fail 'curl is required.'
  command -v sha256sum >/dev/null || fail 'sha256sum is required.'
  case "$(uname -m)" in
    x86_64) ARCH=x86_64 ;;
    aarch64|arm64) ARCH=aarch64 ;;
    *) fail 'Unsupported architecture. Use a local binary.' ;;
  esac
  ASSET="vps-agent-linux-$ARCH"
  fetch() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 3 "$1" -o "$2"; }
  fetch "${RELEASE_URL%/}/$ASSET" "$WORK/$ASSET"
  fetch "${RELEASE_URL%/}/$ASSET.sha256" "$WORK/checksum"
  EXPECTED=$(awk 'NR==1 {print $1}' "$WORK/checksum")
  [[ "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Invalid checksum format.'
  ACTUAL=$(sha256sum "$WORK/$ASSET")
  [[ "${ACTUAL%% *}" == "${EXPECTED,,}" ]] || fail 'Checksum mismatch. Installation canceled.'
  BIN_SRC="$WORK/$ASSET"
else
  BIN_SRC="${1:-./vps-agent}"
fi
[[ -f "$BIN_SRC" ]] || fail "Binary not found: $BIN_SRC"
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)
fi
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/update.sh" ]]; then
  UPDATER="$SCRIPT_DIR/update.sh"
else
  command -v curl >/dev/null || fail 'curl is required for the updater.'
  UPDATER="$WORK/update.sh"
  UPDATE_URL="${RELEASE_URL:-https://github.com/wignn/catly/releases/latest/download}"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "$UPDATE_URL/update.sh" -o "$UPDATER"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "$UPDATE_URL/update.sh.sha256" -o "$WORK/update.sha256"
  EXPECTED=$(awk 'NR==1 {print $1}' "$WORK/update.sha256")
  [[ "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Invalid updater checksum.'
  ACTUAL=$(sha256sum "$UPDATER")
  [[ "${ACTUAL%% *}" == "${EXPECTED,,}" ]] || fail 'Updater checksum mismatch.'
fi
install -d -m 755 /opt/vps-agent
install -d -m 700 /etc/vps-agent
if [[ ! -s /etc/vps-agent/token ]]; then
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > /etc/vps-agent/token
fi
chmod 600 /etc/vps-agent/token
install -m 700 "$UPDATER" /opt/vps-agent/update.sh.new
mv -f /opt/vps-agent/update.sh.new /opt/vps-agent/update.sh
install -m 755 "$BIN_SRC" /opt/vps-agent/vps-agent.new
mv -f /opt/vps-agent/vps-agent.new /opt/vps-agent/vps-agent
install -d -m 755 /usr/local/bin
ln -sfn /opt/vps-agent/vps-agent /usr/local/bin/vps-agent
# Preserve the configured bind address on upgrades.
if [[ ! -f /etc/vps-agent/environment || -n "${VPS_AGENT_BIND:-}" ]]; then
  printf 'VPS_AGENT_BIND=%s\n' "$BIND" > /etc/vps-agent/environment
fi
cat > /etc/systemd/system/vps-agent.service <<'UNIT'
[Unit]
Description=VPS Manager Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=/etc/vps-agent/environment
ExecStart=/opt/vps-agent/vps-agent
Restart=on-failure
RestartSec=3
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
ReadWritePaths=/etc/vps-agent /opt/vps-agent

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/vps-agent-update@.service <<'UNIT'
[Unit]
Description=VPS Agent maintenance (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
ExecStart=/bin/bash /opt/vps-agent/update.sh %i
TimeoutStartSec=600
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/etc/vps-agent /opt/vps-agent
UNIT
systemctl daemon-reload
systemctl enable vps-agent
systemctl restart vps-agent
sleep 1
systemctl is-active --quiet vps-agent || fail 'Agent failed to start. Check: journalctl -u vps-agent -n 50'
printf '\nvps-agent is running. Configuration: /etc/vps-agent/environment\nBinary: /usr/local/bin/vps-agent\nToken for the client:\n'
cat /etc/vps-agent/token
printf '\n\nThe existing token is preserved during upgrades.\n'
printf 'New installations use an active Tailscale IP or loopback. Upgrades preserve the bind address.\n'

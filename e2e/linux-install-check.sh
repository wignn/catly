#!/usr/bin/env bash
# Run as root on a disposable Linux systemd machine; installs the real service.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=${1:?Usage: sudo bash e2e/linux-install-check.sh path/to/vps-agent}
bash agent/install.sh "$BIN"
systemctl is-enabled --quiet vps-agent
systemctl is-active --quiet vps-agent
[[ $(readlink -f /usr/local/bin/vps-agent) == /opt/vps-agent/vps-agent ]]
[[ -x /usr/local/bin/vps-agent ]]
TOKEN=$(cat /etc/vps-agent/token)
[[ "$TOKEN" =~ ^[a-f0-9]{64}$ ]]
[[ $(stat -c '%a' /etc/vps-agent/token) == 600 ]]
curl --fail --silent --show-error --retry 5 --retry-connrefused \
  -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18710/api/info >/dev/null
# An explicit bind override must survive a subsequent normal upgrade.
VPS_AGENT_BIND=127.0.0.1:18711 bash agent/install.sh "$BIN"
bash agent/install.sh "$BIN"
[[ $(cat /etc/vps-agent/token) == "$TOKEN" ]]
[[ $(cat /etc/vps-agent/environment) == VPS_AGENT_BIND=127.0.0.1:18711 ]]
curl --fail --silent --show-error --retry 5 --retry-connrefused \
  -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18711/api/info >/dev/null
printf 'PASS: binary, enabled service, API authentication, token and bind preserved on upgrade\n'

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
BASE=http://127.0.0.1:18711
READONLY=$(curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"kind":"readonly"}' "$BASE/api/security/rotate" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
[[ $(stat -c '%a' /etc/vps-agent/readonly-token) == 600 ]]
for path in info metrics services diagnostics update/status; do
  [[ $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $READONLY" "$BASE/api/$path") == 200 ]]
done
for path in files files/read net processes security/audit; do
  [[ $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $READONLY" "$BASE/api/$path") == 403 ]]
done
[[ $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $READONLY" -H 'Content-Type: application/json' -d '{"command":"echo forbidden"}' "$BASE/api/exec") == 403 ]]
OLD_TOKEN=$TOKEN
TOKEN=$(curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"kind":"admin"}' "$BASE/api/security/rotate" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
[[ $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $OLD_TOKEN" "$BASE/api/info") == 401 ]]
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/diagnostics" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["role"]=="admin" and d["bind"]=="127.0.0.1:18711"'
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/security/audit" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["entries"]; assert all(set(e)=={"ts","method","path","status","role"} for e in d["entries"]); assert any(e["path"]=="/api/security/rotate" for e in d["entries"])'
# New WebSocket upgrades use the rotated token; readonly cannot open privileged sockets.
ws_status() { curl -s --max-time 1 -o /dev/null -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$BASE/ws/$1?token=$2&unit=ssh.service" || true; }
[[ $(ws_status metrics "$OLD_TOKEN") == 401 ]]
[[ $(ws_status metrics "$TOKEN") == 101 ]]
[[ $(ws_status metrics "$READONLY") == 101 ]]
[[ $(ws_status pty "$READONLY") == 401 ]]
[[ $(ws_status logs "$READONLY") == 401 ]]
systemctl restart vps-agent
sleep 1
[[ $(cat /etc/vps-agent/token) == "$TOKEN" ]]
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/info" >/dev/null
printf 'PASS: binary, enabled service, API authentication, token and bind preserved on upgrade\n'

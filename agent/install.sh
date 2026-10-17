#!/usr/bin/env bash
# Local: sudo bash install.sh ./vps-agent
# Remote: curl -fsSL "$URL/install.sh" | sudo bash -s -- --release-url "$URL"
set -euo pipefail
umask 077
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Linux ]] || fail 'Linux dengan systemd diperlukan.'
[[ $EUID -eq 0 ]] || fail 'Jalankan installer dengan sudo.'
command -v systemctl >/dev/null || fail 'systemd tidak ditemukan.'
BIND="${VPS_AGENT_BIND:-127.0.0.1:18710}"
[[ "$BIND" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+$ ]] || fail 'VPS_AGENT_BIND harus berupa IPv4:port.'
IFS='.' read -r -a OCTETS <<< "${BIND%:*}"
[[ ${#OCTETS[@]} -eq 4 ]] || fail 'IPv4 tidak valid.'
for OCTET in "${OCTETS[@]}"; do
  [[ "$OCTET" =~ ^[0-9]{1,3}$ ]] && (( 10#$OCTET <= 255 )) || fail 'IPv4 tidak valid.'
done
PORT="${BIND##*:}"
[[ ${#PORT} -le 5 ]] && (( 10#$PORT >= 1 && 10#$PORT <= 65535 )) || fail 'Port harus 1-65535.'
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
if [[ "${1:-}" == --release-url ]]; then
  RELEASE_URL="${2:-}"
  [[ "$RELEASE_URL" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?(/[a-zA-Z0-9._~/-]*)?$ ]] || fail 'URL rilis HTTPS tidak valid.'
  command -v curl >/dev/null || fail 'curl diperlukan.'
  command -v sha256sum >/dev/null || fail 'sha256sum diperlukan.'
  case "$(uname -m)" in
    x86_64) ARCH=x86_64 ;;
    aarch64|arm64) ARCH=aarch64 ;;
    *) fail 'Arsitektur belum didukung. Gunakan binary lokal.' ;;
  esac
  ASSET="vps-agent-linux-$ARCH"
  fetch() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 3 "$1" -o "$2"; }
  fetch "${RELEASE_URL%/}/$ASSET" "$WORK/$ASSET"
  fetch "${RELEASE_URL%/}/$ASSET.sha256" "$WORK/checksum"
  EXPECTED=$(awk 'NR==1 {print $1}' "$WORK/checksum")
  [[ "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Format checksum tidak valid.'
  ACTUAL=$(sha256sum "$WORK/$ASSET")
  [[ "${ACTUAL%% *}" == "${EXPECTED,,}" ]] || fail 'Checksum tidak cocok. Instalasi dibatalkan.'
  BIN_SRC="$WORK/$ASSET"
else
  BIN_SRC="${1:-./vps-agent}"
fi
[[ -f "$BIN_SRC" ]] || fail "Binary tidak ditemukan: $BIN_SRC"
install -d -m 755 /opt/vps-agent
install -d -m 700 /etc/vps-agent
if [[ ! -s /etc/vps-agent/token ]]; then
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > /etc/vps-agent/token
fi
chmod 600 /etc/vps-agent/token
install -m 755 "$BIN_SRC" /opt/vps-agent/vps-agent.new
mv -f /opt/vps-agent/vps-agent.new /opt/vps-agent/vps-agent
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
systemctl daemon-reload
systemctl enable vps-agent
systemctl restart vps-agent
sleep 1
systemctl is-active --quiet vps-agent || fail 'Agent gagal berjalan. Periksa: journalctl -u vps-agent -n 50'
printf '\nvps-agent aktif. Konfigurasi: /etc/vps-agent/environment\nToken untuk client:\n'
cat /etc/vps-agent/token
printf '\n\nToken lama dipertahankan saat upgrade.\n'
printf 'Untuk Tailscale, set VPS_AGENT_BIND ke IP Tailscale:18710 di /etc/vps-agent/environment lalu restart service.\n'

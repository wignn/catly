# Protokol Agent ↔ Client (v1)

Agent: HTTP + WebSocket di satu port (default `18710`). Semua request butuh autentikasi.

## Autentikasi

- HTTP: header `Authorization: Bearer <token>`
- WebSocket: query param `?token=<token>` (header tidak bisa di-set dari browser/xterm WS)
- Token: dibuat saat instalasi agent, disimpan di server (`/etc/vps-agent/token`,
  mode 0600). Client menyimpan token per server di SQLite lokal (Windows).
- Tanpa token valid → `401 Unauthorized` (HTTP) / koneksi WS langsung ditutup.

> Catatan keamanan: selalu akses via Tailscale (jaringan privat). Untuk akses via
> internet publik, pasang reverse proxy TLS di depan agent (Caddy/nginx).

## REST

### `GET /api/info`
```json
{ "hostname": "vm-0-9", "os": "Ubuntu 24.04", "kernel": "6.8.0-...", "arch": "x86_64",
  "uptime_secs": 123456, "agent_version": "0.1.0" }
```

### `GET /api/metrics` — snapshot sekali ambil
```json
{
  "ts": 1729000000,
  "cpu": { "total": 23.5, "per_core": [12.1, 34.9] },
  "load": [0.42, 0.35, 0.31],
  "mem":  { "total": 8245489664, "used": 3012345678, "free": 5233143986, "available": 6000000000 },
  "swap": { "total": 2147483648, "used": 0 },
  "disks": [ { "mount": "/", "total": 53687091200, "used": 12345678900 } ],
  "net": [ { "iface": "eth0", "rx_bytes": 1234, "tx_bytes": 5678,
             "rx_rate": 1024.5, "tx_rate": 512.25 } ]
}
```
`rx_rate`/`tx_rate` = byte/detik, dihitung agent dari delta antar sampel.

### `POST /api/exec` — jalankan satu perintah (non-interaktif)
Request: `{ "command": "df -h", "timeout_secs": 30 }`
Response: `{ "stdout": "...", "stderr": "...", "exit_code": 0, "timed_out": false }`
Dipakai untuk "perintah bersama" dan aksi cepat.

### `GET /api/processes?limit=200&sort=cpu`
```json
{ "processes": [ { "pid": 1234, "user": "root", "name": "nginx",
  "cpu": 1.2, "mem": 0.5, "cmd": "nginx: worker process" } ] }
```

### `POST /api/processes/kill` — `{ "pid": 1234, "signal": "TERM" }`
Response: `{ "ok": true }` atau `{ "ok": false, "error": "..." }`.
Client WAJIB minta konfirmasi sebelum memanggil ini.

### `GET /api/services` (systemd)
```json
{ "services": [ { "unit": "nginx.service", "load": "loaded",
  "active": "active", "sub": "running", "description": "..." } ] }
```

### `POST /api/services/action` — `{ "unit": "nginx.service", "action": "restart" }`
`action`: `start` | `stop` | `restart` | `reload`. Response `{ "ok": true }`.

### `GET /api/net` — info jaringan
```json
{ "public_ip": "43.134.104.71",
  "interfaces": [ { "name": "eth0", "addrs": ["10.0.0.5/24"], "mac": "..." } ],
  "listening": [ { "proto": "tcp", "local": "0.0.0.0:22", "process": "sshd" } ],
  "connections": [ { "proto": "tcp", "local": "...", "remote": "...", "state": "ESTABLISHED" } ] }
```

### File manager
- `GET /api/files?path=/etc/nginx` → `{ "path": "...", "entries": [
  { "name": "nginx.conf", "kind": "file", "size": 1234, "mode": "644",
    "owner": "root", "group": "root", "modified": 1729000000 } ] }`
- `GET /api/files/read?path=/etc/nginx/nginx.conf` → `{ "content": "..." }`
  (dibatasi 2 MB; file biner ditolak)
- `POST /api/files/write` → `{ "path": "...", "content": "..." }` → `{ "ok": true }`
- `GET /api/files/download?path=...` → stream bytes (attachment)
- `POST /api/files/upload?path=/tmp/` → multipart form, field `file`

## WebSocket

### `WS /ws/metrics` — stream metrik tiap 1 detik
Setiap pesan = satu objek JSON sama seperti `GET /api/metrics`.
Client yang baru connect langsung dapat snapshot pertama.

### `WS /ws/pty?cols=120&rows=30` — terminal interaktif (PT Y)
Satu koneksi WS = satu sesi PTY (`$SHELL` atau `/bin/bash --login`).
Pesan client → server (JSON text frame):
- `{ "t": "input", "data": "ls\n" }` — ketikan keyboard (sudah termasuk escape sequence)
- `{ "t": "resize", "cols": 120, "rows": 30 }`

Pesan server → client:
- `{ "t": "output", "data": "\u001b[32m...\u001b[0m" }` — bytes mentah PTY (ANSI)
- `{ "t": "exit", "code": 0 }` — shell keluar; server lalu menutup WS

Binary frame tidak dipakai; semua JSON text frame.

### `WS /ws/logs?unit=nginx.service` — tail log systemd
Server menjalankan `journalctl -u <unit> -f -n 100 --no-pager -o cat`,
setiap baris dikirim sebagai `{ "t": "line", "data": "..." }`.

## Kode error
- `401` — token salah/hilang
- `403` — path di luar batas yang diizinkan (file manager menolak `..` lolos root)
- `404` — endpoint/unit/path tidak ada
- `422` — body JSON tidak valid
- `500` — `{ "error": "pesan" }`

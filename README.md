# VPS Manager

Konsol desktop Windows untuk mengelola koneksi VPS, memantau resource, dan membuka terminal multi-tab dengan split panel. Client menggunakan Tauri, React, dan TypeScript; agent menggunakan Rust.

## Instalasi

Installer memerlukan folder rilis HTTPS berisi paket dan checksum (lihat [panduan rilis](docs/RELEASING.md)). Ganti URL contoh dengan lokasi rilis milikmu; proyek ini belum menyediakan hosting unduhan resmi.

### Agent Linux

Ubuntu/Debian dengan systemd, `curl`, dan coreutils. Mendukung x86_64 dan aarch64 sesuai binary yang diterbitkan.

```bash
RELEASE_URL='https://HOST-KAMU/releases/v0.1.0'
curl -fsSL "$RELEASE_URL/install.sh" | sudo bash -s -- --release-url "$RELEASE_URL"
```

Installer memeriksa SHA-256, memasang service, dan mencetak token. Saat upgrade, token dan alamat bind yang sudah dikonfigurasi dipertahankan. Instalasi baru hanya mendengarkan di `127.0.0.1:18710`.

Untuk menghubungkan client melalui Tailscale, edit `/etc/vps-agent/environment`:

```ini
VPS_AGENT_BIND=100.64.0.12:18710
```

Gunakan IP Tailscale VPS milikmu, kemudian jalankan `sudo systemctl restart vps-agent`. Periksa service dengan `sudo systemctl status vps-agent` dan log dengan `sudo journalctl -u vps-agent -n 50`.

### Aplikasi Windows

Windows x64 dengan WebView2. Jalankan di PowerShell:

```powershell
$env:VPS_MANAGER_RELEASE_URL='https://HOST-KAMU/releases/v0.1.0'
irm "$env:VPS_MANAGER_RELEASE_URL/install.ps1" | iex
```

Installer mengunduh MSI, memeriksa SHA-256, lalu membuka wizard instalasi. Jika dibatalkan, installer melaporkan kegagalan tanpa mengklaim instalasi berhasil. Perintah `curl` dan `irm` juga tersedia di halaman Server setelah URL rilis diisi.

Hanya jalankan skrip dari penerbit yang kamu percaya. Untuk meninjau skrip terlebih dahulu, unduh `install.sh` atau `install.ps1` dari folder rilis, baca isinya, lalu jalankan secara lokal. Checksum dari server yang sama mendeteksi kerusakan unduhan; checksum bukan tanda tangan penerbit.

## Penggunaan

1. Pasang agent di VPS dan atur alamat bind yang dapat diakses melalui jaringan privat atau reverse proxy HTTPS.
2. Buka aplikasi, isi nama, alamat, port, dan token agent pada halaman **Server**.
3. Pilih **Uji koneksi** untuk memeriksa autentikasi.
4. Buka **Dashboard** untuk metrik CPU, RAM, swap, disk, dan jaringan, atau **Terminal** untuk shell interaktif.

Profil disimpan di SQLite pada aplikasi desktop. Mode browser untuk pengembangan memakai localStorage. Token tersimpan di perangkat, sehingga akses akun Windows juga harus dijaga. Agent menyediakan akses shell sebagai root; jangan buka port agent langsung ke internet. Service membatasi penulisan filesystem melalui systemd; operasi tulis di luar `/opt/vps-agent` dan `/etc/vps-agent` memerlukan penyesuaian unit service secara sadar.

## Pengembangan

Prasyarat client: Node.js 20.19+ atau 22.12+, Rust stable, serta [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) untuk Windows (C++ build tools dan WebView2).

```powershell
cd client
npm install
cargo install tauri-cli --version "^2" --locked
npm run dev
npm run build
npm run tauri dev
npm run tauri build
```

Jika sandbox membatasi loader konfigurasi esbuild, gunakan `npm run build -- --configLoader runner`. Hasil frontend berada di `client/dist`; paket Windows berada di `client/src-tauri/target/release/bundle/msi/`.

Build agent di Linux:

```bash
cd agent
cargo build --release --locked
sudo bash install.sh ./target/release/vps-agent
```

## Verifikasi

```powershell
cd client
npm run build
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File e2e/install-check.ps1
```

Pemeriksaan UI tanpa dependency tambahan memerlukan Node.js 22+ (global WebSocket), client dev server di port 1420, dan Chrome dengan remote debugging port 9223. Jalankan Chrome menggunakan profil pengujian terpisah:

```powershell
& 'C:/Program Files/Google/Chrome/Application/chrome.exe' --headless=new --remote-debugging-port=9223 --user-data-dir="$PWD/.browser-test/chrome" about:blank
# Pada terminal lain, dari root proyek:
node e2e/ui-check.mjs
```

Pemeriksaan ini menguji penambahan dan persistensi profil, pencarian, kegagalan penyimpanan, perintah instalasi, layout mobile, metrik simulasi dan status putus, serta split panel. Screenshot tersimpan di `.browser-test/`. Pemeriksaan ini tidak menggantikan uji terminal terhadap agent Linux sungguhan.

## Struktur

| Folder | Isi |
| --- | --- |
| `agent/` | Service Rust, REST API, WebSocket metrik dan PTY, installer Linux |
| `client/` | Aplikasi Tauri, React, TypeScript |
| `docs/` | [Kontrak protokol](docs/AGENT_PROTOCOL.md) dan panduan rilis |
| `e2e/` | Pemeriksaan UI dan installer |

API proses, service, jaringan, file, dan log sudah tersedia di agent. UI saat ini mencakup profil server, dashboard, dan terminal.

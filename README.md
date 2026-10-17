# VPS Manager

Konsol desktop Windows untuk mengelola koneksi VPS, memantau resource, dan membuka terminal multi-tab dengan split panel. Client menggunakan Tauri, React, dan TypeScript; agent menggunakan Rust.

## Instalasi

Binary, installer, dan checksum diterbitkan lewat [GitHub Releases Catly](https://github.com/wignn/catly/releases) oleh CI/CD (lihat [panduan rilis](docs/RELEASING.md)). URL berikut menggunakan rilis terbaru dan tersedia setelah tag `v*` pertama berhasil dibuild dan diterbitkan.

### Agent Linux

Linux dengan systemd, `curl`, dan coreutils. Binary x86_64 memerlukan glibc 2.35+ (Ubuntu 22.04+); aarch64 memerlukan glibc 2.39+ (Ubuntu 24.04+).

```bash
curl -fsSL https://github.com/wignn/catly/releases/latest/download/install.sh | sudo bash
```

Installer memilih binary sesuai arsitektur, memeriksa SHA-256, memasang binary di `/opt/vps-agent/vps-agent` dengan symlink `/usr/local/bin/vps-agent`, lalu mengaktifkan dan menjalankan service `vps-agent` otomatis saat boot. Instalasi baru mendeteksi IP Tailscale yang sudah aktif; jika tidak ada, agent memakai `127.0.0.1:18710`. Saat upgrade, token dan alamat bind dipertahankan.

Untuk versi tertentu, gunakan URL versi yang sama bagi skrip dan binary:

```bash
RELEASE_URL='https://github.com/wignn/catly/releases/download/v0.1.0'
curl -fsSL "$RELEASE_URL/install.sh" | sudo bash -s -- --release-url "$RELEASE_URL"
```

Untuk menghubungkan client melalui Tailscale, edit `/etc/vps-agent/environment`:

```ini
VPS_AGENT_BIND=100.64.0.12:18710
```

Gunakan IP Tailscale VPS milikmu, kemudian jalankan `sudo systemctl restart vps-agent`. Periksa service dengan `sudo systemctl status vps-agent` dan log dengan `sudo journalctl -u vps-agent -n 50`.

### Aplikasi Windows

Windows x64 dengan WebView2. Jalankan di PowerShell:

```powershell
irm https://github.com/wignn/catly/releases/latest/download/install.ps1 | iex
```

Installer mengunduh MSI, memeriksa SHA-256, lalu membuka wizard instalasi. Jika dibatalkan, installer melaporkan kegagalan tanpa mengklaim instalasi berhasil. Perintah `curl` dan `irm` juga tersedia di halaman Server dengan URL Catly sebagai default. Untuk memilih versi lain, set `$env:VPS_MANAGER_RELEASE_URL` ke folder rilis versi tersebut sebelum menjalankan skrip dari folder yang sama.

Hanya jalankan skrip dari penerbit yang kamu percaya. Untuk meninjau skrip terlebih dahulu, unduh `install.sh` atau `install.ps1` dari folder rilis, baca isinya, lalu jalankan secara lokal. Checksum dari server yang sama mendeteksi kerusakan unduhan; checksum bukan tanda tangan penerbit.

## Penggunaan

1. Pasang agent di VPS dan atur alamat bind yang dapat diakses melalui jaringan privat atau reverse proxy HTTPS.
2. Buka aplikasi, isi nama, alamat, port, dan token agent pada halaman **Server**.
3. Pilih **Uji koneksi** untuk memeriksa autentikasi.
4. Buka **Dashboard** untuk metrik CPU, RAM, swap, disk, dan jaringan, atau **Terminal** untuk shell interaktif.

Profil desktop disimpan di SQLite; token disimpan di Windows Credential Manager. Token lama di SQLite dimigrasikan setelah penyimpanan aman berhasil diverifikasi. Mode browser menyimpan profil di localStorage dan token hanya di memori halaman: setelah reload, isi token lagi melalui **Edit**. Agent menyediakan akses shell sebagai root; gunakan Tailscale atau reverse proxy HTTPS. Service membatasi penulisan filesystem melalui systemd; operasi tulis di luar direktori yang diizinkan memerlukan penyesuaian unit service.

## Pengelolaan lanjutan (v0.2.0)

- **Server:** edit profil, uji koneksi dengan timeout dan URL tujuan, status terkini, versi agent, latensi, dan waktu koneksi terakhir. Pesan jaringan menunjukkan langkah pemeriksaan tanpa menebak penyebab firewall/CORS.
- **Monitoring:** riwayat CPU/RAM/jaringan hingga tujuh hari, grafik 1 jam/24 jam/7 hari, dan alert CPU/RAM/disk ≥90%, server offline, serta service gagal. Notifikasi Windows memakai plugin resmi Tauri dan memerlukan opt-in. Pengambilan sampel dan notifikasi berjalan selama aplikasi terbuka; tidak ada pengiriman ke layanan pihak ketiga.
- **Kelola VPS → Service & log:** cari service systemd, start/stop/restart dengan konfirmasi, dan ikuti/pencarian log langsung (maksimal 1.000 baris terakhir).
- **File:** jelajah direktori, upload termasuk drag-and-drop, download, dan edit teks hingga 2 MB. File lama dicadangkan sebagai `*.vps-backup-*` sebelum diganti. Penulisan agent memerlukan direktori milik pengguna agent tanpa izin tulis group/other; gunakan SFTP untuk direktori milik pengguna lain. Batas akses juga mengikuti unit systemd.
- **SFTP desktop:** transfer melalui Windows OpenSSH Client, memakai SSH key atau SSH agent. Hubungkan melalui `ssh -p PORT USER@HOST` lebih dahulu, periksa fingerprint, lalu simpan host key. Key terenkripsi harus dimuat di SSH agent. SFTP memakai file sementara sebelum mengganti tujuan dan tidak membuat backup agent; server tanpa dukungan rename pengganti dapat menolak overwrite.
- **Update agent:** cek versi Catly, minta update stabil terbaru, atau rollback ke binary sebelumnya. Updater systemd memverifikasi SHA-256 dan arsitektur, serta memulihkan binary sebelumnya bila health check gagal. Endpoint ini memerlukan agent dan installer v0.2.0+; upgrade pertama dari v0.1.0 memakai perintah instalasi Linux di atas.
- **Keamanan:** rotasi token admin, buat token read-only khusus pemantauan, dan audit operasi. Read-only tidak bisa membuka terminal/log, membaca file, atau menjalankan perintah. Token yang dirotasi membatalkan akses REST dan koneksi WebSocket lama. Audit sesi dibatasi 200 entri dan tidak mencatat isi perintah atau token.

Tailscale harus sudah dipasang dan login di VPS serta Windows. Installer tidak mendaftarkan perangkat ke akun Tailscale atau membuka firewall publik. Bila konfigurasi lama masih loopback, ubah bind secara eksplisit seperti contoh di atas.

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
node e2e/agent-client-check.mjs
node client/src/lib/db.test.mjs
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

API proses dan jaringan tersedia di agent. UI mencakup profil server, dashboard, terminal, monitoring, service/log, file/SFTP, update/rollback, dan keamanan.

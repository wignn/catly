# Rilis Catly

Repository: [wignn/catly](https://github.com/wignn/catly). Workflow [Build and release](../.github/workflows/release.yml) membuild agent Linux x86_64 dan aarch64 serta aplikasi Windows x64. Push ke `main`/`master`, pull request, dan pemicu manual menghasilkan artifact di GitHub Actions. Push tag `v*` juga menerbitkan seluruh hasil ke [GitHub Releases](https://github.com/wignn/catly/releases) setelah semua job berhasil.

## Membuat rilis

Pastikan versi di `agent/Cargo.toml`, `agent/src/main.rs`, `client/package.json`, `client/src-tauri/Cargo.toml`, dan `client/src-tauri/tauri.conf.json` sesuai versi yang akan dirilis. Commit perubahan versi dan lockfile yang berubah sebelum membuat tag.

```bash
git push origin main
git tag v0.1.0
git push origin v0.1.0
```

Gunakan nomor versi baru untuk rilis berikutnya. Workflow memerlukan GitHub Actions aktif; job publikasi memakai `GITHUB_TOKEN` dengan permission `contents: write`. Tidak diperlukan token pribadi atau server hosting tambahan.

## Asset rilis

```text
install.sh
install.ps1
update.sh
update.sh.sha256
vps-agent-linux-x86_64
vps-agent-linux-x86_64.sha256
vps-agent-linux-aarch64
vps-agent-linux-aarch64.sha256
vps-manager-windows-x64.msi
vps-manager-windows-x64.msi.sha256
vps-manager-windows-x64.exe
vps-manager-windows-x64.exe.sha256
```

Agent x86_64 dibuild pada Ubuntu 22.04 (glibc 2.35+); aarch64 dibuild native pada Ubuntu 24.04 ARM (glibc 2.39+). Binary ini bukan untuk Alpine/musl. Windows memerlukan Windows x64 dan WebView2; MSI adalah jalur instalasi aplikasi, sedangkan EXE tersedia sebagai binary terpisah.

Workflow memeriksa installer Windows dan menguji installer Linux dengan binary hasil build: service harus enabled dan aktif, binary tersedia di `/usr/local/bin/vps-agent`, API menerima token, serta token dan alamat bind bertahan setelah upgrade. Pemeriksaan ini berjalan pada runner sementara dengan systemd, bukan VPS produksi.

Pemeriksaan tambahan mencakup policy token read-only, rotasi dan persistensi token, akses WebSocket, audit, verifikasi checksum/rollback updater, migrasi token lokal, koneksi/timeout, serta validasi perintah native. Windows menjalankan `cargo test --locked` termasuk roundtrip Credential Manager pada target pengujian terpisah. Pengujian SFTP menyaring input dan batch; transfer terhadap VPS/sshd nyata masih perlu diuji di lingkungan pemilik.

## URL unduhan

Default installer dan UI adalah:

```text
https://github.com/wignn/catly/releases/latest/download
```

Untuk mengunci versi:

```text
https://github.com/wignn/catly/releases/download/v0.1.0
```

Unduh skrip, binary, dan checksum dari folder versi yang sama. URL `latest` mengikuti rilis stabil terbaru; gunakan URL versi untuk instalasi yang harus dapat diulang. URL unduhan baru tersedia setelah rilis berhasil diterbitkan.

Checksum dibuat dari paket final. Checksum dari server yang sama mendeteksi kerusakan unduhan dan bukan tanda tangan penerbit. Paket Windows belum ditandatangani; kredensial signing tidak disimpan di repository.

Sebelum rilis untuk penggunaan luas, uji MSI pada Windows serta koneksi, metrik, dan terminal terhadap VPS Linux sungguhan.

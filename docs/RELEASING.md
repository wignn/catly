# Menyiapkan rilis

Belum ada URL unduhan resmi dalam proyek ini. Installer menerima URL folder rilis HTTPS sehingga dapat dipakai di GitHub Releases atau server milik sendiri.

## Isi folder rilis

```text
install.sh                         # salinan agent/install.sh
install.ps1                        # dari root proyek
vps-agent-linux-x86_64
vps-agent-linux-x86_64.sha256
vps-agent-linux-aarch64             # opsional, hanya jika sudah dibuild dan diuji
vps-agent-linux-aarch64.sha256
vps-manager-windows-x64.msi
vps-manager-windows-x64.msi.sha256
```

Build agent dengan `cargo build --release --locked` pada Linux arsitektur yang sesuai, lalu ubah nama `target/release/vps-agent` menjadi nama asset di atas. Target minimum glibc mengikuti mesin build; gunakan Ubuntu 22.04 untuk paket dengan target Ubuntu 22.04 atau lebih baru. Binary ARM tidak dapat digantikan oleh binary x86_64.

Di Windows, pasang Tauri CLI (`cargo install tauri-cli --version "^2" --locked`), jalankan `npm install` lalu `npm run tauri build` di `client/`. Salin hasil dari `src-tauri/target/release/bundle/msi/` dan beri nama `vps-manager-windows-x64.msi`.

Buat checksum dari paket akhir yang akan diterbitkan. Di Linux:

```bash
sha256sum vps-agent-linux-x86_64 > vps-agent-linux-x86_64.sha256
```

Di PowerShell:

```powershell
(Get-FileHash ./vps-manager-windows-x64.msi -Algorithm SHA256).Hash.ToLowerInvariant() | Set-Content -Encoding ascii ./vps-manager-windows-x64.msi.sha256
```

Checksum dapat berupa hash saja atau format `sha256sum` dengan nama file. Jangan gunakan checksum untuk paket yang masih akan diubah atau ditandatangani ulang.

## Sebelum diterbitkan

- Jalankan build frontend dan pemeriksaan installer.
- Uji installer Linux pada VPS uji bersih; pastikan token bertahan setelah instalasi kedua.
- Uji MSI di Windows x64 dan uji koneksi, metrik, serta PTY terhadap agent.
- Terbitkan seluruh file pada folder versi yang sama melalui HTTPS. Ganti URL contoh di README atau masukkan URL tersebut di UI.

Untuk GitHub Releases, URL folder berbentuk `https://github.com/OWNER/REPO/releases/download/v0.1.0`. Unggah kedua installer sebagai release assets bersama paket dan checksum. Hindari mencampur skrip dari branch utama dengan binary dari versi berbeda.

Paket Windows saat ini belum ditandatangani. Tambahkan code signing saat menyiapkan distribusi publik; sertifikat dan kredensial penandatanganan tidak disimpan di repository.

# WhatsApp QR — Run & Test

Panduan singkat untuk menjalankan dan menguji otentikasi WhatsApp (QR) pada Gateway.

## Persiapan
1. Install dependencies baru (menambahkan `qrcode`):

```bash
npm install
```

2. Pastikan `WHATSAPP_REQUEST_WORKER_ENABLED=true` di `.env` jika ingin worker aktif.

## Menjalankan untuk scan QR (visible)
- Jalankan mode development agar output mudah dilihat:

```bash
npm run dev
```

- Saat `Baileys` memerlukan autentikasi, QR akan dicetak di terminal dan juga otomatis dibuka di browser sebagai file HTML sementara.

## Menjalankan tersembunyi (background)
- Setelah sesi berhasil (folder `wa-session` dibuat), Anda dapat menjalankan gateway tersembunyi:

```powershell
.\start-hidden.ps1
```

- Meskipun proses utama dijalankan tersembunyi, jika QR muncul maka browser akan tetap dibuka otomatis agar operator dapat memindai QR.

## Memaksa QR muncul ulang (re-auth)
- Hentikan gateway.
- Hapus atau pindahkan folder sesi untuk memaksa autentikasi ulang:

```powershell
Remove-Item -Recurse -Force .\wa-session
# atau
rd /s /q wa-session
```

- Jalankan kembali `npm run dev` atau `start-hidden.ps1` untuk melihat QR.

## Lokasi file sementara QR
- File HTML QR disimpan di temporary directory sistem, mis. `%TEMP%` pada Windows.
- Contoh perintah untuk melihat file yang dibuat baru-baru ini di PowerShell:

```powershell
Get-ChildItem $env:TEMP -Filter "wa-qr-*.html" | Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

- Untuk menghapus file-file sementara QR lama:

```powershell
Get-ChildItem $env:TEMP -Filter "wa-qr-*.html" | Remove-Item -Force
```

## Cleanup otomatis
- Gateway sekarang otomatis menghapus file HTML QR sementara setelah waktu hidup default 5 menit.
- Anda dapat menyesuaikan waktu ini dengan variabel lingkungan `WHATSAPP_QR_TTL_SECONDS` (nilai dalam detik).
- Saat startup, Gateway juga akan membersihkan file-file QR lama yang lebih tua dari dua kali TTL.

## Automatic terminal popup on QR
- A new watcher script `watch-wa-qr.ps1` runs in background when you use `start-hidden.ps1`.
- The watcher monitors temporary QR files and will open a visible PowerShell window that shows the QR HTML path and opens the HTML in the browser. This allows the gateway process to remain hidden while still surfacing a terminal when operator interaction (QR scan) is needed.
- `start-hidden.ps1` now launches the watcher automatically.

## Verifikasi
- Pastikan folder `wa-session` berisi berkas kredensial setelah berhasil scan.
- Setelah sesi hidup, jalankan `start-hidden.ps1` dan pastikan WhatsApp worker tetap terhubung tanpa membutuhkan QR scan ulang.

## Catatan & Opsi Lanjutan
- Anda dapat menambahkan pembersihan otomatis berkas HTML sementara atau mengubah strategi membuka jendela (mis. spawn notepad atau popup minimal) jika kebijakan keamanan melarang membuka browser.
- Jika ingin, saya bisa menambahkan fitur penghapusan otomatis file HTML setelah beberapa menit dan menambahkan logging lokasi file.

---
Dokumen ini dibuat untuk memudahkan proses autentikasi WhatsApp pada Gateway.

# Radio SBL Studio Gateway Agent

**Radio SBL Studio Gateway Agent** adalah aplikasi penghubung otomasi penyiaran yang bertugas menyinkronkan status pemutaran musik serta metadata lagu dari pemutar **RadioBOSS** lokal di komputer studio fisik ke basis data awan **Firebase Firestore** secara real-time.

Hasil sinkronisasi data ini digunakan oleh aplikasi **Radio SBL** (klien frontend dan aplikasi mobile) untuk menampilkan metadata lagu yang sedang diputar (*now playing*), lagu berikutnya (*next track*), serta pemantauan status studio bagi administrator.

---

## 🏗️ Arsitektur Integrasi

Agen ini berjalan secara non-intrusif sebagai lapisan tambahan (*middleware*) di komputer studio fisik:

```txt
[ PC Studio Lokal ]                                  [ Google Firebase Cloud ]
┌─────────────────┐     HTTP Polling     ┌─────────┐      Firestore Sync      ┌───────────┐
│ RadioBOSS API   │ <──────────────────> │ Gateway │ <──────────────────────> │ Firestore │
│ (localhost:9001)│                      │ Agent   │                          │ Database  │
└─────────────────┘                      └─────────┘                          └─────┬─────┘
                                                                                    │
                                                                                    │ Read Only
                                                                                    ▼
                                                                              ┌───────────┐
                                                                              │ Aplikasi  │
                                                                              │ Radio SBL │
                                                                              └───────────┘
```

---

## 🔒 Prinsip Keamanan & Desain Sistem

Pilar utama keamanan dan keandalan sistem yang diimplementasikan:
1. **Read-Only Tahap Awal**: Agen hanya bertugas membaca status (`playbackinfo`) dan tidak diperbolehkan mengirimkan perintah kontrol (seperti `play`, `pause`, `next`, atau `reboot`) ke RadioBOSS pada tahap ini.
2. **Localhost Only**: API Remote Control RadioBOSS **wajib** dikonfigurasi untuk hanya menerima koneksi dari IP loopback lokal (`127.0.0.1`). Port API **tidak boleh** dibuka ke internet publik atau modem port-forwarding.
3. **Kredensial Aman**: Berkas rahasia `.env` dan `service-account.json` sepenuhnya dikecualikan dari repositori Git (`.gitignore`) untuk menghindari kebocoran sandi di internet.
4. **Pencegahan Spam & Duplikasi**: Firestore terlindung dari kelebihan kapasitas penulisan melalui filter cerdas yang memblokir penulisan data riwayat lagu jika tidak ada perubahan metadata atau pergantian terjadi di bawah 5 detik.
5. **Log Berputar Otomatis (Log Rotation)**: Batas berkas log `gateway.log` dibatasi sebesar **5 MB**; isi log lama akan otomatis dipindahkan ke `gateway.old.log` jika kapasitas penuh sebelum menulis log baru.
6. **Graceful Shutdown**: Menangkap sinyal sistem `SIGINT` dan `SIGTERM` untuk mengubah status gateway menjadi `offline` saat ditutup demi keakuratan detak jantung (*heartbeat*) di Firestore.

---

## 📂 Struktur Repositori

```txt
studio-gateway/
├─ README.md                    # Dokumentasi utama proyek
├─ INSTALL_WINDOWS.md           # Panduan instalasi di komputer studio Windows
├─ TROUBLESHOOTING.md           # Panduan pemecahan kendala & kode kesalahan
├─ FIRESTORE_SCHEMA.md          # Rancangan struktur koleksi & tipe data Firestore
├─ .env.example                 # Kerangka konfigurasi variabel lingkungan (.env)
├─ .gitignore                   # Aturan pengecualian berkas Git
├─ package.json                 # Skrip proyek & dependensi pustaka
├─ package-lock.json            # Snapshot pohon dependensi npm
├─ tsconfig.json                # Konfigurasi transpiler TypeScript
├─ start-gateway.bat            # Berkas batch utama startup instan
├─ start-hidden.ps1             # Peluncur latar belakang senyap berbasis PowerShell
├─ start-hidden.vbs             # Peluncur latar belakang senyap berbasis VBScript
├─ src/
│  ├─ index.ts                  # Logika orkestrasi polling & sinkronisasi agen
│  ├─ radiobossClient.ts        # Klien HTTP terenkode aman untuk API RadioBOSS
│  ├─ firebaseClient.ts         # Integrasi Firestore SDK dengan write helper
│  ├─ parsePlaybackInfo.ts      # Pengurai respons XML RadioBOSS
│  ├─ normalizeTrack.ts         # Penangan pemisahan castTitle & sanitasi string
│  ├─ logger.ts                 # Log rotasi & penyensor sandi sensitif
│  ├─ mockRadioboss.ts          # Server tiruan API RadioBOSS lokal
│  ├─ testParser.ts             # Skrip pengujian pengurai & normalisasi metadata
│  └─ types.ts                  # Deklarasi tipe data TypeScript terpadu
└─ samples/
   └─ playbackinfo.sample.xml   # Berkas contoh XML respons RadioBOSS asli
```

---

## 🚀 Panduan Ringkas Instalasi

1. **Persiapan**: Pasang **Node.js LTS** pada komputer studio Anda.
2. **Klon Proyek**:
   ```cmd
   git clone https://github.com/sblfm2025/studio-gateway.git
   cd studio-gateway
   ```
3. **Pasang Library**:
   ```cmd
   npm install
   ```
4. **Konfigurasi Lingkungan**:
   * Salin `.env.example` menjadi `.env` dan isi password API RadioBOSS serta Project ID Firebase Anda.
   * Tempatkan berkas sertifikat akses Firebase Admin SDK Anda di folder root dengan nama `service-account.json`.
5. **Kompilasi TypeScript**:
   ```cmd
   npm run build
   ```
6. **Jalankan Agen**:
   ```cmd
   npm start
   ```

*Panduan instalasi startup otomatis secara detail di Windows dapat Anda lihat di dokumen: [INSTALL_WINDOWS.md](file:///e:/studio-gateway/studio-gateway/INSTALL_WINDOWS.md).*

---

## 🧪 Simulasi & Pengujian Mandiri

Agen dilengkapi dengan modul simulasi penuh untuk mempermudah pengujian luring (*offline testing*) tanpa bergantung pada aplikasi asli:

### 1. Jalankan Uji Coba Parser Metadata
Verifikasi kecerdasan agen dalam memisah `CASTTITLE` dan melakukan normalisasi data fallback:
```cmd
npm run test-parser
```

### 2. Jalankan Server API Tiruan RadioBOSS
Nyalakan server simulasi RadioBOSS pada port `9100` yang akan menghasilkan data lagu berganti secara dinamis:
```cmd
npm run mock-api
```
Buka tautan ini di browser Anda untuk melihat data XML simulasinya:
`http://127.0.0.1:9100/?pass=test&action=playbackinfo`

---

## 🔍 Skema Basis Data target

Agen ini menyinkronkan data ke beberapa koleksi Firestore berikut:
* **`radiobossStatus/current`**: Status operasional teknis & kode kesalahan pemutar.
* **`radiobossNowPlaying/current`**: Judul lagu, penyanyi, kemajuan durasi (*progress*), dan lagu berikutnya.
* **`radiobossGatewayHeartbeat/{gatewayId}`**: Detak keaktifan mesin PC studio fisik.
* **`radiobossTrackHistory/{trackId}`**: Riwayat track list lagu siaran yang selesai diputar.
* **`radiobossAuditLogs/{logId}`**: Rekam jejak audit keamanan dan peristiwa teknis penting.
* **`weekly_schedule_slots/{slotId}`**: Jadwal mingguan berulang dari aplikasi Radio SBL yang dipakai auto recording.
* **`scheduleOverrides/{overrideId}`**: Override tanggal tertentu untuk mengganti, membatalkan, atau menambah slot siaran.

*Rincian tipe data dan struktur skema selengkapnya dapat Anda lihat di dokumen: [FIRESTORE_SCHEMA.md](file:///e:/studio-gateway/studio-gateway/FIRESTORE_SCHEMA.md).*

---

## Command Queue Aman

Gateway dapat memproses command manual dari aplikasi Radio SBL melalui koleksi `radiobossCommands`. Browser tetap tidak pernah memanggil API RadioBOSS langsung.

Command awal yang didukung:
* `START_RECORDING`
* `STOP_RECORDING`
* `MARK_RECORDING_SKIPPED`
* `RETRY_COMMAND`
* `ADD_TRACK_TO_QUEUE`, yang diterjemahkan gateway menjadi action `songrequest` RadioBOSS agar masuk ke daftar Song Requests di aplikasi RadioBOSS.

Koleksi tambahan yang dipakai:
* `radiobossCommands/{commandId}`
* `programRecordingRules/{programId}` atau `programRecordingRules/{scheduleId}` untuk rule khusus slot jadwal.
* `programRecordings/{recordingId}`

Konfigurasi tambahan di `.env`:
```env
COMMAND_WORKER_ENABLED=true
COMMAND_POLL_INTERVAL_SECONDS=5
AUTO_RECORDING_ENABLED=false
AUTO_RECORDING_INTERVAL_SECONDS=60
RADIO_SBL_RECORDING_ROOT=D:\RadioSBL_REKAMAN
RADIO_SBL_MUSIC_LIBRARY_ROOT=D:\RadioSBL_AUDIO
```

Root folder rekaman dan music library wajib berada di PC studio. Gateway melakukan validasi path agar command tidak bisa menulis atau membaca file di luar root yang diizinkan.

`AUTO_RECORDING_ENABLED` sengaja default `false`. Aktifkan menjadi `true` hanya setelah `weekly_schedule_slots` atau `broadcastSchedules`, `attendanceRecords`, dan `programRecordingRules` sudah siap di Firestore serta folder rekaman sudah benar di PC studio. Jika `weekly_schedule_slots` tersedia, gateway akan membentuk jadwal harian berulang untuk kemarin, hari ini, dan besok, lalu menerapkan `scheduleOverrides` sebelum memutuskan start/stop rekaman.

## Song Request Worker

Gateway juga dapat membantu alur request lagu dari aplikasi Radio SBL tanpa membuka akses RadioBOSS ke browser.

Alur aman yang dipakai:
* Aplikasi menulis request ke `songRequests`.
* Gateway membaca request berstatus `new` atau `notified`.
* Gateway mencocokkan judul dan penyanyi dengan `musicLibraryIndex`.
* Jika cocok kuat, request otomatis dibuatkan command `ADD_TRACK_TO_QUEUE`.
* Command worker memvalidasi path lalu mengirim action `songrequest` ke RadioBOSS.
* Jika ambigu atau tidak ditemukan, request ditandai `needs_review` untuk diperiksa operator.
* Gateway tetap menulis audit log sehingga alur bisa diinspeksi manual tanpa menjadi proses approve wajib.

Konfigurasi tambahan di `.env`:
```env
SONG_REQUEST_WORKER_ENABLED=true
SONG_REQUEST_WORKER_INTERVAL_SECONDS=30
SONG_REQUEST_AUTO_FORWARD_TO_RADIOBOSS=true
SONG_REQUEST_AUTO_FORWARD_MIN_CONFIDENCE=80
RADIO_SBL_MUSIC_LIBRARY_ROOT=D:\RadioSBL_AUDIO
```

Dengan `SONG_REQUEST_AUTO_FORWARD_TO_RADIOBOSS=true`, request yang cocok kuat dengan `musicLibraryIndex` otomatis dibuatkan command dan dikirim ke daftar **Song Requests** di RadioBOSS. Operator tetap dapat mereview atau mengeksekusi request dari RadioBOSS, sementara aplikasi Radio SBL hanya menjadi pengirim dan panel inspeksi.

Catatan operasional RadioBOSS:
* Command `ADD_TRACK_TO_QUEUE` diterjemahkan menjadi action API `songrequest` dengan `filename` full path file lokal dan `message` aman.
* Action `songrequest` hanya memasukkan lagu ke daftar Song Requests RadioBOSS, bukan langsung memutar lagu.
* Agar request diputar otomatis, buat event Scheduler di RadioBOSS, misalnya `playrequestedsong 30`, lalu ulangi sesuai jam layanan request.
* API Remote Control RadioBOSS tetap disarankan `localhost only`; jangan buka port RadioBOSS ke internet publik.

## WhatsApp Request Worker

Gateway dapat membaca pesan masuk WhatsApp Business di PC Studio memakai Baileys dan memasukkan request lagu ke koleksi `songRequests`. Worker ini tidak memutar lagu dan tidak langsung mengirim ke RadioBOSS; operator tetap mereview, mencocokkan file lagu, lalu aplikasi Radio SBL membuat command aman ke gateway.

Konfigurasi `.env`:
```env
WHATSAPP_REQUEST_WORKER_ENABLED=false
WHATSAPP_WORKER_START_DELAY_SECONDS=60
WHATSAPP_IGNORE_GROUPS=true
WHATSAPP_AUTO_REPLY_ENABLED=true
WHATSAPP_MAX_REQUEST_PER_PHONE_PER_HOUR=3
WHATSAPP_SESSION_DIR=./wa-session
WHATSAPP_REQUIRE_KEYWORD=true
WHATSAPP_ALLOWED_KEYWORDS=req,request,lagu,putarkan,minta lagu,kirim lagu
```

Alur uji:
1. Set `WHATSAPP_REQUEST_WORKER_ENABLED=true`.
2. Jalankan `npm run build`, lalu `npm start`.
3. Scan QR yang tampil di terminal memakai WhatsApp Business studio.
4. Kirim pesan contoh: `Request Nadhif Basalamah - Penjaga Hati untuk Rena`.
5. Cek dokumen baru di `songRequests` dan halaman Review Request aplikasi Radio SBL.

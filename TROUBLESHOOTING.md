# Troubleshooting: Studio Gateway Agent

Dokumen ini memuat daftar kendala umum yang mungkin terjadi selama pengoperasian **Radio SBL Studio Gateway Agent** di komputer studio beserta gejala, cara pengecekan, dan solusi praktis penyelesaiannya.

---

## 🔌 1. RadioBOSS Offline (Koneksi Terputus)

### Gejala
* Pada Firestore, dokumen `radiobossStatus/current` menunjukkan nilai `online: false`.
* Kode kesalahan (`errorCode`) tertulis `RADIOBOSS_CONNECTION_REFUSED`.
* Riwayat audit logs dipenuhi dengan peringatan kegagalan sinkronisasi.

### Cara Pengecekan & Solusi
1. **Periksa Keaktifan RadioBOSS**: Pastikan aplikasi otomasi RadioBOSS sedang berjalan dan aktif di layar komputer studio.
2. **Periksa Fitur Remote Control API**:
   * Buka RadioBOSS -> **Settings** -> **Options** -> **API**.
   * Pastikan opsi **Enable Remote Control API** dalam kondisi tercentang.
3. **Pencocokan Port & Password**:
   * Periksa apakah port yang tertera di RadioBOSS sama dengan nilai `RADIOBOSS_API_URL` di dalam berkas `.env` (bawaannya adalah port `9001`).
   * Pastikan password yang didaftarkan di kolom API RadioBOSS sama persis dengan variabel `RADIOBOSS_API_PASSWORD` di `.env` (tanpa ada selisih spasi atau huruf kapital).
4. **Pengujian Akses API Mandiri**:
   * Buka browser internet di komputer studio tersebut, lalu kunjungi URL:
     `http://127.0.0.1:9001/?pass=PASSWORD_ANDA&action=playbackinfo`
   * Jika browser menampilkan dokumen XML berisi info trek, berarti API bekerja normal dan masalah terletak pada konfigurasi koneksi agen.

---

## ⏱️ 2. Timeout (RadioBOSS Lambat Merespons)

### Gejala
* Dokumen `radiobossStatus/current` memuat eror `errorCode: RADIOBOSS_TIMEOUT`.
* Pesan kesalahan berisi `"Connection to RadioBOSS API timed out (5 seconds)."`.

### Cara Pengecekan & Solusi
1. **Beban CPU Terlalu Tinggi**: PC studio yang terlalu berat menjalankan aplikasi multi-tasking dapat memperlambat respon pemutar. Tutup aplikasi yang tidak diperlukan.
2. **Koneksi Lokal Lambat**: Walaupun berjalan di localhost, kendala resolusi DNS loopback lokal dapat memperlambat respon. Ubah `RADIOBOSS_API_URL` dari `http://localhost:9001` ke IP numerik langsung `http://127.0.0.1:9001` di berkas `.env`.
3. **Peningkatan Batas Waktu (Timeout)**:
   * Jika spesifikasi komputer studio Anda lawas, Anda dapat melonggarkan batas waktu respons di berkas `.env` dengan menambahkan atau meningkatkan nilai variabel:
     ```env
     RADIOBOSS_TIMEOUT_MS=8000
     ```
     *(Batas aman toleransi timeout adalah di rentang 1000ms hingga 15000ms, bawaannya adalah 5000ms).*

---

## 🔑 3. Firebase Write Failed (Gagal Menulis ke Firestore)

### Gejala
* Log konsol atau file `gateway.log` memuat kegagalan otentikasi atau penulisan data Firestore.
* Audit log tidak terkirim ke Firebase Cloud.

### Cara Pengecekan & Solusi
1. **Periksa Kredensial service-account.json**:
   * Pastikan berkas sertifikat `service-account.json` diletakkan dengan benar di direktori root proyek.
   * Periksa apakah jalur berkas yang didaftarkan pada variabel `GOOGLE_APPLICATION_CREDENTIALS` di berkas `.env` sudah benar dan mengarah secara **absolut** (misal: `E:\studio-gateway\service-account.json`).
2. **Periksa Validitas Proyek ID**:
   * Pastikan variabel `FIREBASE_PROJECT_ID` di dalam `.env` sama persis dengan nama ID proyek Anda yang tertera di Firebase Console (misal: `radiosbl`).
3. **Periksa Jaringan Internet Studio**:
   * Pastikan komputer studio memiliki koneksi internet yang stabil ke Google Cloud APIs. Lakukan ping ke `firestore.googleapis.com` lewat Command Prompt untuk memverifikasi jalur perutean jaringan Anda.
4. **Periksa Aturan Aturan Keamanan (Security Rules)**:
   * Jika koneksi internet normal tapi penulisan ditolak, periksa Firestore Security Rules di Firebase Console Anda. Pastikan role akun layanan (*Service Account*) memiliki hak akses menulis (*write access*) penuh ke koleksi target.

---

## 🎵 4. Metadata Trek Kosong atau Duplikat

### Gejala
* Tampilan lagu di aplikasi frontend menampilkan `"Radio SBL Live"` secara terus-menerus padahal RadioBOSS sedang aktif memutar musik.
* Firestore menyimpan data historis pemutaran trek secara duplikat berulang-ulang untuk lagu yang sama.

### Cara Pengecekan & Solusi
1. **Periksa Kelengkapan Tag File Audio**:
   * Pastikan berkas MP3/audio yang diputar di RadioBOSS memiliki kelengkapan metadata tag **Artist** dan **Title** yang valid di library musik Anda.
2. **Pecahan CastTitle**:
   * Jika lagu diputar dari tautan streaming internet atau file syndicated, RadioBOSS biasanya mengirimkan data gabungan pada tag `<TRACK CASTTITLE="Penyanyi - Judul Lagu">`. Agen gateway ini sudah dilengkapi fitur pemisah cerdas yang akan memisahkan teks tersebut menggunakan berbagai karakter pembatas (` - `, ` – `, ` — `, ` | `).
3. **Filter Duplikasi Aktif**:
   * Agen gateway memiliki proteksi bawaan untuk **menolak penulisan data track history jika trek baru sama persis dengan trek sebelumnya**, atau jika perubahan durasi pergantian lagu terjadi di bawah **5 detik** (untuk mencegah duplikasi akibat lompatan durasi pendek di pemutar).

---

## 🔁 5. Agen Gateway Tidak Menyala Otomatis

### Gejala
* Saat komputer studio direstart, sinkronisasi lagu tidak berjalan dan log di `gateway.log` tidak bertambah.

### Cara Pengecekan & Solusi
1. **Direktori Kerja Tidak Cocok**:
   * Jika menggunakan Windows Task Scheduler atau PM2, pastikan **Start In / Working Directory** diatur secara absolut ke folder proyek Anda (`E:\studio-gateway`), bukan direktori default sistem `C:\Windows\System32`.
2. **Variabel Lingkungan Node.js Hilang**:
   * Di latar belakang, Windows terkadang tidak mengenali lokasi instalasi Node.js. Berkas batch utama `start-gateway.bat` kami telah dilengkapi penguat variabel lingkungan otomatis (`set PATH=%PATH%;C:\Program Files\nodejs`) untuk mengatasi masalah ini secara permanen.
3. **Gunakan NSSM (Non-Sucking Service Manager)**:
   * Jika PM2 atau Task Scheduler Windows kurang stabil di komputer studio Anda, gunakan utilitas **NSSM** untuk mengubah `start-gateway.bat` Anda menjadi Windows Service latar belakang resmi yang akan diatur menyala otomatis (*Automatic Startup*) setiap kali komputer dihidupkan.

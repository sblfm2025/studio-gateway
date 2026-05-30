# Panduan Instalasi: Studio Gateway Agent di Windows Studio

Dokumen ini menjelaskan langkah-demi-langkah memasang, mengonfigurasi, dan menjalankan **Radio SBL Studio Gateway Agent** di komputer studio bersistem operasi Windows secara stabil dan berkelanjutan.

---

## 📋 Prasyarat Sistem
Sebelum memulai, pastikan komputer studio Anda memenuhi syarat berikut:
1. **Sistem Operasi**: Windows 10, Windows 11, atau Windows Server (64-bit).
2. **Koneksi Internet**: Koneksi stabil untuk mengunggah status ke Firebase Firestore.
3. **RadioBOSS**: Aplikasi otomasi RadioBOSS sudah terpasang dan opsi **Remote Control API** aktif.
4. **Node.js**: Node.js versi LTS terpasang di komputer.

---

## 🛠️ Langkah 1: Pemasangan Node.js LTS
Jika komputer studio belum memiliki Node.js:
1. Unduh penginstal resmi Node.js LTS dari **[nodejs.org](https://nodejs.org/)**.
2. Jalankan penginstal `.msi` dan ikuti petunjuknya hingga selesai (pastikan opsi "Add to PATH" dicentang).
3. Verifikasi dengan membuka Command Prompt (CMD) dan jalankan:
   ```cmd
   node -v
   npm -v
   ```

---

## 📥 Langkah 2: Mengkloning Repositori Proyek
Buka Git Bash atau Command Prompt, lalu arahkan ke direktori penyimpanan Anda (misalnya di drive `E:` atau `D:`):
```cmd
cd /d E:\
git clone https://github.com/sblfm2025/studio-gateway.git
cd studio-gateway
```

---

## 📦 Langkah 3: Memasang Dependensi Proyek
Di dalam folder `E:\studio-gateway`, jalankan perintah untuk memasang semua pustaka yang dibutuhkan:
```cmd
npm install
```

---

## ⚙️ Langkah 4: Menyiapkan Konfigurasi Lingkungan (`.env`)
Salin berkas cetak contoh `.env.example` menjadi berkas konfigurasi lokal `.env`:
```cmd
copy .env.example .env
```

Buka berkas `.env` menggunakan notepad atau text editor lainnya, lalu sesuaikan isinya:
* **`RADIOBOSS_API_URL`**: `http://127.0.0.1:9001` (Alamat API lokal RadioBOSS Anda).
* **`RADIOBOSS_API_PASSWORD`**: Masukkan password Remote Control API RadioBOSS Anda.
* **`FIREBASE_PROJECT_ID`**: ID proyek Firebase Anda (misal: `radiosbl`).
* **`GOOGLE_APPLICATION_CREDENTIALS`**: Berikan **path absolut** berkas kredensial (misal: `E:\studio-gateway\service-account.json` agar aman saat berjalan sebagai Windows Service).
* **`GATEWAY_ID`**: Identitas unik komputer ini (misal: `studio-main`).

> [!WARNING]
> Jangan pernah mengunggah berkas `.env` Anda ke GitHub. Berkas ini sudah aman terdaftar di `.gitignore`.

---

## 🔑 Langkah 5: Menyiapkan Kredensial Firebase (`service-account.json`)
1. Masuk ke **Firebase Console** -> Pilih Proyek Anda -> **Project Settings** -> **Service accounts**.
2. Klik tombol **Generate new private key**, berkas `.json` rahasia akan terunduh secara otomatis.
3. Ubah nama berkas unduhan tersebut menjadi **`service-account.json`**.
4. Tempatkan berkas `service-account.json` di dalam folder root proyek Anda:
   `E:\studio-gateway\service-account.json`

> [!WARNING]
> Berkas `service-account.json` berisi kunci akses administrasi penuh ke database Anda. Jangan pernah mengunggahnya ke GitHub!

---

## 🔌 Langkah 6: Mengaktifkan API Remote Control di RadioBOSS
1. Buka aplikasi **RadioBOSS** di komputer studio.
2. Buka menu **Settings** -> **Options** -> pilih menu **API** di bilah kiri.
3. Centang opsi **Enable Remote Control API**.
4. Tetapkan port ke **`9001`** (atau sesuaikan dengan `.env` Anda).
5. Buat atau salin password yang kuat pada kolom **Password**.
6. Klik **OK** untuk menyimpan dan memuat ulang API RadioBOSS.
7. Uji akses API dengan membuka tautan berikut di browser PC studio Anda:
   `http://127.0.0.1:9001/?pass=PASSWORD_ANDA&action=playbackinfo`
   *(Jika menampilkan output XML berisi info lagu, maka API RadioBOSS Anda telah aktif dengan sukses).*

---

## 🏗️ Langkah 7: Mengompilasi Kode Sumber (Build)
Kompilasi kode sumber TypeScript proyek menjadi file JavaScript siap produksi:
```cmd
npm run build
```

---

## 🚀 Langkah 8: Pengujian & Menjalankan Manual
Jalankan agen sinkronisasi secara langsung di layar Command Prompt:
```cmd
npm start
```
*Pastikan log konsol menunjukkan inisialisasi sukses dan data lagu berhasil dipolling secara berkala.*

---

## 🔁 Langkah 9: Mengaktifkan Otomatisasi (Autostart) saat Windows Menyala

Untuk lingkungan studio produksi, disarankan agar agen ini berjalan secara senyap dan otomatis tanpa perlu dibuka manual oleh penyiar. Anda memiliki 3 opsi utama:

### **Pilihan A: Integrasi Pengaturan Internal RadioBOSS (Sangat Direkomendasikan)**
Metode ini adalah opsi paling andal karena agen hanya akan menyala secara senyap saat aplikasi utama RadioBOSS dinyalakan:
1. Buka **RadioBOSS** -> **Settings** -> **Options** -> **General**.
2. Centang opsi **Run program when RadioBOSS starts**.
3. Klik tombol penelusuran berkas (`...`), lalu pilih berkas peluncur senyap **`start-hidden.vbs`** di folder proyek Anda:
   `E:\studio-gateway\start-hidden.vbs`
4. Klik **OK** untuk menyimpan.

### **Pilihan B: Windows Task Scheduler (Penjadwal Tugas Windows)**
Metode ini berguna jika Anda ingin agen menyala langsung saat Windows melakukan logon tanpa bergantung pada aplikasi RadioBOSS:
1. Buka **Task Scheduler** di Windows.
2. Klik **Create Basic Task...** pada bilah kanan.
3. Beri nama tugas: `RadioSBL Studio Gateway Agent`.
4. Trigger: **When I log on** atau **When the computer starts**.
5. Action: **Start a program**.
6. Program/script: `cmd.exe`.
7. Add arguments: `/c start-hidden.vbs` (atau `/c start-gateway.bat` jika ingin memunculkan jendela log).
8. Start in (direktori proyek): `E:\studio-gateway`
9. Klik **Finish** dan centang opsi *Run with highest privileges* jika diperlukan.

### **Pilihan C: PM2 (Process Manager 2)**
PM2 sangat cocok bagi pengembang untuk memantau status hidup mati agen secara profesional:
1. Pasang PM2 secara global di komputer studio:
   ```cmd
   npm install -g pm2 pm2-windows-startup
   ```
2. Daftarkan startup otomatis Windows:
   ```cmd
   pm2-startup install
   ```
3. Jalankan dan daftarkan agen gateway ke PM2:
   ```cmd
   pm2 start dist/index.js --name "radiosbl-gateway"
   ```
4. Simpan daftar proses aktif agar dimuat saat reboot:
   ```cmd
   pm2 save
   ```
5. Untuk melihat log real-time PM2:
   ```cmd
   pm2 logs radiosbl-gateway
   ```

---

## 📝 Langkah 10: Memantau Log
Seluruh jalannya sinkronisasi dan catatan galat akan terekam secara berkala ke berkas log lokal proyek Anda di:
`E:\studio-gateway\gateway.log`

Berkas log ini aman dari kelebihan kapasitas penyimpanan karena dilengkapi fitur **Auto Log Rotation** yang membatasi ukuran maksimal berkas hanya sebesar **5 MB** (otomatis memindahkan isi log lama ke `gateway.old.log` jika kapasitas penuh).

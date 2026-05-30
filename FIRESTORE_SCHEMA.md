# Skema Firestore: Radio SBL Studio Gateway

Dokumen ini mendokumentasikan rancangan struktur data (skema) Firestore yang digunakan oleh **Radio SBL Studio Gateway Agent** untuk melakukan sinkronisasi data dari RadioBOSS lokal.

Semua koleksi dan dokumen yang dibuat oleh agen ini bersifat **read-only bagi publik/aplikasi klien** dan hanya boleh ditulis oleh Firebase Admin SDK yang berjalan lokal di komputer studio.

---

## 1. `radiobossStatus/current`
Dokumen ini menyimpan status operasional teknis terbaru dari pemutar RadioBOSS. Sangat berguna bagi Admin/Studio user untuk mendeteksi apakah RadioBOSS di PC studio sedang aktif atau mengalami kendala.

### Struktur Data
```ts
{
  online: boolean,            // true jika RadioBOSS remote API merespons dengan sukses
  gatewayOnline: boolean,     // selalu true jika agen gateway ini aktif berjalan
  playerState: "playing" | "paused" | "stopped" | "unknown", // status state pemutar
  lastSyncAt: Timestamp,      // waktu sinkronisasi terakhir dilakukan
  latencyMs: number,          // waktu respon API RadioBOSS dalam milidetik
  errorCode?: string,         // kode eror teknis jika terjadi kegagalan (misal: RADIOBOSS_TIMEOUT)
  errorMessageSafe?: string,  // pesan eror ramah pengguna tanpa stack trace mentah
  source: "studio_gateway_agent", // identitas pengirim status
  gatewayId: string           // ID unik gateway (misal: studio-main)
}
```

---

## 2. `radiobossNowPlaying/current`
Dokumen ini menyimpan metadata lagu yang sedang diputar secara real-time. Aplikasi Radio SBL (frontend/mobile) akan membaca dokumen ini secara instan untuk memperbarui tampilan mini player dan halaman pemutar lagu.

### Struktur Data
```ts
{
  artist: string,             // nama penyanyi/artist (trim spasi, maksimal 160 karakter)
  title: string,              // judul lagu/track (trim spasi, maksimal 160 karakter)
  castTitle?: string,         // judul mentah cast title jika tersedia (maksimal 240 karakter)
  album?: string,             // nama album jika tersedia
  durationSeconds?: number,   // durasi total trek dalam satuan detik (integer)
  positionSeconds?: number,   // posisi pemutaran saat ini dalam detik (integer)
  progressPercent?: number,   // persentase kemajuan pemutaran trek (0 - 100)
  nextArtist?: string,        // nama artist untuk trek berikutnya
  nextTitle?: string,         // judul lagu untuk trek berikutnya
  nextCastTitle?: string,     // cast title mentah untuk trek berikutnya
  updatedAt: Timestamp,       // waktu pembaruan metadata terakhir
  source: "radioboss_remote_api", // sumber pengambilan data
  gatewayId: string           // ID unik gateway pengirim
}
```

### Penanganan Fallback (Jika Metadata Kosong)
Jika RadioBOSS tidak memutar apa pun atau metadata yang diterima kosong, dokumen akan dinormalisasi dengan data fallback aman agar tampilan klien tidak rusak:
```json
{
  "artist": "",
  "title": "Radio SBL Live",
  "source": "radioboss_remote_api",
  "updatedAt": "[Timestamp]"
}
```

---

## 3. `radiobossGatewayHeartbeat/{gatewayId}`
Koleksi ini merekam detak jantung (*heartbeat*) dari setiap agen gateway yang aktif. Aplikasi Radio SBL menganggap agen offline jika `lastSeenAt` lebih lama dari **60–90 detik**.

### Struktur Data
```ts
{
  gatewayId: string,          // ID unik gateway (misal: studio-main)
  gatewayName: string,        // nama deskriptif gateway (misal: Studio Utama Radio SBL)
  pcName: string,             // nama host/komputer fisik studio (misal: STUDIO-SBL)
  status: "online" | "offline", // status keaktifan agen
  mode: "read_only",          // mode operasional agen saat ini
  appVersion: string,         // versi aplikasi gateway agent (misal: 1.0.0)
  lastSeenAt: Timestamp       // detak jantung terakhir diperbarui oleh agen
}
```

---

## 4. `radiobossTrackHistory/{trackId}`
Koleksi historis ini menyimpan riwayat seluruh lagu yang telah selesai diputar di studio. Berguna untuk menampilkan daftar "10 lagu terakhir" di aplikasi mobile atau sebagai data referensi AI penulisan naskah siaran di masa mendatang.

### Struktur Data
```ts
{
  artist: string,             // nama penyanyi/artist
  title: string,              // judul lagu
  castTitle?: string,         // judul mentah cast title
  album?: string,             // nama album
  startedAt: Timestamp,       // waktu mulai lagu diputar
  endedAt?: Timestamp,        // waktu lagu selesai diputar
  durationSeconds?: number,   // durasi trek dalam detik
  programId?: string | null,  // ID program siaran aktif (null jika tidak tersinkron)
  programTitle?: string,      // nama program siaran aktif (misal: Program tidak tersinkron)
  source: "radioboss_remote_api", // sumber metadata
  gatewayId: string,          // ID gateway pengirim
  createdAt: Timestamp        // waktu pembuatan dokumen riwayat
}
```

---

## 5. `radiobossAuditLogs/{logId}`
Koleksi ini menyimpan catatan audit log teknis penting yang terjadi pada agen. Berguna untuk memantau performa dan melakukan investigasi teknis bagi Super Admin.

### Struktur Data
```ts
{
  action: string,             // aksi yang terjadi (misal: agent_start, track_change, sync_error)
  mode: "read" | "write" | "system", // tipe operasi audit
  gatewayId: string,          // ID unik gateway pembuat audit
  requestedAt: Timestamp,     // waktu audit diminta/terjadi
  result: "success" | "failed" | "skipped", // hasil dari aksi
  errorCode?: string,         // kode kesalahan teknis jika gagal
  errorMessageSafe?: string,  // penjelasan kesalahan ramah pengguna
  details?: object            // detail tambahan berupa pasangan key-value (misal: nama trek)
}
```

### Lingkup Audit Log Awal
* **`agent_start`**: Ketika agen gateway berhasil dinyalakan.
* **`agent_stop`**: Ketika agen dimatikan secara normal (*graceful shutdown*).
* **`track_change`**: Ketika terjadi transisi pergantian lagu di pemutar.
* **`sync_error`**: Ketika terjadi kesalahan sinkronisasi (seperti timeout atau penulisan Firestore gagal).

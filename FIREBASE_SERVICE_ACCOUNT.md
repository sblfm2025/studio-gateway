# Firebase Service Account untuk Studio Gateway

Gateway membutuhkan service account asli dari Firebase Console agar project kedua/ketiga bisa ditulis lewat Admin SDK.

File contoh tersedia di:

- `samples/service-account-gateway.sample.json`
- `samples/service-account-recording.sample.json`

Jangan memakai file contoh sebagai credential aktif. Field `private_key` harus berasal dari Firebase Console.

## Download Credential Asli

Untuk project `radio-sbl-overlay`:

1. Buka Firebase Console.
2. Pilih project `radio-sbl-overlay`.
3. Project settings.
4. Service accounts.
5. Generate new private key.
6. Simpan file JSON hasil download.

Untuk project `overlaysbl`, ulangi langkah yang sama di project `overlaysbl`.

## Pasang ke Gateway

Setelah kedua file JSON asli tersedia:

```powershell
powershell -ExecutionPolicy Bypass -File install-firebase-credentials.ps1 `
  -GatewayServiceAccount C:\path\radio-sbl-overlay-service-account.json `
  -RecordingServiceAccount C:\path\overlaysbl-service-account.json
```

Script akan:

- Memastikan `project_id` gateway adalah `radio-sbl-overlay`.
- Memastikan `project_id` recording adalah `overlaysbl`.
- Menyalin file ke `service-account-gateway.json` dan `service-account-recording.json`.
- Mengisi path credential di `.env`.

## Verifikasi

```powershell
npm.cmd run verify:go-live
```

Credential sudah aktif jika muncul:

- `Firebase gateway RadioBOSS credential valid untuk 'radio-sbl-overlay'`
- `Firebase recording credential valid untuk 'overlaysbl'`

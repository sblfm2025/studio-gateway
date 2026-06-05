# Studio Gateway Go-Live Checklist

Checklist ini untuk menyalakan kembali RadioSBL Studio Gateway setelah maintenance multi-Firebase.

## Status Firebase

- Firebase utama `radiosbl`: data operasional aplikasi RadioSBL.
- Firebase gateway `radio-sbl-overlay`: RadioBOSS status, now playing, heartbeat, command, request lagu, track history, audit log.
- Firebase recording `overlaysbl`: `programRecordings` dan `programRecordingRules`.

## 1. Pasang Credential Project Tambahan

Siapkan dua file service account JSON dari Firebase Console:

- Project `radio-sbl-overlay`
- Project `overlaysbl`

Lalu jalankan:

```powershell
powershell -ExecutionPolicy Bypass -File install-firebase-credentials.ps1 `
  -GatewayServiceAccount C:\path\gateway.json `
  -RecordingServiceAccount C:\path\recording.json
```

Script akan menolak file jika `project_id` tidak sesuai.

## 2. Login Firebase CLI

```powershell
npx.cmd firebase-tools login
```

Setelah login, cek:

```powershell
npx.cmd firebase-tools projects:list
```

## 3. Deploy Firestore Rules

```powershell
npm.cmd run deploy:rules
```

## 4. Verifikasi Sebelum Start

```powershell
npm.cmd run build
npm.cmd run verify:go-live
```

Status ideal sebelum start:

- `Firebase utama credential valid`
- `Firebase gateway RadioBOSS credential valid`
- `Firebase recording credential valid`
- `firebase-tools via npx tersedia`
- `Firebase CLI sudah login`

## 5. Nyalakan Agent

```powershell
npm.cmd run gateway:enable
powershell -ExecutionPolicy Bypass -File enable-gateway.ps1 -StartNow
```

Atau jalankan manual:

```powershell
cmd.exe /c start-gateway.bat
```

## 6. Pantau Log

```powershell
Get-Content gateway.log -Tail 80
npm.cmd run verify:go-live
```

Pastikan tidak ada error Firestore, tidak ada proses dobel, dan heartbeat berhasil.

## Maintenance Stop

Untuk mematikan agent saat maintenance:

```powershell
npm.cmd run gateway:stop
```

Jika muncul warning akses Scheduled Task tetapi state task sudah `Disabled`, itu cukup aman; script tetap menghentikan proses gateway yang aktif.

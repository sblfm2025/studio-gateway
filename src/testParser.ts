import { parsePlaybackInfo } from './parsePlaybackInfo';
import { normalizePlayback, splitCastTitle } from './normalizeTrack';

// 1. Contoh XML valid representatif dari guideline (Lengkap dengan artist/title terpisah)
const xmlValidSample = `<?xml version="1.0" encoding="utf-8"?>
<Info>
  <CurrentTrack>
    <TRACK
      ARTIST="Tulus"
      TITLE="Hati-Hati di Jalan"
      ALBUM="Manusia"
      CASTTITLE="Tulus - Hati-Hati di Jalan"
      DURATION="04:02"
    />
  </CurrentTrack>
  <Playback
    pos="30000"
    len="242000"
    state="play"
    playlistpos="1"
    streams="1"
    volume="83"
  />
  <NextTrack>
    <TRACK
      ARTIST="Sheila on 7"
      TITLE="Dan"
      ALBUM="Kisah Klasik"
      CASTTITLE="Sheila on 7 - Dan"
      DURATION="04:30"
    />
  </NextTrack>
</Info>`;

// 2. Contoh XML dengan artist/title kosong tetapi CASTTITLE terisi (Menguji splitCastTitle)
const xmlCastTitleOnlySample = `<?xml version="1.0" encoding="utf-8"?>
<Info>
  <CurrentTrack>
    <TRACK
      CASTTITLE="Virzha - Berpura - Pura"
      DURATION="04:15"
    />
  </CurrentTrack>
  <Playback
    pos="45000"
    len="255000"
    state="play"
  />
</Info>`;

// 3. Contoh XML kosong total (Menguji Fallback utama ke "Radio SBL Live")
const xmlEmptyMetadataSample = `<?xml version="1.0" encoding="utf-8"?>
<Info>
  <Playback
    pos="0"
    len="0"
    state="stop"
  />
</Info>`;

console.log('==================================================');
console.log('   Mulai Pengujian Pengurai XML & Normalisasi    ');
console.log('==================================================\n');

// --- PENGUJIAN 1: XML Skenario Valid & Lengkap ---
try {
  console.log('[Test 1] Menjalankan Skenario XML Lengkap...');
  const parsed = parsePlaybackInfo(xmlValidSample);
  const normalized = normalizePlayback(parsed);
  
  console.log('Hasil Normalisasi Skenario Lengkap:');
  console.log(`- playerState:      ${normalized.playerState} (Expected: playing)`);
  console.log(`- artist:           ${normalized.current.artist} (Expected: Tulus)`);
  console.log(`- title:            ${normalized.current.title} (Expected: Hati-Hati di Jalan)`);
  console.log(`- durationSeconds:  ${normalized.current.durationSeconds} (Expected: 242)`);
  console.log(`- positionSeconds:  ${normalized.current.positionSeconds} (Expected: 30)`);
  console.log(`- progressPercent:  ${normalized.current.progressPercent}% (Expected: 12%)`);
  console.log(`- nextArtist:       ${normalized.next.artist} (Expected: Sheila on 7)`);
  console.log(`- nextTitle:        ${normalized.next.title} (Expected: Dan)`);
  console.log('--------------------------------------------------\n');
} catch (err) {
  console.error('[Test 1] GAGAL:', err);
}

// --- PENGUJIAN 2: Uji Pemecahan CASTTITLE ---
try {
  console.log('[Test 2] Menjalankan Uji Coba Pemisahan CASTTITLE...');
  const parsed = parsePlaybackInfo(xmlCastTitleOnlySample);
  const normalized = normalizePlayback(parsed);

  console.log('Hasil Normalisasi Skenario CASTTITLE:');
  console.log(`- artist:           ${normalized.current.artist} (Expected: Virzha)`);
  console.log(`- title:            ${normalized.current.title} (Expected: Berpura - Pura)`);
  console.log(`- durationSeconds:  ${normalized.current.durationSeconds} (Expected: 255)`);
  console.log(`- progressPercent:  ${normalized.current.progressPercent}% (Expected: 18%)`);
  console.log('--------------------------------------------------\n');
} catch (err) {
  console.error('[Test 2] GAGAL:', err);
}

// --- PENGUJIAN 3: Uji Fallback Radio SBL Live ---
try {
  console.log('[Test 3] Menjalankan Uji Coba Fallback Metadata Kosong...');
  const parsed = parsePlaybackInfo(xmlEmptyMetadataSample);
  const normalized = normalizePlayback(parsed);

  console.log('Hasil Normalisasi Skenario Metadata Kosong:');
  console.log(`- playerState:      ${normalized.playerState} (Expected: stopped)`);
  console.log(`- artist:           "${normalized.current.artist}" (Expected: "")`);
  console.log(`- title:            "${normalized.current.title}" (Expected: "Radio SBL Live")`);
  console.log('--------------------------------------------------\n');
} catch (err) {
  console.error('[Test 3] GAGAL:', err);
}

// --- PENGUJIAN 4: Verifikasi Fungsi splitCastTitle Secara Mandiri ---
console.log('[Test 4] Verifikasi Berbagai Variasi Pembatas splitCastTitle:');
const testCases = [
  'Via Vallen - Zombie',
  'Tulus – Hati-Hati di Jalan',
  'Sheila on 7 — Dan',
  'Joko in Berlin | Senapan',
  'LaguTanpaPembatas'
];

testCases.forEach((tc) => {
  const res = splitCastTitle(tc);
  console.log(`  "${tc}" -> artist: "${res.artist}", title: "${res.title}"`);
});

console.log('\n==================================================');
console.log('   SELURUH PENGUJIAN PARSER SELESAI DENGAN SUKSES! ');
console.log('==================================================');

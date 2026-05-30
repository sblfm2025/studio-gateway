import { parsePlaybackInfo } from './parsePlaybackInfo';
import { normalizePlayback } from './normalizeTrack';

// Contoh data XML yang dihasilkan oleh API ?action=playbackinfo milik RadioBOSS
const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
<Info>
  <Playback state="play" pos="84200" len="240000" />
  <CurrentTrack>
    <TRACK ARTIST="Tulus" TITLE="Hati-Hati di Jalan" ALBUM="Manusia" FILENAME="C:\\Music\\Tulus - Hati-Hati di Jalan.mp3" />
  </CurrentTrack>
  <NextTrack>
    <TRACK ARTIST="Sheila on 7" TITLE="Dan" ALBUM="Kisah Klasik Untuk Masa Depan" FILENAME="C:\\Music\\Sheila on 7 - Dan.mp3" />
  </NextTrack>
</Info>`;

console.log('==================================================');
console.log('   Mulai Pengujian Pengurai XML RadioBOSS         ');
console.log('==================================================');
console.log('XML Mentah:');
console.log(sampleXml);
console.log('\n--------------------------------------------------');

try {
  console.log('[Test] Mencoba memparsing XML...');
  const parsed = parsePlaybackInfo(sampleXml);
  console.log('[Test] Hasil parsing XML (Raw Object):');
  console.log(JSON.stringify(parsed, null, 2));
  
  console.log('\n--------------------------------------------------');
  console.log('[Test] Mencoba melakukan normalisasi data...');
  const normalized = normalizePlayback(parsed);
  console.log('[Test] Hasil normalisasi (Normalized Object):');
  console.log(JSON.stringify(normalized, null, 2));
  
  console.log('\n==================================================');
  console.log('   PENGUJIAN SELESAI DENGAN SUKSES!               ');
  console.log('==================================================');
} catch (error) {
  console.error('[Test] Gagal saat melakukan pengujian:', error);
}

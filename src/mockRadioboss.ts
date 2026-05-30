import * as http from 'http';
import * as url from 'url';

const PORT = 9001;

// Simulasi daftar putar lagu untuk RadioBOSS
const playlist = [
  {
    artist: 'Tulus',
    title: 'Hati-Hati di Jalan',
    album: 'Manusia',
    durationMs: 90000 // 90 detik untuk demo cepat
  },
  {
    artist: 'Sheila on 7',
    title: 'Dan',
    album: 'Kisah Klasik Untuk Masa Depan',
    durationMs: 120000 // 120 detik
  },
  {
    artist: 'Joko in Berlin',
    title: 'Senapan',
    album: 'Senapan - Single',
    durationMs: 80000 // 80 detik
  }
];

let currentTrackIndex = 0;
let currentPosMs = 0;
let playerState = 'play'; // play, pause, stop

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url || '', true);
  const query = parsedUrl.query;

  // Respons untuk path root dengan aksi ?action=playbackinfo
  if (query.action === 'playbackinfo') {
    const password = query.pass;
    console.log(`[Mock RadioBOSS] Menerima request API playbackinfo. Pass: "${password}"`);

    const currentTrack = playlist[currentTrackIndex];
    const nextTrackIndex = (currentTrackIndex + 1) % playlist.length;
    const nextTrack = playlist[nextTrackIndex];

    // Buat respons XML dinamis
    const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<Info>
  <Playback state="${playerState}" pos="${currentPosMs}" len="${currentTrack.durationMs}" />
  <CurrentTrack>
    <TRACK ARTIST="${currentTrack.artist}" TITLE="${currentTrack.title}" ALBUM="${currentTrack.album}" FILENAME="C:\\MockMusic\\${currentTrack.artist} - ${currentTrack.title}.mp3" />
  </CurrentTrack>
  <NextTrack>
    <TRACK ARTIST="${nextTrack.artist}" TITLE="${nextTrack.title}" ALBUM="${nextTrack.album}" FILENAME="C:\\MockMusic\\${nextTrack.artist} - ${nextTrack.title}.mp3" />
  </NextTrack>
</Info>`;

    // Simulasi kemajuan posisi pemutaran lagu (posisi bertambah 10 detik setiap kali dipolling)
    if (playerState === 'play') {
      currentPosMs += 10000;
      if (currentPosMs >= currentTrack.durationMs) {
        // Lagu habis, otomatis ganti ke lagu berikutnya!
        console.log(`[Mock RadioBOSS] Lagu "${currentTrack.artist} - ${currentTrack.title}" selesai. Berganti ke lagu berikutnya.`);
        currentTrackIndex = nextTrackIndex;
        currentPosMs = 0;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xmlResponse);
  } else {
    // Jalur default jika parameter tidak sesuai
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Mock RadioBOSS API Server. Gunakan ?pass=PASSWORD&action=playbackinfo');
  }
});

server.listen(PORT, () => {
  console.log('==================================================');
  console.log(`   Mock RadioBOSS API Server berjalan di:        `);
  console.log(`   http://127.0.0.1:${PORT}                      `);
  console.log('==================================================');
  console.log('Simulasi lagu berganti otomatis aktif ketika dipolling.');
  console.log('Tekan Ctrl+C untuk menghentikan server.');
});

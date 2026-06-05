import * as http from "http";

const PORT = 9100; // Menggunakan port 9100 untuk mock agar tidak tabrakan dengan RadioBOSS asli di 9001

// Daftar putar lagu simulasi representatif dengan metadata lengkap
const playlist = [
  {
    artist: "Tulus",
    title: "Hati-Hati di Jalan",
    album: "Manusia",
    castTitle: "Tulus - Hati-Hati di Jalan",
    durationMs: 90000, // 90 detik durasi demo cepat
  },
  {
    artist: "Sheila on 7",
    title: "Dan",
    album: "Kisah Klasik Untuk Masa Depan",
    castTitle: "Sheila on 7 - Dan",
    durationMs: 120000, // 120 detik
  },
  {
    artist: "Joko in Berlin",
    title: "Senapan",
    album: "Senapan - Single",
    castTitle: "Joko in Berlin - Senapan",
    durationMs: 80000, // 80 detik
  },
];

let currentTrackIndex = 0;
let currentPosMs = 30000; // Mulai posisi di detik 30
let playerState = "play";

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const action = requestUrl.searchParams.get("action");

  // Hanya layani request dengan action=playbackinfo
  if (action === "playbackinfo") {
    console.log(
      `[Mock RadioBOSS] Menerima request API playbackinfo. Pass: "[REDACTED]"`,
    );

    const currentTrack = playlist[currentTrackIndex];
    const nextTrackIndex = (currentTrackIndex + 1) % playlist.length;
    const nextTrack = playlist[nextTrackIndex];

    // Buat respons XML representatif sesuai arahan teknis
    const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<Info>
  <CurrentTrack>
    <TRACK
      ARTIST="${currentTrack.artist}"
      TITLE="${currentTrack.title}"
      ALBUM="${currentTrack.album}"
      CASTTITLE="${currentTrack.castTitle}"
      DURATION="04:02"
    />
  </CurrentTrack>
  <Playback
    pos="${currentPosMs}"
    len="${currentTrack.durationMs}"
    state="${playerState}"
    playlistpos="1"
    streams="1"
    volume="83"
  />
  <NextTrack>
    <TRACK
      ARTIST="${nextTrack.artist}"
      TITLE="${nextTrack.title}"
      ALBUM="${nextTrack.album}"
      CASTTITLE="${nextTrack.castTitle}"
      DURATION="04:30"
    />
  </NextTrack>
</Info>`;

    // Simulasi kemajuan posisi pemutaran lagu (posisi bertambah 10 detik setiap kali dipolling)
    if (playerState === "play") {
      currentPosMs += 10000;
      if (currentPosMs >= currentTrack.durationMs) {
        // Lagu habis, otomatis ganti ke lagu berikutnya!
        console.log(
          `[Mock RadioBOSS] Lagu "${currentTrack.artist} - ${currentTrack.title}" selesai. Berganti ke lagu berikutnya.`,
        );
        currentTrackIndex = nextTrackIndex;
        currentPosMs = 0;
      }
    }

    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    res.end(xmlResponse);
  } else {
    // Return error 400 jika parameter action tidak valid atau bukan playbackinfo
    console.warn(
      `[Mock RadioBOSS] Request ditolak. Aksi "${action || ""}" tidak didukung.`,
    );
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "ERR_INVALID_ACTION: Hanya mendukung parameter ?action=playbackinfo",
    );
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("==================================================");
  console.log("   MOCK API SERVER RADIOBOSS AKTIF BERJALAN       ");
  console.log(`   Lokasi API: http://127.0.0.1:${PORT}          `);
  console.log("   Menerima parameter: ?pass=PASS&action=playbackinfo");
  console.log("==================================================");
  console.log("Simulasi kemajuan trek dan rotasi lagu otomatis aktif.");
  console.log("Tekan Ctrl+C untuk menghentikan server tiruan.");
});

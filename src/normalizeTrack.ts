import { RadioBossPlaybackInfo } from './parsePlaybackInfo';

export interface NormalizedPlayback {
  playerState: 'playing' | 'paused' | 'stopped' | 'unknown';
  current: {
    artist: string;
    title: string;
    album: string;
    durationSeconds: number;
    positionSeconds: number;
    progressPercent: number;
  };
  next: {
    artist: string;
    title: string;
  };
}

export function normalizePlayback(playback: RadioBossPlaybackInfo): NormalizedPlayback {
  // Peta status pemutar (RadioBOSS mengirimkan state "play", "pause", atau "stop")
  const playbackStateRaw = playback.Playback?.state || 'stop';
  let playerState: 'playing' | 'paused' | 'stopped' | 'unknown' = 'unknown';
  
  if (playbackStateRaw === 'play') {
    playerState = 'playing';
  } else if (playbackStateRaw === 'pause') {
    playerState = 'paused';
  } else if (playbackStateRaw === 'stop') {
    playerState = 'stopped';
  }

  // Parse posisi dan durasi dari milidetik ke detik
  const posMs = parseInt(playback.Playback?.pos || '0', 10);
  const lenMs = parseInt(playback.Playback?.len || '0', 10);
  
  const positionSeconds = Math.round(posMs / 1000);
  const durationSeconds = Math.round(lenMs / 1000);
  
  // Hitung persentase kemajuan pemutaran
  let progressPercent = 0;
  if (durationSeconds > 0) {
    progressPercent = Math.round((positionSeconds / durationSeconds) * 100);
    // Batasi nilai agar berada di rentang 0 - 100 %
    progressPercent = Math.max(0, Math.min(100, progressPercent));
  }

  // Ambil metadata trek sekarang dengan opsi huruf kapital/kecil atribut cadangan
  const currentTrack = playback.CurrentTrack?.TRACK || {};
  const currentArtist = currentTrack.ARTIST || currentTrack.artist || '';
  const currentTitle = currentTrack.TITLE || currentTrack.title || '';
  const currentAlbum = currentTrack.ALBUM || currentTrack.album || '';

  // Ambil metadata trek berikutnya
  const nextTrack = playback.NextTrack?.TRACK || {};
  const nextArtist = nextTrack.ARTIST || nextTrack.artist || '';
  const nextTitle = nextTrack.TITLE || nextTrack.title || '';

  return {
    playerState,
    current: {
      artist: String(currentArtist).trim(),
      title: String(currentTitle).trim(),
      album: String(currentAlbum).trim(),
      durationSeconds,
      positionSeconds,
      progressPercent
    },
    next: {
      artist: String(nextArtist).trim(),
      title: String(nextTitle).trim()
    }
  };
}

import { RadioBossPlaybackInfo, NormalizedPlayback } from './types';

// Fungsi sanitasi teks: hapus karakter kontrol, trim, dan batasi panjang karakter
export function cleanText(value: unknown, maxLength = 160): string {
  if (value === null || value === undefined) return '';
  const textStr = typeof value === 'string' ? value : String(value);
  return textStr
    .replace(/[\u0000-\u001F\u007F]/g, '') // Hapus karakter kontrol ASCII
    .trim()
    .slice(0, maxLength);
}

// Fungsi memecah CASTTITLE secara cerdas dengan berbagai pembatas standar
export function splitCastTitle(castTitle?: string): { artist: string; title: string } {
  if (!castTitle) return { artist: '', title: '' };

  const normalized = castTitle.trim();
  const separators = [' - ', ' – ', ' — ', ' | '];

  for (const sep of separators) {
    if (normalized.includes(sep)) {
      const parts = normalized.split(sep);
      const artist = parts[0].trim();
      const title = parts.slice(1).join(sep).trim();
      return { artist, title };
    }
  }

  return {
    artist: '',
    title: normalized
  };
}

// Pengurai durasi waktu format "HH:MM:SS" atau "MM:SS" menjadi detik
export function parseDurationToSeconds(value?: string): number | undefined {
  if (!value) return undefined;

  const parts = value.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || isNaN(n))) return undefined;

  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }

  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }

  return undefined;
}

export function normalizePlayback(playback: RadioBossPlaybackInfo): NormalizedPlayback {
  // 1. Normalisasi playerState
  const playbackStateRaw = String(playback.Playback?.state || 'stop').toLowerCase();
  let playerState: 'playing' | 'paused' | 'stopped' | 'unknown' = 'unknown';
  
  if (playbackStateRaw === 'play' || playbackStateRaw === 'playing') {
    playerState = 'playing';
  } else if (playbackStateRaw === 'pause' || playbackStateRaw === 'paused') {
    playerState = 'paused';
  } else if (playbackStateRaw === 'stop' || playbackStateRaw === 'stopped') {
    playerState = 'stopped';
  }

  // 2. Mengambil metadata CurrentTrack & NextTrack
  const currentTrack = playback.CurrentTrack?.TRACK || {};
  const nextTrack = playback.NextTrack?.TRACK || {};

  // -- Current Track Metadata Resolution Hierarchy --
  let currentArtist = cleanText(currentTrack.ARTIST || currentTrack.artist, 160);
  let currentTitle = cleanText(currentTrack.TITLE || currentTrack.title, 160);
  const currentCastTitle = cleanText(currentTrack.CASTTITLE || currentTrack.casttitle, 240);
  const currentAlbum = cleanText(currentTrack.ALBUM || currentTrack.album, 160);

  // Jika artist/title kosong, cek CASTTITLE
  if ((!currentArtist || !currentTitle) && currentCastTitle) {
    const split = splitCastTitle(currentCastTitle);
    if (!currentArtist) currentArtist = cleanText(split.artist, 160);
    if (!currentTitle) currentTitle = cleanText(split.title, 160);
  }

  // Fallback utama jika tetap kosong
  if (!currentArtist && !currentTitle) {
    currentArtist = '';
    currentTitle = 'Radio SBL Live';
  }

  // -- Next Track Metadata Resolution Hierarchy --
  let nextArtist = cleanText(nextTrack.ARTIST || nextTrack.artist, 160);
  let nextTitle = cleanText(nextTrack.TITLE || nextTrack.title, 160);
  const nextCastTitle = cleanText(nextTrack.CASTTITLE || nextTrack.casttitle, 240);

  if ((!nextArtist || !nextTitle) && nextCastTitle) {
    const split = splitCastTitle(nextCastTitle);
    if (!nextArtist) nextArtist = cleanText(split.artist, 160);
    if (!nextTitle) nextTitle = cleanText(split.title, 160);
  }

  // 3. Durasi & Posisi Pemutaran
  const posMs = parseInt(playback.Playback?.pos || '0', 10);
  const lenMs = parseInt(playback.Playback?.len || '0', 10);
  
  let positionSeconds = Math.round(posMs / 1000);
  if (isNaN(positionSeconds) || positionSeconds < 0) positionSeconds = 0;

  // Prioritas Durasi: Playback.len -> CurrentTrack.DURATION -> 0
  let durationSeconds = Math.round(lenMs / 1000);
  if (isNaN(durationSeconds) || durationSeconds <= 0) {
    const durationTrackStr = currentTrack.DURATION || currentTrack.duration;
    const parsedDuration = parseDurationToSeconds(durationTrackStr);
    durationSeconds = parsedDuration !== undefined ? parsedDuration : 0;
  }

  // Hitung persentase progress
  let progressPercent = 0;
  if (durationSeconds > 0) {
    progressPercent = Math.round((positionSeconds / durationSeconds) * 100);
    progressPercent = Math.max(0, Math.min(100, progressPercent)); // Batasi 0 - 100%
  }

  return {
    playerState,
    current: {
      artist: currentArtist,
      title: currentTitle,
      castTitle: currentCastTitle || undefined,
      album: currentAlbum,
      durationSeconds,
      positionSeconds,
      progressPercent
    },
    next: {
      artist: nextArtist,
      title: nextTitle,
      castTitle: nextCastTitle || undefined
    }
  };
}

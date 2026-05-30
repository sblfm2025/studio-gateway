// Interface asli XML dari API RadioBOSS ?action=playbackinfo
export interface RadioBossPlaybackInfo {
  Playback?: {
    state?: string; // 'play', 'pause', 'stop'
    pos?: string; // posisi pemutaran saat ini (milidetik)
    len?: string; // durasi total trek saat ini (milidetik)
    playlistpos?: string;
    streams?: string;
    volume?: string;
  };
  CurrentTrack?: {
    TRACK?: {
      ARTIST?: string;
      TITLE?: string;
      ALBUM?: string;
      CASTTITLE?: string; // format gabungan "Penyanyi - Judul"
      DURATION?: string; // format string waktu (MM:SS atau HH:MM:SS)
      FILENAME?: string;
      [key: string]: any;
    };
  };
  NextTrack?: {
    TRACK?: {
      ARTIST?: string;
      TITLE?: string;
      ALBUM?: string;
      CASTTITLE?: string;
      DURATION?: string;
      FILENAME?: string;
      [key: string]: any;
    };
  };
}

// Interface hasil normalisasi metadata trek
export interface NormalizedPlayback {
  playerState: "playing" | "paused" | "stopped" | "unknown";
  current: {
    artist: string;
    title: string;
    castTitle?: string;
    album: string;
    durationSeconds: number;
    positionSeconds: number;
    progressPercent: number;
  };
  next: {
    artist: string;
    title: string;
    castTitle?: string;
  };
}

// Skema untuk Firestore: radiobossStatus/current
export interface FirestoreRadiobossStatus {
  online: boolean;
  gatewayOnline: boolean;
  playerState: "playing" | "paused" | "stopped" | "unknown";
  lastSyncAt: any; // Firestore Timestamp
  latencyMs: number;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
  source: "studio_gateway_agent";
  gatewayId: string;
}

// Skema untuk Firestore: radiobossNowPlaying/current
export interface FirestoreNowPlaying {
  artist: string;
  title: string;
  castTitle?: string;
  album?: string;
  durationSeconds?: number;
  positionSeconds?: number;
  progressPercent?: number;
  nextArtist?: string;
  nextTitle?: string;
  nextCastTitle?: string;
  updatedAt: any; // Firestore Timestamp
  source: "radioboss_remote_api";
  gatewayId: string;
}

// Skema untuk Firestore: radiobossGatewayHeartbeat/{gatewayId}
export interface FirestoreGatewayHeartbeat {
  gatewayId: string;
  gatewayName: string;
  pcName: string;
  status: "online" | "offline";
  mode: "read_only";
  appVersion: string;
  lastSeenAt: any; // Firestore Timestamp;
}

// Skema untuk Firestore: radiobossTrackHistory/{trackId}
export interface FirestoreTrackHistory {
  artist: string;
  title: string;
  castTitle?: string;
  album?: string;
  startedAt: any; // Firestore Timestamp
  endedAt?: any; // Firestore Timestamp
  durationSeconds?: number;
  programId?: string | null;
  programTitle?: string;
  source: "radioboss_remote_api";
  gatewayId: string;
  createdAt: any; // Firestore Timestamp
}

// Skema untuk Firestore: radiobossAuditLogs/{logId}
export interface FirestoreAuditLog {
  action: string;
  mode: "read" | "write" | "system";
  gatewayId: string;
  requestedAt: any; // Firestore Timestamp
  result: "success" | "failed" | "skipped";
  errorCode?: string;
  errorMessageSafe?: string;
  details?: Record<string, any>;
}

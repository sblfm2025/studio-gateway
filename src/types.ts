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
  mode: "read_only" | "read_write_command_queue";
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

export type RadiobossCommandType =
  | "START_RECORDING"
  | "STOP_RECORDING"
  | "MARK_RECORDING_SKIPPED"
  | "RETRY_COMMAND"
  | "ADD_TRACK_TO_QUEUE"
  | "MARK_REQUEST_PLAYED";

export type RadiobossCommandStatus =
  | "pending"
  | "locked"
  | "executing"
  | "success"
  | "failed"
  | "retryable"
  | "cancelled"
  | "expired";

export interface RadiobossCommand {
  id: string;
  type: RadiobossCommandType;
  status: RadiobossCommandStatus;
  payload: Record<string, any>;
  requestedBy: string;
  requestedByName: string;
  requestedAt?: any;
  priority?: "low" | "normal" | "high";
  dedupeKey?: string;
  attempts: number;
  maxAttempts: number;
  lockedBy?: string | null;
  lockedAt?: any | null;
  executedAt?: any | null;
  gatewayId?: string | null;
  result?: Record<string, any> | null;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

export type RecordingStatus =
  | "waiting_schedule"
  | "waiting_attendance"
  | "ready"
  | "recording"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed"
  | "skipped_no_attendance"
  | "skipped_disabled"
  | "manual_override"
  | "gateway_offline"
  | "radioboss_offline";

export interface ProgramRecordingRule {
  id?: string;
  scheduleId?: string;
  programId: string;
  programName: string;
  recordingEnabled: boolean;
  requireAttendance: boolean;
  autoStart: boolean;
  autoStop: boolean;
  allowManualOverride: boolean;
  startGraceMinutes: number;
  stopGraceMinutes: number;
  maxOverrunMinutes: number;
  minDurationMinutes: number;
  folderSlug: string;
  format: string;
  storageRootKey: string;
}

export interface ProgramRecording {
  id: string;
  recordingId?: string;
  programId: string;
  programName: string;
  scheduleId: string;
  announcerId?: string;
  announcerName?: string;
  status: RecordingStatus;
  plannedStartAt?: any;
  plannedStopAt?: any;
  startedAt?: any;
  stoppedAt?: any | null;
  durationSeconds?: number | null;
  fileName?: string;
  filePath?: string;
  gatewayId?: string;
  source?: string;
  startCommandId?: string | null;
  stopCommandId?: string | null;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

export type SongRequestStatus =
  | "new"
  | "notified"
  | "pending_review"
  | "matched"
  | "needs_review"
  | "sent_to_radioboss"
  | "queued"
  | "played"
  | "rejected"
  | "expired";

export interface SongRequest {
  id: string;
  title: string;
  artist?: string;
  requesterName?: string;
  rawMessage?: string;
  dedication?: string;
  message?: string;
  status: SongRequestStatus;
  matchStatus?: "unmatched" | "matched" | "ambiguous" | "not_found";
  matchedTrackId?: string | null;
  matchedFilePath?: string | null;
  confidence?: number;
  updatedAt?: any;
}

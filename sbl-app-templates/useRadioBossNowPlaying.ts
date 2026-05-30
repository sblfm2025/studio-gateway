import { useState, useEffect } from "react";
import {
  subscribeToNowPlaying,
  subscribeToGatewayHeartbeat,
  RadioBossNowPlaying,
} from "./radiobossNowPlaying.service";

// Definisikan tipe untuk State Hook
export interface UseNowPlayingResult {
  artist: string;
  title: string;
  nextArtist?: string;
  nextTitle?: string;
  progressPercent: number;
  isLive: boolean; // true jika data sinkronisasi valid dan gateway online
  isLoading: boolean;
}

/**
 * React Hook untuk mengambil data Now Playing RadioBOSS secara real-time
 * Dilengkapi pengaman fail-safe detak jantung gateway (Gateway Heartbeat Timeout)
 * @param db Objek Firestore (db) dari firebaseConfig
 * @param gatewayId ID unik gateway (misal: 'studio-main')
 */
export function useRadioBossNowPlaying(
  db: any,
  gatewayId = "studio-main",
): UseNowPlayingResult {
  const [nowPlaying, setNowPlaying] = useState<RadioBossNowPlaying | null>(
    null,
  );
  const [isGatewayOnline, setIsGatewayOnline] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!db) return;

    setIsLoading(true);

    // 1. Subscribe ke Now Playing
    const unsubscribeNowPlaying = subscribeToNowPlaying(db, (data) => {
      setNowPlaying(data);
      setIsLoading(false);
    });

    // 2. Subscribe ke Heartbeat Gateway untuk pengecekan keaktifan yang fail-safe
    const unsubscribeHeartbeat = subscribeToGatewayHeartbeat(
      db,
      gatewayId,
      (heartbeat) => {
        if (!heartbeat) {
          setIsGatewayOnline(false);
          return;
        }

        // Validasi detak jantung: jika lastSeenAt > 90 detik, anggap gateway offline!
        const lastSeen = heartbeat.lastSeenAt;
        if (lastSeen) {
          // Mendukung konversi Timestamp Firestore maupun Date biasa
          const lastSeenMs =
            typeof lastSeen.toMillis === "function"
              ? lastSeen.toMillis()
              : new Date(lastSeen).getTime();
          const secondsElapsed = (Date.now() - lastSeenMs) / 1000;

          if (secondsElapsed > 90 || heartbeat.status === "offline") {
            setIsGatewayOnline(false);
          } else {
            setIsGatewayOnline(true);
          }
        } else {
          setIsGatewayOnline(false);
        }
      },
    );

    return () => {
      unsubscribeNowPlaying();
      unsubscribeHeartbeat();
    };
  }, [db, gatewayId]);

  // -- LOGIKA FALLBACK UTAMA (FAIL-SAFE) --
  // Jika sedang memuat data pertama kali
  if (isLoading) {
    return {
      artist: "",
      title: "Memuat...",
      progressPercent: 0,
      isLive: false,
      isLoading: true,
    };
  }

  // Jika gateway terdeteksi offline / terputus atau data kosong
  if (!isGatewayOnline || !nowPlaying) {
    return {
      artist: "",
      title: "Radio SBL Live",
      progressPercent: 0,
      isLive: false,
      isLoading: false,
    };
  }

  // Cek apakah metadata valid
  const isTitleEmpty = !nowPlaying.title || nowPlaying.title.trim() === "";
  const isFallbackOnly =
    nowPlaying.title === "Radio SBL Live" &&
    (!nowPlaying.artist || nowPlaying.artist.trim() === "");

  if (isTitleEmpty || isFallbackOnly) {
    return {
      artist: "",
      title: "Radio SBL Live",
      progressPercent: 0,
      isLive: false,
      isLoading: false,
    };
  }

  // Kembalikan data sukses dari RadioBOSS
  return {
    artist: nowPlaying.artist,
    title: nowPlaying.title,
    nextArtist: nowPlaying.nextArtist || undefined,
    nextTitle: nowPlaying.nextTitle || undefined,
    progressPercent: nowPlaying.progressPercent || 0,
    isLive: true,
    isLoading: false,
  };
}

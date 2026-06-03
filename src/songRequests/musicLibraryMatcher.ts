import { db, runFirestoreOperation } from "../firebaseClient";
import type { MusicLibraryIndexTrack, SongRequest } from "../types";

function normalize(value = ""): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreTrack(request: SongRequest, track: MusicLibraryIndexTrack): number {
  const requestTitle = normalize(request.title);
  const requestArtist = normalize(request.artist);
  const trackTitle = normalize(track.normalizedTitle || track.title);
  const trackArtist = normalize(track.normalizedArtist || track.artist);

  let score = 0;
  if (requestTitle && trackTitle === requestTitle) score += 70;
  else if (requestTitle && trackTitle.includes(requestTitle)) score += 48;
  else if (requestTitle && requestTitle.includes(trackTitle)) score += 38;

  if (requestArtist && trackArtist === requestArtist) score += 30;
  else if (requestArtist && trackArtist.includes(requestArtist)) score += 18;

  return Math.min(100, score);
}

export async function findBestLibraryMatches(
  request: SongRequest,
): Promise<Array<MusicLibraryIndexTrack & { confidence: number }>> {
  const snapshot = await runFirestoreOperation(
    "query musicLibraryIndex",
    () => db.collection("musicLibraryIndex").limit(500).get(),
  );

  return snapshot.docs
    .map((item: any) => ({ id: item.id, ...(item.data() as Omit<MusicLibraryIndexTrack, "id">) }))
    .map((track: MusicLibraryIndexTrack) => ({
      ...track,
      confidence: scoreTrack(request, track),
    }))
    .filter((track: MusicLibraryIndexTrack & { confidence: number }) => track.confidence > 0)
    .sort(
      (
        left: MusicLibraryIndexTrack & { confidence: number },
        right: MusicLibraryIndexTrack & { confidence: number },
      ) => right.confidence - left.confidence,
    )
    .slice(0, 5);
}

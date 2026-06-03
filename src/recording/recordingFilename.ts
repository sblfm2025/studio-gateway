import * as path from "path";
import { SafeCommandError } from "../commands/commandTypes";

const WINDOWS_ILLEGAL_CHARS = /[<>:"/\\|?*]/g;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function sanitizePathSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(WINDOWS_ILLEGAL_CHARS, " ")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "Radio_SBL";
}

export function buildRecordingFileName({
  date,
  programName,
  announcerName,
  format,
}: {
  date: Date;
  programName: string;
  announcerName: string;
  format: string;
}): string {
  const safeFormat = format.replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp3";
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}-${pad(date.getMinutes())}`,
    sanitizePathSegment(programName),
    sanitizePathSegment(announcerName || "Penyiar"),
  ].join("_") + `.${safeFormat}`;
}

export function buildRecordingFilePath({
  root,
  date,
  folderSlug,
  fileName,
}: {
  root: string;
  date: Date;
  folderSlug: string;
  fileName: string;
}): string {
  const resolvedRoot = path.resolve(root);
  const targetPath = path.resolve(
    resolvedRoot,
    String(date.getFullYear()),
    pad(date.getMonth() + 1),
    sanitizePathSegment(folderSlug),
    fileName,
  );

  const relative = path.relative(resolvedRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SafeCommandError(
      "RECORDING_PATH_OUTSIDE_ROOT",
      "Path rekaman berada di luar root folder yang diizinkan.",
      false,
    );
  }

  return targetPath;
}

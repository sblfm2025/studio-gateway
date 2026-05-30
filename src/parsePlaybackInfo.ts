import { XMLParser } from "fast-xml-parser";
import { RadioBossPlaybackInfo } from "./types";

// Konfigurasi parser agar membaca atribut XML dengan tepat
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false, // Membiarkan string agar diproses konversi secara eksplisit
});

export function parsePlaybackInfo(xmlString: string): RadioBossPlaybackInfo {
  if (!xmlString || xmlString.trim() === "") {
    throw new Error("Response XML RadioBOSS kosong atau tidak valid.");
  }

  try {
    const parsed = parser.parse(xmlString);

    // API Remote Control RadioBOSS mengembalikan objek root <Info>
    const infoObj = parsed.Info || parsed;
    if (!infoObj) {
      return {};
    }

    return infoObj as RadioBossPlaybackInfo;
  } catch (err: any) {
    throw new Error(
      `Format XML RadioBOSS tidak valid: ${err.message || String(err)}`,
    );
  }
}
export { RadioBossPlaybackInfo };

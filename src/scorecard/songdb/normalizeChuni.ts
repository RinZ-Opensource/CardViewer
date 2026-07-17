import type { SongDbRawEntry } from "../../runtimeJson";
import { CHUNI_DUMMY_JACKET } from "../chuniAssets";
import type { ChuniChart, ChuniDifficulty, ChuniSong } from "../chuniTypes";
import { jacketChain, officialJacketUrl } from "./assets";
import type { SupplementalAssets } from "./models";
import { parseFloatField, parseIntField } from "./parseFields";

const CHUNI_DIFF_FIELD: Array<[ChuniDifficulty, string]> = [
  ["basic", "bas"],
  ["advanced", "adv"],
  ["expert", "exp"],
  ["master", "mas"],
  ["ultima", "ult"],
];

export function normalizeChuni(
  entries: SongDbRawEntry[],
  assets: SupplementalAssets,
): ChuniSong[] {
  const songs: ChuniSong[] = [];
  for (const entry of entries) {
    if (!entry.title || !entry.image) continue;
    const id = parseIntField(entry.id);
    if (id === undefined) continue;
    const charts: Partial<Record<ChuniDifficulty, ChuniChart>> = {};
    for (const [difficulty, key] of CHUNI_DIFF_FIELD) {
      const level = entry[`lev_${key}`];
      if (!level) continue;
      charts[difficulty] = {
        level,
        levelValue: parseFloatField(entry[`lev_${key}_i`]) ?? 0,
        notesDesigner: entry[`lev_${key}_designer`] ?? "",
        totalNotes: parseIntField(entry[`lev_${key}_notes`]) ?? 0,
      };
    }
    const weKanji = entry.we_kanji ?? "";
    if (weKanji) {
      charts.worldsend = {
        level: "",
        levelValue: 0,
        notesDesigner: entry.lev_we_designer ?? "",
        totalNotes: parseIntField(entry.lev_we_notes) ?? 0,
      };
    }
    if (Object.keys(charts).length === 0) continue;
    songs.push({
      id,
      title: entry.title,
      artist: entry.artist ?? "",
      ...jacketChain(
        "chunithm",
        entry.image,
        CHUNI_DUMMY_JACKET,
        officialJacketUrl("chunithm", entry.image, assets.jackets),
      ),
      charts,
      bpm: parseIntField(entry.bpm),
      weKanji: weKanji || undefined,
      // we_star comes as odd 1/3/5/7/9 = 1..5 whole stars; (we_star+1)/2 lands
      // exactly on our 0.5-step WE_STAR option scale.
      weStars: weKanji ? ((parseIntField(entry.we_star) ?? 9) + 1) / 2 : undefined,
    });
  }
  return songs;
}

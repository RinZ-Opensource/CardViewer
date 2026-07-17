import type { SongDbRawEntry } from "../../runtimeJson";
import type { MaiChart, MaiDifficulty, MaiSong } from "../types";
import { jacketChain, officialJacketUrl } from "./assets";
import type { SupplementalAssets } from "./models";
import { parseFloatField, parseIntField } from "./parseFields";

/** catcode -> in-game genre id (101.. order matches the sample songs). */
const MAI_GENRE_ID: Record<string, number> = {
  "POPS＆アニメ": 101,
  "niconico＆ボーカロイド": 102,
  "東方Project": 103,
  "ゲーム＆バラエティ": 104,
  maimai: 105,
  "オンゲキ＆CHUNITHM": 106,
};

const MAI_DIFF_FIELD: Array<[MaiDifficulty, string]> = [
  ["basic", "bas"],
  ["advanced", "adv"],
  ["expert", "exp"],
  ["master", "mas"],
  ["remaster", "remas"],
];

/** One chart set (lev_* = Standard, dx_lev_* = DX) of an otoge-db row. */
function maiCharts(entry: SongDbRawEntry, prefix: "lev" | "dx_lev"): MaiChart[] {
  const charts: MaiChart[] = [];
  for (const [difficulty, key] of MAI_DIFF_FIELD) {
    const level = entry[`${prefix}_${key}`];
    if (!level) continue;
    charts.push({
      difficulty,
      level,
      // Constant unknown: approximate from the display level ("13+" -> 13.6).
      levelValue:
        parseFloatField(entry[`${prefix}_${key}_i`]) ??
        (parseIntField(level) ?? 0) + (level.includes("+") ? 0.6 : 0),
      notesDesigner: entry[`${prefix}_${key}_designer`] ?? "",
      // DX score denominator: every note is worth up to 3 (CRITICAL PERFECT).
      maxDxScore: (parseIntField(entry[`${prefix}_${key}_notes`]) ?? 0) * 3,
    });
  }
  return charts;
}

export function normalizeMai(
  entries: SongDbRawEntry[],
  assets: SupplementalAssets,
): MaiSong[] {
  const songs: MaiSong[] = [];
  for (const entry of entries) {
    if (!entry.title || !entry.image_url) continue;
    // 宴会場 (UTAGE) rows only carry lev_utage charts; the card has no utage art.
    if (entry.lev_utage || entry.kanji) continue;
    const sort = parseIntField(entry.sort);
    if (sort === undefined) continue;
    const base = {
      title: entry.title,
      artist: entry.artist ?? "",
      // MaiScoreCard renders "???" for negative BPM.
      bpm: parseIntField(entry.bpm) ?? -1,
      genre: entry.catcode ?? "",
      genreId: MAI_GENRE_ID[entry.catcode ?? ""] ?? 0,
      ...jacketChain(
        "maimai",
        entry.image_url,
        undefined,
        officialJacketUrl("maimai", entry.image_url, assets.jackets),
      ),
    };
    // A row can carry both chart sets; split so the DX/Standard tab art stays
    // per-song. otoge-db has no numeric song id, so sort*10+variant is ours.
    const standard = maiCharts(entry, "lev");
    const dx = maiCharts(entry, "dx_lev");
    if (standard.length > 0) {
      songs.push({ ...base, id: sort * 10, isDx: false, charts: standard });
    }
    if (dx.length > 0) {
      songs.push({ ...base, id: sort * 10 + 1, isDx: true, charts: dx });
    }
  }
  return songs;
}

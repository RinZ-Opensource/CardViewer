import type { SongDbRawEntry } from "../../runtimeJson";
import { ongekiBossIcon, ongekiJacket } from "../ongekiAssets";
import type { OngekiChart, OngekiDifficulty, OngekiSong } from "../ongekiTypes";
import { jacketChain, officialJacketUrl } from "./assets";
import type { OngekiBossMap, OngekiBossMapEntry, SupplementalAssets } from "./models";
import { parseFloatField, parseIntField } from "./parseFields";

const ONGEKI_DIFF_FIELD: Array<[OngekiDifficulty, string]> = [
  ["basic", "bas"],
  ["advanced", "adv"],
  ["expert", "exc"],
  ["master", "mas"],
  ["lunatic", "lnt"],
];

function representativeBosses(
  entries: SongDbRawEntry[],
  bossMap: OngekiBossMap | undefined,
): Map<string, OngekiBossMapEntry> {
  const bossCountsByCharacter = new Map<
    string,
    Map<number, { boss: OngekiBossMapEntry; count: number }>
  >();

  // otoge-db's id normally matches Music.xml SortOrder, but older/removed
  // songs can retain a historical id. Build a deterministic, verified
  // same-character fallback from rows which still have an exact SortOrder
  // mapping so those songs do not collapse to the dummy jacket.
  for (const entry of entries) {
    const boss = bossMap?.songs[entry.id ?? ""];
    const characterKey = entry.chara_id || entry.character;
    if (!boss || !characterKey) continue;
    let counts = bossCountsByCharacter.get(characterKey);
    if (!counts) {
      counts = new Map();
      bossCountsByCharacter.set(characterKey, counts);
    }
    const current = counts.get(boss.bossCardId);
    counts.set(boss.bossCardId, { boss, count: (current?.count ?? 0) + 1 });
  }

  const representativeBossByCharacter = new Map<string, OngekiBossMapEntry>();
  for (const [characterKey, counts] of bossCountsByCharacter) {
    const representative = [...counts.values()].sort(
      (left, right) => right.count - left.count || left.boss.bossCardId - right.boss.bossCardId,
    )[0]?.boss;
    if (representative) representativeBossByCharacter.set(characterKey, representative);
  }
  return representativeBossByCharacter;
}

export function normalizeOngeki(
  entries: SongDbRawEntry[],
  assets: SupplementalAssets,
): OngekiSong[] {
  const bossMap = assets.ongekiBosses;
  const representativeBossByCharacter = representativeBosses(entries, bossMap);
  const songs: OngekiSong[] = [];

  for (const entry of entries) {
    if (!entry.title || !entry.image_url || !entry.id) continue;
    const charts: Partial<Record<OngekiDifficulty, OngekiChart>> = {};
    for (const [difficulty, key] of ONGEKI_DIFF_FIELD) {
      const level = entry[`lev_${key}`];
      if (!level) continue;
      const totalNotes = parseIntField(entry[`lev_${key}_notes`]) ?? 0;
      charts[difficulty] = {
        level,
        levelValue: parseFloatField(entry[`lev_${key}_i`]) ?? 0,
        notesDesigner: entry[`lev_${key}_designer`] ?? "",
        totalNotes,
        bells: parseIntField(entry[`lev_${key}_bells`]) ?? 0,
        // NUM_PScore_MAX: every note is worth up to 2 platinum points.
        platinumScoreMax: totalNotes * 2,
      };
    }
    if (Object.keys(charts).length === 0) continue;

    const attribute = (entry.enemy_type ?? "").toLowerCase();
    const exactBoss = bossMap?.songs[entry.id];
    const characterKey = entry.chara_id || entry.character;
    const representativeBoss = characterKey
      ? representativeBossByCharacter.get(characterKey)
      : undefined;
    const exactBossIconUrl = exactBoss
      ? ongekiBossIcon(exactBoss.bossCardId, bossMap?.version)
      : undefined;
    const representativeBossIconUrl = representativeBoss
      ? ongekiBossIcon(representativeBoss.bossCardId, bossMap?.version)
      : undefined;

    songs.push({
      id: entry.id,
      title: entry.title,
      artist: entry.artist ?? "",
      ...jacketChain(
        "ongeki",
        entry.image_url,
        ongekiJacket("0000"),
        officialJacketUrl("ongeki", entry.image_url, assets.jackets),
      ),
      charts,
      bpm: parseIntField(entry.bpm),
      bossLevel: parseIntField(entry.enemy_lv),
      // FIRE/AQUA/LEAF map onto our union; MULTI and "" stay unset so the
      // form keeps its current selection.
      bossAttribute:
        attribute === "fire" || attribute === "aqua" || attribute === "leaf"
          ? attribute
          : undefined,
      officialMusicId: exactBoss?.musicId,
      bossCardId: exactBoss?.bossCardId,
      bossIconUrl: exactBossIconUrl ?? representativeBossIconUrl,
      bossIconFallbacks:
        exactBossIconUrl &&
        representativeBossIconUrl &&
        representativeBoss?.bossCardId !== exactBoss?.bossCardId
          ? [representativeBossIconUrl]
          : undefined,
    });
  }
  return songs;
}

import { CHUNI_SAMPLE_SONGS } from "./chuniSamples";
import type { ChuniScoreState } from "./chuniTypes";
import { ONGEKI_SAMPLE_SONGS } from "./ongekiSamples";
import type { OngekiScoreState } from "./ongekiTypes";
import { MAI_SAMPLE_SONGS } from "./sampleSongs";
import type { MaiScoreState } from "./types";

export function defaultState(): MaiScoreState {
  const song = MAI_SAMPLE_SONGS[0];
  return {
    songId: song?.id ?? 0,
    songDbBacked: false,
    difficulty: "expert",
    achievement: "100.9950",
    dxScore: "2589",
    dxScoreMax: "",
    comboBadge: "ap",
    syncBadge: "fsdp",
  };
}

export function defaultChuniState(): ChuniScoreState {
  const song = CHUNI_SAMPLE_SONGS[0];
  return {
    songId: song?.id ?? 0,
    songDbBacked: false,
    difficulty: "master",
    level: "13+",
    track: "1",
    speed: "2.0",
    sonic: false,
    mirror: false,
    weKanji: "祭",
    weStars: 3,
    // Music-box defaults; older stored states pick these up via loadStored.
    cardType: "musicbox",
    bestScore: "1007850",
    successLamp: "clear",
    comboLamp: "fc",
    fullChainLamp: "none",
    bpm: "180",
    notesDesigner: "Jack",
    confirmed: false,
    startBanner: "gamestart",
  };
}

export function defaultOngekiState(): OngekiScoreState {
  const song = ONGEKI_SAMPLE_SONGS[0];
  return {
    songId: song?.id ?? "0001",
    songDbBacked: false,
    difficulty: "master",
    level: "13+",
    speed: "9.5",
    sonic: false,
    mirror: false,
    secret: false,
    // MusicBt defaults; older stored states pick these up via loadStored.
    cardType: "musicbt",
    techScore: "1004283",
    battleScore: "5123456",
    platinumScore: "1450",
    platinumScoreMax: "1500",
    overDamage: "254.5",
    battleRank: "great",
    fullBell: true,
    fcLamp: "fc",
    bossLevel: "45",
    bossAttribute: "fire",
    bpm: "180",
    notesDesigner: "-",
  };
}

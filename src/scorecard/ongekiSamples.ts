import { ongekiBossIcon, ongekiJacket } from "./ongekiAssets";
import { OngekiSong } from "./ongekiTypes";

/**
 * Bundled offline fallbacks for the four jackets copied from the export (ids
 * 0001, 0036, 0063, 0064 — 0002-0004 do not exist there). Placeholder labels
 * make an unavailable song DB explicit; a successful load migrates to real
 * rows automatically.
 */
export const ONGEKI_SAMPLE_SONGS: OngekiSong[] = [
  {
    id: "0001",
    title: "Sample Song 0001",
    artist: "Placeholder Artist",
    jacketUrl: ongekiJacket("0001"),
    officialMusicId: "0001",
    bossCardId: 1,
    bossIconUrl: ongekiBossIcon(1),
  },
  {
    id: "0036",
    title: "Sample Song 0036",
    artist: "Placeholder Artist",
    jacketUrl: ongekiJacket("0036"),
    officialMusicId: "0036",
    bossCardId: 100005,
    bossIconUrl: ongekiBossIcon(100005),
  },
  {
    id: "0063",
    title: "Sample Song 0063",
    artist: "Placeholder Artist",
    jacketUrl: ongekiJacket("0063"),
    officialMusicId: "0063",
    bossCardId: 100005,
    bossIconUrl: ongekiBossIcon(100005),
  },
  {
    id: "0064",
    title: "Sample Song 0064",
    artist: "Placeholder Artist",
    jacketUrl: ongekiJacket("0064"),
    officialMusicId: "0064",
    bossCardId: 100014,
    bossIconUrl: ongekiBossIcon(100014),
  },
];

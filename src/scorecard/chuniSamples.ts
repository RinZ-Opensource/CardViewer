import { CHUNI_DUMMY_JACKET } from "./chuniAssets";
import { ChuniSong } from "./chuniTypes";

/**
 * Bundled offline fallbacks. They intentionally use the scene's dummy jacket
 * and local ids only while the complete song DB is unavailable.
 */
export const CHUNI_SAMPLE_SONGS: ChuniSong[] = [
  {
    id: 1,
    title: "Garakuta Doll Play",
    artist: "t+pazolite",
    jacketUrl: CHUNI_DUMMY_JACKET,
  },
  {
    id: 2,
    title: "World Vanquisher",
    artist: "void",
    jacketUrl: CHUNI_DUMMY_JACKET,
  },
  {
    id: 3,
    title: "Trrricksters!!",
    artist: "s-don vs. 翡乃イスカ",
    jacketUrl: CHUNI_DUMMY_JACKET,
  },
  {
    id: 4,
    title: "CHUNITHMのテーマ",
    artist: "セガ ミュージック",
    jacketUrl: CHUNI_DUMMY_JACKET,
  },
];

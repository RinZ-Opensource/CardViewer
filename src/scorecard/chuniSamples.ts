import { CHUNI_DUMMY_JACKET } from "./chuniAssets";
import { ChuniSong } from "./chuniTypes";

/**
 * Bundled demo songs. Real CHUNITHM jackets are not extracted yet, so every
 * entry uses the scene's dummy jacket; ids are local placeholders until the
 * song-database ingestion pipeline lands.
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

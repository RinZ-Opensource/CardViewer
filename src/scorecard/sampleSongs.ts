import { maiJacket } from "./maiAssets";
import { MaiSong } from "./types";

/**
 * Bundled demo songs, extracted from the game data (SDEZ 1.65). Placeholder
 * until the song-database ingestion pipeline lands. maxDxScore is note
 * count x3; only known where taken from a verified score screenshot.
 */
export const MAI_SAMPLE_SONGS: MaiSong[] = [
  {
    id: 11818,
    title: "World's end BLACKBOX",
    artist: "打打だいず",
    bpm: 205,
    genre: "maimai",
    genreId: 105,
    isDx: true,
    jacketUrl: maiJacket(11818),
    charts: [
      { difficulty: "basic", level: "7+", levelValue: 7.8, notesDesigner: "-", maxDxScore: 0 },
      { difficulty: "advanced", level: "10", levelValue: 10.5, notesDesigner: "-", maxDxScore: 0 },
      { difficulty: "expert", level: "13", levelValue: 13.1, notesDesigner: "Luxizhel", maxDxScore: 2637 },
      { difficulty: "master", level: "14+", levelValue: 14.9, notesDesigner: "7sRef -DOVE-", maxDxScore: 0 },
    ],
  },
  {
    id: 11663,
    title: "系ぎて",
    artist: "rintaro soma",
    bpm: 88,
    genre: "maimai",
    genreId: 105,
    isDx: true,
    jacketUrl: maiJacket(11663),
    charts: [
      { difficulty: "basic", level: "7", levelValue: 7, notesDesigner: "-", maxDxScore: 0 },
      { difficulty: "advanced", level: "10", levelValue: 10.5, notesDesigner: "-", maxDxScore: 0 },
      { difficulty: "expert", level: "13+", levelValue: 13.8, notesDesigner: "Luxizhel", maxDxScore: 0 },
      { difficulty: "master", level: "14+", levelValue: 14.7, notesDesigner: "maimai TEAM DX", maxDxScore: 0 },
      { difficulty: "remaster", level: "15", levelValue: 15, notesDesigner: "BEYOND THE MEMORiES", maxDxScore: 0 },
    ],
  },
  {
    id: 11832,
    title: "きゅびびびびずむ",
    artist: "超てんちゃん",
    bpm: 185,
    genre: "POPS＆アニメ",
    genreId: 101,
    isDx: true,
    jacketUrl: maiJacket(11832),
    charts: [
      { difficulty: "basic", level: "5", levelValue: 5, notesDesigner: "-", maxDxScore: 0 },
      { difficulty: "advanced", level: "8", levelValue: 8, notesDesigner: "-", maxDxScore: 0 },
      { difficulty: "expert", level: "12", levelValue: 12, notesDesigner: "はっぴー", maxDxScore: 0 },
      { difficulty: "master", level: "13+", levelValue: 13.8, notesDesigner: "サぴぴぴぴちネファ太太太太コ", maxDxScore: 0 },
    ],
  },
  {
    id: 44,
    title: "ハッピーシンセサイザ",
    artist: "EasyPop",
    bpm: 127,
    genre: "niconico＆ボーカロイド",
    genreId: 102,
    isDx: false,
    jacketUrl: maiJacket(44),
    charts: [
      { difficulty: "basic", level: "5", levelValue: 5, notesDesigner: "-", maxDxScore: 0 },
      { difficulty: "advanced", level: "7+", levelValue: 7.6, notesDesigner: "-", maxDxScore: 0 },
      { difficulty: "expert", level: "9+", levelValue: 9.6, notesDesigner: "譜面-100号", maxDxScore: 0 },
      { difficulty: "master", level: "12", levelValue: 12.5, notesDesigner: "ニャイン", maxDxScore: 0 },
    ],
  },
];

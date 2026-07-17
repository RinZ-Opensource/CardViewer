import { FitText } from "./FitText";
import {
  ONGEKI_BASE_SPRITE,
  ONGEKI_MIRROR_SPRITE,
  ONGEKI_PLUS_SPRITE,
  ONGEKI_SECRET_SPRITE,
  ongekiLevelDigit,
  ongekiSprite,
} from "./ongekiAssets";
import { OngekiScoreState, OngekiSong } from "./ongekiTypes";

/**
 * Design space: ANM_PLY_PlayMusic_00 prefab — PAT_diff_base's serialized
 * 310x162 rect. Coordinates are panel-relative CSS px from the external Ongeki
 * PlayMusic reference dump; runtime behaviour
 * mirrors ANM_PLY_PlayMusic_00 / MusicDataObject / MU3UICounter / MU3Text.
 */
/*
 * NUM_MusicLevel (MU3UICounter): rect 32x22 centred at (149.8,71.7); digit
 * quads 28x30 (size_) at 14px advance (28 + charSpacing_ -14); align=Center
 * puts the run (1 digit = 28 wide, 2 digits = 42) centred on the rect centre.
 * Footer_Plus (20x20): updatePosition resolves to aPos.x = totalWidth/2, i.e.
 * its CENTRE lands exactly on the digit run's right edge (the serialized
 * 1-digit pose aPos=(14, 8.2) = (28/2, 8.2) confirms), centre 8.2px above the
 * counter centre. The digit ink is inset ~7px inside each quad, so the plus
 * reads as flush-right of the last digit.
 */
const LEVEL_CENTER_X = 149.8;
const LEVEL_DIGIT_W = 28;
const LEVEL_ADVANCE = 14;
const PLUS_W = 20;

interface OngekiScoreCardProps {
  song: OngekiSong;
  state: OngekiScoreState;
  /** Overrides the sample song's jacket when set. */
  jacketUrl?: string;
}

export function OngekiScoreCard({ song, state, jacketUrl }: OngekiScoreCardProps) {
  // MusicDataObject: counter = fumenConst with flags_=0 -> truncated integer;
  // the "+" is a separate sprite gated by isFumenConstPlus, not a counter glyph.
  const levelInt = Number.parseInt(state.level, 10);
  const digits = String(Number.isFinite(levelInt) ? Math.max(0, levelInt) : 0);
  const isFumenConstPlus = state.level.includes("+");
  const runWidth = LEVEL_DIGIT_W + (digits.length - 1) * LEVEL_ADVANCE;
  const runLeft = LEVEL_CENTER_X - runWidth / 2;

  // ANM_PLY_PlayMusic_00: "SONIC" at eSpeed.SONIC, else {0:0.00} (9.5 -> "9.50").
  const speedValue = Number.parseFloat(state.speed);
  const speedText = state.sonic
    ? "SONIC"
    : Number.isFinite(speedValue)
      ? speedValue.toFixed(2)
      : state.speed;

  return (
    <div className="ongeki-scorecard">
      {/* setNativeSize + pivot (1,1): top-right corner pinned at (310,0). */}
      <img
        className={`osc-base ${state.difficulty === "lunatic" ? "lunatic" : ""}`}
        src={ongekiSprite(ONGEKI_BASE_SPRITE[state.difficulty])}
        alt=""
      />

      {/* Image type Simple, no preserveAspect: 220x220 S jacket stretched. */}
      <img className="osc-jacket" src={jacketUrl || song.jacketUrl} alt="" decoding="async" />

      {/* MU3Text marquees at 30px/s in-game; statically compressed instead. */}
      <div className="osc-title">
        <FitText maxWidth={180} origin="left">
          {song.title}
        </FitText>
      </div>
      <div className="osc-artist">
        <FitText maxWidth={180} origin="left">
          {song.artist}
        </FitText>
      </div>

      {digits.split("").map((digit, index) => (
        <img
          key={index}
          className="osc-level-digit"
          style={{ left: runLeft + index * LEVEL_ADVANCE }}
          src={ongekiLevelDigit(digit)}
          alt=""
        />
      ))}
      {isFumenConstPlus ? (
        <img
          className="osc-level-plus"
          style={{ left: LEVEL_CENTER_X + runWidth / 2 - PLUS_W / 2 }}
          src={ongekiSprite(ONGEKI_PLUS_SPRITE)}
          alt="+"
        />
      ) : null}

      {/* Prefab sibling order: the secret cover hides jacket/title/level, but
          speed + mirror are later siblings and draw above it. */}
      {state.secret ? (
        <img className="osc-secret" src={ongekiSprite(ONGEKI_SECRET_SPRITE)} alt="" />
      ) : null}

      <div className="osc-speed">
        <FitText maxWidth={40} origin="left">
          {speedText}
        </FitText>
      </div>

      <img
        className="osc-mirror"
        src={ongekiSprite(state.mirror ? ONGEKI_MIRROR_SPRITE.on : ONGEKI_MIRROR_SPRITE.off)}
        alt={state.mirror ? "MIRROR ON" : "MIRROR OFF"}
      />
    </div>
  );
}

import type React from "react";
import { officialAsset } from "../constants";
import { unityRect } from "../geometry";

export type CounterAlign = "center" | "left" | "right";

export function LayerChuCounter({
  value,
  x,
  y,
  rotation,
}: {
  value: string;
  x: number;
  y: number;
  rotation?: number;
}) {
  return (
    <LayerDigitCounter
      className="official-counter chu-counter"
      value={value || "0"}
      sprite={officialAsset("NUM_CHU_Parameter_sheet")}
      x={x}
      y={y}
      w={150}
      h={54}
      rotation={rotation}
      align="center"
      digitWidth={41}
      digitHeight={41}
      signWidth={50}
      signHeight={50}
      charSpacing={-12}
      flags={128}
    />
  );
}

export function LayerDigitCounter({
  value,
  sprite,
  className,
  x,
  y,
  w,
  h,
  rotation,
  scale,
  align,
  digitWidth,
  digitHeight,
  signWidth = digitWidth,
  signHeight = digitHeight,
  charSpacing,
  flags,
}: {
  value: string;
  sprite: string;
  className: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
  align: CounterAlign;
  digitWidth: number;
  digitHeight: number;
  signWidth?: number;
  signHeight?: number;
  charSpacing: number;
  flags: number;
}) {
  const figures = calcCounterFigures(value, flags);
  const widths = figures.map((figure) => counterFigureWidth(figure, digitWidth, signWidth));
  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, widths.length - 1) * charSpacing;
  const anchorPivot = align === "left" ? 0 : align === "right" ? 1 : 0.5;
  const startX = w / 2 - anchorPivot * totalWidth;
  const groupHeight = Math.max(digitHeight, signHeight);
  const groupTop = (h - groupHeight) / 2;
  let cursor = startX;

  return (
    <div className={`official-digit-counter ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      {figures.map((figure, index) => {
        const figureWidth = widths[index];
        const figureHeight = counterFigureHeight(figure, digitHeight, signHeight);
        const localTop = groupTop + (groupHeight - figureHeight) / 2;
        const style: React.CSSProperties = {
          left: `${(cursor / w) * 100}%`,
          top: `${(localTop / h) * 100}%`,
          width: `${(figureWidth / w) * 100}%`,
          height: `${(figureHeight / h) * 100}%`,
          backgroundImage: `url("${sprite}")`,
          backgroundPosition: counterFigureBackgroundPosition(figure),
        };
        cursor += figureWidth + charSpacing;
        return <span className="official-digit" style={style} key={`${figure}-${index}`} />;
      })}
    </div>
  );
}

export function calcCounterFigures(rawValue: string, flags: number) {
  const parsed = Number(rawValue);
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  const figures: number[] = [];
  let digitCount = 0;
  const comma = (flags & 2) !== 0;

  if (value === 0) {
    figures.push(0);
    digitCount = 1;
  } else {
    let remaining = Math.abs(value);
    while (remaining > 0) {
      const next = Math.trunc(remaining / 10);
      figures.push(remaining - next * 10);
      remaining = next;
      digitCount += 1;
      if (comma && digitCount % 3 === 0 && remaining > 0) {
        figures.push(11);
      }
    }
  }

  if (value < 0) {
    figures.push(12);
  } else if ((flags & 1) !== 0 && (value !== 0 || (flags & 128) === 0)) {
    figures.push(10);
  }

  return figures.reverse();
}

export function counterFigureWidth(figure: number, digitWidth: number, signWidth: number) {
  return figure === 10 || figure === 11 || figure === 12 ? signWidth : digitWidth;
}

export function counterFigureHeight(figure: number, digitHeight: number, signHeight: number) {
  return figure === 10 || figure === 11 || figure === 12 ? signHeight : digitHeight;
}

export function counterFigureBackgroundPosition(figure: number) {
  let col = 0;
  let row = 0;
  switch (figure) {
    case 10:
      col = 2;
      row = 2;
      break;
    case 11:
      col = 1;
      row = 3;
      break;
    case 12:
      col = 3;
      row = 2;
      break;
    default:
      col = figure & 3;
      row = figure >> 2;
      break;
  }
  return `${(col / 3) * 100}% ${(row / 3) * 100}%`;
}

import React from "react";
import QRCode from "qrcode";
import { unityRect } from "../geometry";
import type { QrSource } from "../types";

export function LayerQr({
  source,
  x,
  y,
  w,
  h,
}: {
  source: QrSource;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const [dataUrl, setDataUrl] = React.useState("");
  const sourceKey =
    typeof source === "string" ? source : Array.from(source[0]?.data ?? []).join(",");

  React.useEffect(() => {
    let cancelled = false;
    setDataUrl("");
    QRCode.toDataURL(source || "CARDVIEWER", {
      errorCorrectionLevel: "M",
      version: typeof source === "string" ? undefined : 1,
      margin: 0,
      scale: 5,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  return (
    <div
      className="official-qr"
      style={unityRect(x, y, w, h)}
    >
      {dataUrl ? <img src={dataUrl} alt="" /> : null}
    </div>
  );
}

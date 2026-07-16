import { fieldBool, fieldString, maiCharaChoice, maiOfficialHolo, mu3NeedsSign, numericField, officialHolo } from "./cardData";
import { USE_OFFICIAL_ASSETS } from "./constants";
import { isStaticAssetPath } from "./imageLoader";
import type { ImageLoadPriority } from "./imageLoader";
import type { AssetLayer, CardRecord } from "./types";

export function visibleAssetLayers(card: CardRecord | null, streamingAssets?: string) {
  if (!card) return [];
  const layers = card.assetLayers ?? [];
  if (card.game === "MAI") {
    const dynamicLayers = streamingAssets ? dynamicMaiAssetLayers(card, streamingAssets) : [];
    const dynamicKeys = new Set(dynamicLayers.map((layer) => layer.key));
    const fallbackLayers = layers
      .filter((layer) => dynamicKeys.has(layer.key))
      .map(maiFallbackAssetLayer);
    const mergedLayers = [
      ...dynamicLayers,
      ...fallbackLayers,
      ...layers.filter((layer) => !dynamicKeys.has(layer.key)),
    ];
    return mergedLayers.filter((layer) => !isMaiMaskLayer(layer.key) || maiOfficialHolo(card));
  }
  if (card.game === "MU3") {
    return layers.filter((layer) => {
      if (layer.key === "mu3Mask" || layer.key === "mu3Holo") return officialHolo(card);
      if (layer.key === "mu3Sign" || layer.key === "mu3SignMask") {
        return officialHolo(card) && mu3NeedsSign(card);
      }
      if (layer.key === "mu3Grade") return !fieldBool(card, "hideGrade");
      if (layer.key === "mu3Rights") return numericField(card, "rightsId", 0) > 0;
      return true;
    });
  }
  return layers;
}

export function maiFallbackAssetLayer(layer: AssetLayer): AssetLayer {
  return {
    ...layer,
    key: `${layer.key}Fallback`,
    label: `${layer.label} fallback`,
  };
}

export function isMaiMaskLayer(key: string) {
  return key === "maiMask" || key === "maiMaskFallback";
}

export function selectedAssetSignature(card: CardRecord | null, streamingAssets?: string) {
  return visibleAssetLayers(card, streamingAssets)
    .map((layer) => `${layer.key}:${layer.path}`)
    .join("|");
}

export function assetLayerLoadPriority(layer: AssetLayer): ImageLoadPriority {
  return ["mu3Mask", "mu3Holo", "mu3Sign", "mu3SignMask"].includes(layer.key) ? "normal" : "high";
}

export function joinAssetPath(root: string, stem: string) {
  if (isStaticAssetPath(root)) {
    const normalizedRoot = root.replace(/\/+$/, "");
    const fileName = stem.match(/\.(png|jpg|jpeg|webp)$/i) ? stem : `${stem}.png`;
    return `${normalizedRoot}/${fileName}`;
  }
  return `${root}\\${stem}`;
}

export function dynamicMaiAssetLayers(card: CardRecord, streamingAssets: string): AssetLayer[] {
  const typeId = numericField(card, "typeId", -1);
  const charaId = numericField(card, "charaId", -1);
  const choice = maiCharaChoice(card, charaId);
  const mapId = choice?.mapId ?? numericField(card, "mapId", -1);
  const root = fieldString(card, "maiAssetRoot") || `${streamingAssets}\\assets_mai`;
  const layers: AssetLayer[] = [];
  if (typeId >= 0 && mapId >= 0) {
    layers.push({
      key: "maiBase",
      label: "MAI card base",
      path: joinAssetPath(
        root,
        `ui_cardbase_${String(typeId).padStart(7, "0")}_${String(mapId).padStart(6, "0")}`,
      ),
    });
  }
  if (charaId > 0) {
    layers.push({
      key: "maiChara",
      label: "MAI character layer",
      path: joinAssetPath(root, `ui_cardchara_${String(charaId).padStart(6, "0")}`),
    });
    layers.push({
      key: "maiMask",
      label: "MAI holo character mask",
      path: joinAssetPath(root, `ui_cardcharamask_${String(charaId).padStart(6, "0")}`),
    });
  }
  return layers;
}

export function usesPrimaryImageDataUrl(card: CardRecord) {
  return !(USE_OFFICIAL_ASSETS && card.game === "MU3" && card.recordType === "Card");
}

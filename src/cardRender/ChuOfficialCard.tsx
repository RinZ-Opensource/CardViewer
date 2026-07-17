import {
  clampInt,
  fieldBool,
  fieldNumber,
  fieldString,
  twoDigits,
} from "../cardData/fields";
import { formatDisplaySerial } from "../cardData/formatting";
import { officialAsset } from "../constants";
import { LayerChuCounter, LayerImage, LayerUnityText } from "../layers";
import type { CardRecord } from "../types";

export function ChuOfficialCard({
  card,
  imageDataUrl,
}: {
  card: CardRecord;
  imageDataUrl: string;
}) {
  const labelType = clampInt(fieldNumber(card, "labelType", card.labelType ?? 0), 0, 7);
  const difType = clampInt(fieldNumber(card, "difType", card.difType ?? 3), 0, 3);
  const difficultyBase = ["Basic", "Advanced", "Expert", "Master"][difType] ?? "Master";
  const label = twoDigits(labelType);

  return (
    <div className="official-card official-chu">
      {!fieldBool(card, "hideBackGround") ? (
        <LayerImage src={officialAsset(`UI_CCH_Card_BG_${label}`)} x={0} y={0} w={768} h={1052} />
      ) : null}
      {imageDataUrl && !fieldBool(card, "hideChara") ? (
        <LayerImage src={imageDataUrl} x={0} y={0} w={768} h={1052} />
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <LayerImage
          src={officialAsset(`UI_CCH_Card_Parameter_Base_${difficultyBase}`)}
          x={0}
          y={0}
          w={768}
          h={1052}
        />
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <>
          <LayerImage
            src={officialAsset(`UI_CCH_Card_Label_${label}`)}
            x={-335}
            y={-40.8}
            w={125}
            h={36}
            rotation={-90}
          />
          <LayerImage src={officialAsset(`UI_CCH_Card_Label_${label}`)} x={-100} y={-476} w={125} h={36} />
          <LayerImage
            src={officialAsset(`UI_CCH_Card_Label_${label}`)}
            x={334}
            y={-241.6}
            w={125}
            h={36}
            rotation={90}
          />
          <LayerImage
            src={officialAsset(`UI_CCH_Card_LabelLogo_${label}`)}
            x={210.3}
            y={353.4}
            w={341}
            h={176}
          />
        </>
      ) : null}
      {!fieldBool(card, "hideSerialId") && !fieldBool(card, "hideParam") ? (
        <LayerUnityText
          className="official-serial chu-serial"
          fontKey="kaku40"
          fontSize={16}
          alignment={1}
          fitHorizontal
          x={0}
          y={485.9}
          w={258.9}
          h={18}
        >
          {formatDisplaySerial(fieldString(card, "serialId"))}
        </LayerUnityText>
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <LayerUnityText
          className="official-title chu-title"
          fontKey="kaku40"
          fontSize={24}
          alignment={1}
          fitHorizontal
          x={0}
          y={460.7}
          w={688}
          h={27}
        >
          {fieldString(card, "characterName") || card.displayName}
        </LayerUnityText>
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <>
          <LayerUnityText
            className="official-skill-name chu-skill-name"
            fontKey="kaku40"
            fontSize={24}
            alignment={1}
            fitHorizontal
            x={0}
            y={-351}
            w={590}
            h={27}
          >
            {fieldString(card, "skillName")}
          </LayerUnityText>
          <LayerUnityText
            className="official-skill-body chu-skill-body"
            fontKey="kaku40"
            fontSize={24}
            alignment={0}
            lineSpacing={1.2}
            fitHorizontal
            x={0}
            y={-402.7}
            w={590}
            h={53.2}
          >
            {fieldString(card, "skillText")}
          </LayerUnityText>
          <LayerChuCounter value={fieldString(card, "miss") || "0"} x={-330} y={-383} rotation={-90} />
          <LayerChuCounter value={fieldString(card, "combo") || "0"} x={240} y={-471} />
          <LayerChuCounter value={fieldString(card, "chain") || "0"} x={329} y={100} rotation={90} />
        </>
      ) : null}
    </div>
  );
}

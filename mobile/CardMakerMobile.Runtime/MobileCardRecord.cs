using System.Collections.Generic;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileCardRecord
    {
        public MobileCardRecord()
        {
            AssetLayers = new List<MobileAssetLayer>();
            PrintFields = new Dictionary<string, string>();
        }

        public string Id { get; set; }
        public string Game { get; set; }
        public string RecordType { get; set; }
        public string DataName { get; set; }
        public string DisplayName { get; set; }
        public string CharacterName { get; set; }
        public string SkillName { get; set; }
        public string SkillText { get; set; }
        public string ImagePath { get; set; }
        public string ThumbnailPath { get; set; }
        public string SourceXml { get; set; }
        public List<MobileAssetLayer> AssetLayers { get; private set; }
        public Dictionary<string, string> PrintFields { get; private set; }

        public bool HasRenderableAsset
        {
            get { return !string.IsNullOrEmpty(ImagePath) || AssetLayers.Count > 0; }
        }

        public string PrintField(string key)
        {
            string value;
            return PrintFields.TryGetValue(key, out value) ? value : null;
        }

        public bool PrintBool(string key)
        {
            return PrintField(key) == "true";
        }

        public void SetPrintField(string key, string value)
        {
            PrintFields[key] = value ?? "";
            if (key == "characterName" || key == "charaName")
            {
                CharacterName = value ?? "";
                DisplayName = value ?? "";
            }
            else if (key == "skillName" || key == "cardKind")
            {
                SkillName = value ?? "";
            }
            else if (key == "skillText" || key == "effectText")
            {
                SkillText = value ?? "";
            }
        }

        public MobileCardRecord Clone()
        {
            var clone = new MobileCardRecord
            {
                Id = Id,
                Game = Game,
                RecordType = RecordType,
                DataName = DataName,
                DisplayName = DisplayName,
                CharacterName = CharacterName,
                SkillName = SkillName,
                SkillText = SkillText,
                ImagePath = ImagePath,
                ThumbnailPath = ThumbnailPath,
                SourceXml = SourceXml
            };
            for (var i = 0; i < AssetLayers.Count; i++)
            {
                clone.AssetLayers.Add(new MobileAssetLayer
                {
                    Key = AssetLayers[i].Key,
                    Label = AssetLayers[i].Label,
                    Path = AssetLayers[i].Path
                });
            }
            foreach (var item in PrintFields)
            {
                clone.PrintFields[item.Key] = item.Value;
            }
            return clone;
        }

        internal static MobileCardRecord Parse(string json)
        {
            var card = new MobileCardRecord
            {
                Id = JsonLite.ReadStringField(json, "id"),
                Game = JsonLite.ReadStringField(json, "game"),
                RecordType = JsonLite.ReadStringField(json, "recordType"),
                DataName = JsonLite.ReadStringField(json, "dataName"),
                DisplayName = JsonLite.ReadStringField(json, "displayName"),
                CharacterName = JsonLite.ReadStringField(json, "characterName"),
                SkillName = JsonLite.ReadStringField(json, "skillName"),
                SkillText = JsonLite.ReadStringField(json, "skillText"),
                ImagePath = JsonLite.ReadStringField(json, "imagePath"),
                ThumbnailPath = JsonLite.ReadStringField(json, "thumbnailPath"),
                SourceXml = JsonLite.ReadStringField(json, "sourceXml")
            };

            foreach (var layerJson in JsonLite.ReadObjectsFromArray(json, "assetLayers"))
            {
                var path = JsonLite.ReadStringField(layerJson, "path");
                if (string.IsNullOrEmpty(path))
                {
                    continue;
                }
                card.AssetLayers.Add(new MobileAssetLayer
                {
                    Key = JsonLite.ReadStringField(layerJson, "key"),
                    Label = JsonLite.ReadStringField(layerJson, "label"),
                    Path = ArchivePath.Normalize(path)
                });
            }

            foreach (var fieldJson in JsonLite.ReadObjectsFromArray(json, "printFields"))
            {
                var key = JsonLite.ReadStringField(fieldJson, "key");
                if (string.IsNullOrEmpty(key))
                {
                    continue;
                }
                card.PrintFields[key] = JsonLite.ReadStringField(fieldJson, "value") ?? "";
            }

            if (!string.IsNullOrEmpty(card.ImagePath))
            {
                card.ImagePath = ArchivePath.Normalize(card.ImagePath);
            }
            if (!string.IsNullOrEmpty(card.ThumbnailPath))
            {
                card.ThumbnailPath = ArchivePath.Normalize(card.ThumbnailPath);
            }
            return card;
        }
    }
}

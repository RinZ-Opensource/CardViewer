using System.IO;

namespace CardMakerMobile.Runtime
{
    public sealed class MobilePackManifestSummary
    {
        public int SchemaVersion { get; set; }
        public string PackFormat { get; set; }
        public string CardsManifest { get; set; }
        public string IndexManifest { get; set; }
        public string AssetIndex { get; set; }
        public string IntegrityManifest { get; set; }

        public static MobilePackManifestSummary Load(string manifestPath)
        {
            var json = File.ReadAllText(manifestPath);
            var schemaVersion = JsonLite.ReadLongField(json, "schemaVersion");
            var summary = new MobilePackManifestSummary
            {
                SchemaVersion = schemaVersion.HasValue ? (int)schemaVersion.Value : 0,
                PackFormat = JsonLite.ReadStringField(json, "packFormat"),
                CardsManifest = JsonLite.ReadStringField(json, "cardsManifest"),
                IndexManifest = JsonLite.ReadStringField(json, "indexManifest"),
                AssetIndex = JsonLite.ReadStringField(json, "assetIndex"),
                IntegrityManifest = JsonLite.ReadStringField(json, "integrityManifest")
            };
            if (summary.PackFormat == null || summary.IntegrityManifest == null)
            {
                throw new InvalidDataException("Invalid mobile pack manifest.");
            }
            return summary;
        }
    }
}

using System.Collections.Generic;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileBundleRecord
    {
        public MobileBundleRecord()
        {
            Objects = new List<MobileAssetObject>();
        }

        public string SourcePath { get; set; }
        public string Group { get; set; }
        public string BundleDir { get; set; }
        public string MetadataPath { get; set; }
        public string PrimaryPath { get; set; }
        public string PrimaryName { get; set; }
        public string PrimaryPathId { get; set; }
        public int ObjectCount { get; set; }
        public List<MobileAssetObject> Objects { get; private set; }

        internal static MobileBundleRecord Parse(string json)
        {
            var count = JsonLite.ReadLongField(json, "objectCount");
            var bundle = new MobileBundleRecord
            {
                SourcePath = JsonLite.ReadStringField(json, "sourcePath"),
                Group = JsonLite.ReadStringField(json, "group"),
                BundleDir = NormalizeOptional(JsonLite.ReadStringField(json, "bundleDir")),
                MetadataPath = NormalizeOptional(JsonLite.ReadStringField(json, "metadataPath")),
                PrimaryPath = NormalizeOptional(JsonLite.ReadStringField(json, "primaryPath")),
                PrimaryName = JsonLite.ReadStringField(json, "primaryName"),
                PrimaryPathId = JsonLite.ReadStringField(json, "primaryPathId"),
                ObjectCount = count.HasValue ? (int)count.Value : 0
            };

            foreach (var objectJson in JsonLite.ReadObjectsFromArray(json, "objects"))
            {
                var path = JsonLite.ReadStringField(objectJson, "path");
                if (string.IsNullOrEmpty(path))
                {
                    continue;
                }
                var width = JsonLite.ReadLongField(objectJson, "width");
                var height = JsonLite.ReadLongField(objectJson, "height");
                bundle.Objects.Add(new MobileAssetObject
                {
                    Name = JsonLite.ReadStringField(objectJson, "name"),
                    ObjectType = JsonLite.ReadStringField(objectJson, "objectType"),
                    PathId = JsonLite.ReadStringField(objectJson, "pathId"),
                    Width = width.HasValue ? (int)width.Value : 0,
                    Height = height.HasValue ? (int)height.Value : 0,
                    Path = ArchivePath.Normalize(path)
                });
            }

            return bundle;
        }

        private static string NormalizeOptional(string value)
        {
            return string.IsNullOrEmpty(value) ? null : ArchivePath.Normalize(value);
        }
    }
}

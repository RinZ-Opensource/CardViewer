using System;
using System.Collections.Generic;
using System.IO;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileAssetIndex
    {
        public MobileAssetIndex()
        {
            Bundles = new List<MobileBundleRecord>();
        }

        public List<MobileBundleRecord> Bundles { get; private set; }

        public static MobileAssetIndex Load(string assetIndexPath)
        {
            var json = File.ReadAllText(assetIndexPath);
            var index = new MobileAssetIndex();
            foreach (var bundleJson in JsonLite.ReadObjectsFromArray(json, "bundles"))
            {
                index.Bundles.Add(MobileBundleRecord.Parse(bundleJson));
            }
            return index;
        }

        public bool TryResolveOfficialAsset(string group, string officialPathOrName, out string archivePath)
        {
            archivePath = null;
            if (string.IsNullOrEmpty(officialPathOrName))
            {
                return false;
            }

            var request = NormalizeLookup(officialPathOrName);
            var requestFile = LastSegment(request);
            var requestStem = StripExtension(requestFile);

            for (var i = 0; i < Bundles.Count; i++)
            {
                var bundle = Bundles[i];
                if (!GroupMatches(bundle, group))
                {
                    continue;
                }

                var source = NormalizeLookup(bundle.SourcePath);
                var sourceFile = LastSegment(source);
                var sourceStem = StripExtension(sourceFile);
                var primary = NormalizeLookup(bundle.PrimaryPath);
                var primaryFile = LastSegment(primary);
                var primaryStem = StripExtension(primaryFile);

                if (EndsWithPath(source, request)
                    || EqualsIgnoreCase(sourceFile, requestFile)
                    || EqualsIgnoreCase(sourceStem, requestStem)
                    || EndsWithPath(primary, request)
                    || EqualsIgnoreCase(primaryFile, requestFile)
                    || EqualsIgnoreCase(primaryStem, requestStem))
                {
                    archivePath = bundle.PrimaryPath;
                    return true;
                }

                for (var j = 0; j < bundle.Objects.Count; j++)
                {
                    var obj = bundle.Objects[j];
                    var objPath = NormalizeLookup(obj.Path);
                    var objFile = LastSegment(objPath);
                    var objStem = StripExtension(objFile);
                    if (EqualsIgnoreCase(obj.Name, officialPathOrName)
                        || EqualsIgnoreCase(obj.Name, requestStem)
                        || EqualsIgnoreCase(obj.PathId, officialPathOrName)
                        || EndsWithPath(objPath, request)
                        || EqualsIgnoreCase(objFile, requestFile)
                        || EqualsIgnoreCase(objStem, requestStem))
                    {
                        archivePath = obj.Path;
                        return true;
                    }
                }
            }

            return false;
        }

        public IEnumerable<MobileAssetObject> FindObjectsByName(string group, string name)
        {
            for (var i = 0; i < Bundles.Count; i++)
            {
                var bundle = Bundles[i];
                if (!GroupMatches(bundle, group))
                {
                    continue;
                }
                for (var j = 0; j < bundle.Objects.Count; j++)
                {
                    if (EqualsIgnoreCase(bundle.Objects[j].Name, name))
                    {
                        yield return bundle.Objects[j];
                    }
                }
            }
        }

        private static bool GroupMatches(MobileBundleRecord bundle, string group)
        {
            return string.IsNullOrEmpty(group) || EqualsIgnoreCase(bundle.Group, group);
        }

        private static string NormalizeLookup(string value)
        {
            return (value ?? "").Replace('\\', '/').Trim().TrimStart('/').ToLowerInvariant();
        }

        private static string LastSegment(string path)
        {
            var index = path.LastIndexOf('/');
            return index >= 0 ? path.Substring(index + 1) : path;
        }

        private static string StripExtension(string file)
        {
            var index = file.LastIndexOf('.');
            return index > 0 ? file.Substring(0, index) : file;
        }

        private static bool EndsWithPath(string path, string suffix)
        {
            if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(suffix))
            {
                return false;
            }
            return path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)
                && (path.Length == suffix.Length || path[path.Length - suffix.Length - 1] == '/');
        }

        private static bool EqualsIgnoreCase(string left, string right)
        {
            return string.Equals(left ?? "", right ?? "", StringComparison.OrdinalIgnoreCase);
        }
    }
}

using System.Collections.Generic;
using System.IO;
using System;

namespace CardMakerMobile.Runtime
{
    public sealed class CardMakerMobilePack
    {
        private CardMakerMobilePack(string installRoot)
        {
            InstallRoot = Path.GetFullPath(installRoot);
        }

        public string InstallRoot { get; private set; }
        public MobilePackManifestSummary Manifest { get; private set; }
        public MobileCardsIndex CardsIndex { get; private set; }
        public MobileCardCatalog Cards { get; private set; }
        public MobileAssetIndex Assets { get; private set; }

        public static CardMakerMobilePack Load(string installRoot)
        {
            var pack = new CardMakerMobilePack(installRoot);
            pack.Manifest = MobilePackManifestSummary.Load(pack.ResolveArchivePath("manifest.json"));
            pack.Assets = MobileAssetIndex.Load(pack.ResolveArchivePath(pack.Manifest.AssetIndex ?? "assets/index.json"));
            try
            {
                pack.CardsIndex = MobileCardsIndex.Load(pack.ResolveArchivePath(pack.Manifest.IndexManifest ?? "cards.index.json"));
                pack.Cards = MobileCardCatalog.LoadShards(pack.InstallRoot, pack.CardsIndex);
            }
            catch (Exception)
            {
                pack.CardsIndex = new MobileCardsIndex();
                pack.Cards = new MobileCardCatalog();
            }
            return pack;
        }

        public string ResolveArchivePath(string archivePath)
        {
            return ArchivePath.ToSafeFilePath(InstallRoot, archivePath);
        }

        public bool TryResolveArchivePath(string archivePath, out string filePath)
        {
            filePath = null;
            if (string.IsNullOrEmpty(archivePath))
            {
                return false;
            }
            string candidate;
            try
            {
                candidate = ResolveArchivePath(archivePath);
            }
            catch (InvalidDataException)
            {
                return false;
            }
            if (!File.Exists(candidate))
            {
                return false;
            }
            filePath = candidate;
            return true;
        }

        public bool TryResolveOfficialAsset(string group, string officialPathOrName, out string filePath)
        {
            filePath = null;
            string archivePath;
            if (!Assets.TryResolveOfficialAsset(group, officialPathOrName, out archivePath))
            {
                return false;
            }
            return TryResolveArchivePath(archivePath, out filePath);
        }

        public bool TryResolveRaw(string suffix, out string filePath)
        {
            filePath = null;
            if (string.IsNullOrEmpty(suffix))
            {
                return false;
            }

            var rawRoot = ResolveArchivePath("raw");
            if (!Directory.Exists(rawRoot))
            {
                return false;
            }

            var roots = new List<string>(Directory.GetDirectories(rawRoot, "root_*"));
            roots.Sort();
            for (var i = roots.Count - 1; i >= 0; i--)
            {
                string candidate;
                try
                {
                    candidate = ArchivePath.ToSafeFilePath(roots[i], suffix);
                }
                catch (InvalidDataException)
                {
                    return false;
                }
                if (File.Exists(candidate))
                {
                    filePath = candidate;
                    return true;
                }
            }
            return false;
        }

        public bool TryResolveRawDirectory(string suffix, out string directoryPath)
        {
            directoryPath = null;
            if (string.IsNullOrEmpty(suffix))
            {
                return false;
            }

            var rawRoot = ResolveArchivePath("raw");
            if (!Directory.Exists(rawRoot))
            {
                return false;
            }

            var roots = new List<string>(Directory.GetDirectories(rawRoot, "root_*"));
            roots.Sort();
            for (var i = roots.Count - 1; i >= 0; i--)
            {
                string candidate;
                try
                {
                    candidate = ArchivePath.ToSafeFilePath(roots[i], suffix);
                }
                catch (InvalidDataException)
                {
                    return false;
                }
                if (Directory.Exists(candidate))
                {
                    directoryPath = candidate;
                    return true;
                }
            }
            return false;
        }

        public IEnumerable<MobileCardRecord> CardsForGame(string game)
        {
            return Cards.CardsForGame(game);
        }

        public int CountCardsForGame(string game)
        {
            return Cards.CountForGame(game);
        }
    }
}

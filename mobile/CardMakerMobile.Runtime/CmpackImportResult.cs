using System.Collections.Generic;

namespace CardMakerMobile.Runtime
{
    public sealed class CmpackImportResult
    {
        public CmpackImportResult(string installRoot)
        {
            InstallRoot = installRoot;
            ExtractedFiles = new List<string>();
            VerifiedFiles = new List<string>();
        }

        public string InstallRoot { get; private set; }
        public string ManifestPath { get; set; }
        public string CardsManifestPath { get; set; }
        public string CardsIndexPath { get; set; }
        public string AssetIndexPath { get; set; }
        public string IntegrityManifestPath { get; set; }
        public List<string> ExtractedFiles { get; private set; }
        public List<string> VerifiedFiles { get; private set; }
    }
}

namespace CardMakerMobile.Runtime
{
    public sealed class MobileResolvedAsset
    {
        public string Key { get; set; }
        public string ArchivePath { get; set; }
        public string FilePath { get; set; }
        public bool Exists { get; set; }
    }
}

namespace CardMakerMobile.Runtime
{
    public sealed class MobileExportRequest
    {
        public string OutputRoot { get; set; }
        public MobileExportFormat Format { get; set; }
        public bool IncludeHoloMask { get; set; }
        public bool IncludeMetadataJson { get; set; }

        public static MobileExportRequest Default(string outputRoot)
        {
            return new MobileExportRequest
            {
                OutputRoot = outputRoot,
                Format = MobileExportFormat.Png,
                IncludeHoloMask = MobileFeatureFlags.HoloEnabled,
                IncludeMetadataJson = true
            };
        }
    }
}

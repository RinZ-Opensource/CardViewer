namespace CardMakerMobile.Runtime
{
    public sealed class MobileExportPlan
    {
        public MobileCardRecord Card { get; set; }
        public MobileCardRenderPlan RenderPlan { get; set; }
        public MobileExportFormat Format { get; set; }
        public string CardImagePath { get; set; }
        public string HoloMaskPath { get; set; }
        public string MetadataPath { get; set; }
        public bool CanExportImage { get; set; }
        public bool RequiresUnityRender { get; set; }
        public bool RequiresUnityHoloPass { get; set; }
    }
}

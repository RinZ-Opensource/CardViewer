namespace CardMakerMobile.Runtime
{
    public sealed class MobileGameCapabilities
    {
        private MobileGameCapabilities()
        {
        }

        public string Game { get; private set; }
        public string DisplayName { get; private set; }
        public string OfficialRenderer { get; private set; }
        public string OfficialCardData { get; private set; }
        public string ResourceRoute { get; private set; }
        public bool SupportsCardPreview { get; private set; }
        public bool SupportsCardMaskExport { get; private set; }
        public bool SupportsHoloMask { get; private set; }
        public bool SupportsEditablePrintFields { get; private set; }

        public static MobileGameCapabilities ForGame(string game)
        {
            switch (game)
            {
                case "CHU":
                    return new MobileGameCapabilities
                    {
                        Game = "CHU",
                        DisplayName = "CHUNITHM",
                        OfficialRenderer = "CHUCardRenderer",
                        OfficialCardData = "UI_CCH_CardData_00",
                        ResourceRoute = "CHUResourceManager direct image path",
                        SupportsCardPreview = true,
                        SupportsCardMaskExport = true,
                        SupportsHoloMask = false,
                        SupportsEditablePrintFields = true
                    };
                case "MAI":
                    return new MobileGameCapabilities
                    {
                        Game = "MAI",
                        DisplayName = "maimai",
                        OfficialRenderer = "MAICardRenderer",
                        OfficialCardData = "UI_CMA_CardData_00",
                        ResourceRoute = "AssetBundleDB Title.Maimai",
                        SupportsCardPreview = true,
                        SupportsCardMaskExport = false,
                        SupportsHoloMask = MobileFeatureFlags.HoloEnabled,
                        SupportsEditablePrintFields = true
                    };
                case "MU3":
                    return new MobileGameCapabilities
                    {
                        Game = "MU3",
                        DisplayName = "ONGEKI",
                        OfficialRenderer = "MU3CardRenderer",
                        OfficialCardData = "UI_CMN_CardData_00",
                        ResourceRoute = "AssetBundleDB Title.MU3",
                        SupportsCardPreview = true,
                        SupportsCardMaskExport = false,
                        SupportsHoloMask = MobileFeatureFlags.HoloEnabled,
                        SupportsEditablePrintFields = true
                    };
                default:
                    return new MobileGameCapabilities
                    {
                        Game = game ?? "",
                        DisplayName = game ?? "",
                        OfficialRenderer = "",
                        OfficialCardData = "",
                        ResourceRoute = "",
                        SupportsCardPreview = false,
                        SupportsCardMaskExport = false,
                        SupportsHoloMask = false,
                        SupportsEditablePrintFields = false
                    };
            }
        }
    }
}

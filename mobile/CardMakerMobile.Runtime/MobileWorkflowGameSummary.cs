namespace CardMakerMobile.Runtime
{
    public sealed class MobileWorkflowGameSummary
    {
        public string Game { get; set; }
        public int CardCount { get; set; }
        public int PreviewableCount { get; set; }
        public int HoloRequestedCount { get; set; }
        public int MissingInputCount { get; set; }
    }
}

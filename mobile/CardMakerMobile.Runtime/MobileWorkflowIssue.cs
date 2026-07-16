namespace CardMakerMobile.Runtime
{
    public sealed class MobileWorkflowIssue
    {
        public string Severity { get; set; }
        public string Code { get; set; }
        public string Game { get; set; }
        public string CardId { get; set; }
        public string Message { get; set; }
    }
}

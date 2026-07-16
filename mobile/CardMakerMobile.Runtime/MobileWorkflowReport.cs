using System.Collections.Generic;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileWorkflowReport
    {
        public MobileWorkflowReport()
        {
            Games = new List<MobileWorkflowGameSummary>();
            Issues = new List<MobileWorkflowIssue>();
        }

        public List<MobileWorkflowGameSummary> Games { get; private set; }
        public List<MobileWorkflowIssue> Issues { get; private set; }

        public bool HasErrors
        {
            get
            {
                for (var i = 0; i < Issues.Count; i++)
                {
                    if (Issues[i].Severity == "error")
                    {
                        return true;
                    }
                }
                return false;
            }
        }

        public bool IsReadyForOfflinePreview
        {
            get { return !HasErrors; }
        }
    }
}

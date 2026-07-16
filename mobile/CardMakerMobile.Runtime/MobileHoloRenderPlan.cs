using System.Collections.Generic;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileHoloRenderPlan
    {
        public MobileHoloRenderPlan()
        {
            Inputs = new List<MobileResolvedAsset>();
            MissingInputs = new List<string>();
        }

        public bool Requested { get; set; }
        public bool HasMaskInputs { get; set; }
        public bool HasSignInputs { get; set; }
        public string Algorithm { get; set; }
        public List<MobileResolvedAsset> Inputs { get; private set; }
        public List<string> MissingInputs { get; private set; }

        public bool CanGenerateFromStaticInputs
        {
            get { return HasMaskInputs && MissingInputs.Count == 0; }
        }
    }
}

using System.Collections.Generic;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileCardRenderPlan
    {
        public MobileCardRenderPlan(MobileCardRecord card)
        {
            Card = card;
            Layers = new List<MobileResolvedAsset>();
            MissingInputs = new List<string>();
            Holo = new MobileHoloRenderPlan();
        }

        public MobileCardRecord Card { get; private set; }
        public MobileResolvedAsset Primary { get; set; }
        public MobileResolvedAsset Thumbnail { get; set; }
        public List<MobileResolvedAsset> Layers { get; private set; }
        public List<string> MissingInputs { get; private set; }
        public MobileHoloRenderPlan Holo { get; private set; }

        public bool CanPreview
        {
            get
            {
                if (Primary != null && Primary.Exists)
                {
                    return true;
                }
                for (var i = 0; i < Layers.Count; i++)
                {
                    if (Layers[i].Exists)
                    {
                        return true;
                    }
                }
                return false;
            }
        }
    }
}

namespace CardMakerMobile.Runtime
{
    public sealed class MobileCardRenderPlanner
    {
        private readonly CardMakerMobilePack pack;

        public MobileCardRenderPlanner(CardMakerMobilePack pack)
        {
            this.pack = pack;
        }

        public MobileCardRenderPlan Build(MobileCardRecord card)
        {
            var plan = new MobileCardRenderPlan(card);
            plan.Primary = ResolveArchive("primary", card.ImagePath);
            plan.Thumbnail = ResolveArchive("thumbnail", card.ThumbnailPath);

            if (!string.IsNullOrEmpty(card.ImagePath) && !plan.Primary.Exists)
            {
                plan.MissingInputs.Add("imagePath:" + card.ImagePath);
            }

            for (var i = 0; i < card.AssetLayers.Count; i++)
            {
                var layer = card.AssetLayers[i];
                var resolved = ResolveArchive(layer.Key, layer.Path);
                plan.Layers.Add(resolved);
                if (!resolved.Exists)
                {
                    plan.MissingInputs.Add("assetLayer:" + layer.Key + ":" + layer.Path);
                }
            }

            BuildHoloPlan(card, plan);
            return plan;
        }

        private void BuildHoloPlan(MobileCardRecord card, MobileCardRenderPlan plan)
        {
            var holo = plan.Holo;
            holo.Requested = IsHoloRequested(card);
            holo.Algorithm = "official-front-mask-dilate7-root-or";
            if (!MobileFeatureFlags.HoloEnabled)
            {
                return;
            }

            if (card.Game == "MAI")
            {
                AddLayerIfPresent(plan, holo, "maiMask");
                holo.HasMaskInputs = HasInput(holo, "maiMask");
                if (holo.Requested && !holo.HasMaskInputs)
                {
                    holo.MissingInputs.Add("maiMask");
                }
                return;
            }

            if (card.Game == "MU3")
            {
                AddLayerIfPresent(plan, holo, "mu3Mask");
                AddLayerIfPresent(plan, holo, "mu3Holo");
                AddLayerIfPresent(plan, holo, "mu3Sign");
                AddLayerIfPresent(plan, holo, "mu3SignMask");
                holo.HasMaskInputs = HasInput(holo, "mu3Mask") || HasInput(holo, "mu3Holo");
                holo.HasSignInputs = HasInput(holo, "mu3Sign") && HasInput(holo, "mu3SignMask");
                if (holo.Requested && !holo.HasMaskInputs)
                {
                    holo.MissingInputs.Add("mu3MaskOrHolo");
                }
                if (card.PrintBool("sign") && !holo.HasSignInputs)
                {
                    holo.MissingInputs.Add("mu3SignAndSignMask");
                }
            }
        }

        private void AddLayerIfPresent(MobileCardRenderPlan plan, MobileHoloRenderPlan holo, string key)
        {
            for (var i = 0; i < plan.Layers.Count; i++)
            {
                if (plan.Layers[i].Key == key)
                {
                    holo.Inputs.Add(plan.Layers[i]);
                    if (!plan.Layers[i].Exists)
                    {
                        holo.MissingInputs.Add(key);
                    }
                    return;
                }
            }
        }

        private static bool HasInput(MobileHoloRenderPlan plan, string key)
        {
            for (var i = 0; i < plan.Inputs.Count; i++)
            {
                if (plan.Inputs[i].Key == key && plan.Inputs[i].Exists)
                {
                    return true;
                }
            }
            return false;
        }

        private MobileResolvedAsset ResolveArchive(string key, string archivePath)
        {
            var resolved = new MobileResolvedAsset
            {
                Key = key,
                ArchivePath = archivePath
            };
            string filePath;
            if (!string.IsNullOrEmpty(archivePath) && pack.TryResolveArchivePath(archivePath, out filePath))
            {
                resolved.FilePath = filePath;
                resolved.Exists = true;
            }
            return resolved;
        }

        private static bool IsHoloRequested(MobileCardRecord card)
        {
            if (!MobileGameCapabilities.ForGame(card.Game).SupportsHoloMask)
            {
                return false;
            }
            if (card.PrintBool("holo"))
            {
                return true;
            }
            var typeId = card.PrintField("typeId");
            return card.Game == "MAI" && (typeId == "4" || typeId == "6");
        }
    }
}

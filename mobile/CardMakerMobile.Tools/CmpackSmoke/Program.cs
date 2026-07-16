using System;
using System.IO;
using CardMakerMobile.Runtime;

namespace CardMakerMobile.Tools.CmpackSmoke
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            if (args.Length < 1 || args.Length > 2)
            {
                Console.Error.WriteLine("usage: CmpackSmoke <pack.cmpack> [install-root]");
                return 2;
            }

            var cmpackPath = Path.GetFullPath(args[0]);
            var installRoot = args.Length == 2
                ? Path.GetFullPath(args[1])
                : Path.Combine(Path.GetDirectoryName(cmpackPath) ?? ".", "imported", Path.GetFileNameWithoutExtension(cmpackPath));

            try
            {
                var importer = new CmpackImporter();
                var result = importer.Import(cmpackPath, installRoot, true);
                Console.WriteLine("installRoot=" + result.InstallRoot);
                Console.WriteLine("extractedFiles=" + result.ExtractedFiles.Count);
                Console.WriteLine("verifiedFiles=" + result.VerifiedFiles.Count);
                Console.WriteLine("manifest=" + result.ManifestPath);
                Console.WriteLine("cards=" + result.CardsManifestPath);
                Console.WriteLine("index=" + result.CardsIndexPath);
                Console.WriteLine("assets=" + result.AssetIndexPath);
                Console.WriteLine("integrity=" + result.IntegrityManifestPath);

                var pack = CardMakerMobilePack.Load(result.InstallRoot);
                Console.WriteLine("catalogCards=" + pack.Cards.Cards.Count);
                Console.WriteLine("catalogCHU=" + pack.CountCardsForGame("CHU"));
                Console.WriteLine("catalogMAI=" + pack.CountCardsForGame("MAI"));
                Console.WriteLine("catalogMU3=" + pack.CountCardsForGame("MU3"));
                Console.WriteLine("assetBundles=" + pack.Assets.Bundles.Count);

                VerifyCardAssets(pack);
                VerifyRenderPlans(pack);
                VerifyEditAndExportFlow(pack, result.InstallRoot);
                VerifyOfflineClientFlow(result.InstallRoot);
                VerifyOfficialAssetLookup(pack, "mai");
                VerifyOfficialAssetLookup(pack, "mu3");
                VerifyHoloMaskGenerator();

                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.ToString());
                return 1;
            }
        }

        private static void VerifyCardAssets(CardMakerMobilePack pack)
        {
            for (var i = 0; i < pack.Cards.Cards.Count; i++)
            {
                var card = pack.Cards.Cards[i];
                string path;
                if (!string.IsNullOrEmpty(card.ImagePath) && !pack.TryResolveArchivePath(card.ImagePath, out path))
                {
                    throw new FileNotFoundException("Card image does not resolve.", card.ImagePath);
                }
                for (var j = 0; j < card.AssetLayers.Count; j++)
                {
                    if (!pack.TryResolveArchivePath(card.AssetLayers[j].Path, out path))
                    {
                        throw new FileNotFoundException("Card asset layer does not resolve.", card.AssetLayers[j].Path);
                    }
                }
            }
        }

        private static void VerifyOfficialAssetLookup(CardMakerMobilePack pack, string group)
        {
            for (var i = 0; i < pack.Assets.Bundles.Count; i++)
            {
                var bundle = pack.Assets.Bundles[i];
                if (bundle.Group != group)
                {
                    continue;
                }
                var fileName = Path.GetFileName(bundle.SourcePath);
                string resolved;
                if (!pack.TryResolveOfficialAsset(group, fileName, out resolved))
                {
                    throw new FileNotFoundException("Official asset lookup failed.", fileName);
                }
                Console.WriteLine("resolved." + group + "=" + fileName + " -> " + resolved);
                return;
            }
        }

        private static void VerifyRenderPlans(CardMakerMobilePack pack)
        {
            var planner = new MobileCardRenderPlanner(pack);
            var previewable = 0;
            var holoRequested = 0;
            for (var i = 0; i < pack.Cards.Cards.Count; i++)
            {
                var plan = planner.Build(pack.Cards.Cards[i]);
                if (!plan.CanPreview)
                {
                    throw new InvalidOperationException("Card has no preview inputs: " + pack.Cards.Cards[i].Game + "/" + pack.Cards.Cards[i].Id);
                }
                if (plan.MissingInputs.Count > 0)
                {
                    throw new InvalidOperationException("Card render inputs are missing: " + string.Join(",", plan.MissingInputs.ToArray()));
                }
                previewable++;
                if (plan.Holo.Requested)
                {
                    holoRequested++;
                }
                Console.WriteLine(
                    "renderPlan." + pack.Cards.Cards[i].Game
                    + "=" + pack.Cards.Cards[i].Id
                    + ",layers=" + plan.Layers.Count
                    + ",holoRequested=" + plan.Holo.Requested
                    + ",holoInputs=" + plan.Holo.Inputs.Count
                    + ",holoMissing=" + plan.Holo.MissingInputs.Count);
            }
            Console.WriteLine("renderPlans=" + previewable);
            Console.WriteLine("renderPlansHoloRequested=" + holoRequested);
        }

        private static void VerifyHoloMaskGenerator()
        {
            var front = new byte[3 * 3 * 4];
            var root = new byte[3 * 3 * 4];
            root[0] = 255;
            var mask = HoloMaskGenerator.GenerateMaskBytes(front, root, 3, 3, 1);
            if (mask[0] != 255)
            {
                throw new InvalidOperationException("Holo root merge check failed.");
            }

            var baseMask = HoloMaskGenerator.MaskBytesToRgba(mask);
            var sign = new byte[3 * 3 * 4];
            var signMask = new byte[3 * 3 * 4];
            signMask[4 + 3] = 255;
            sign[4 + 3] = 255;
            var signed = HoloMaskGenerator.ApplyMu3SignRgba(baseMask, sign, signMask, 3, 3);
            if (signed[4] != 0 || signed[4 + 3] != 0)
            {
                throw new InvalidOperationException("MU3 sign clear-priority check failed.");
            }
            Console.WriteLine("holoSelfCheck=ok");
        }

        private static void VerifyEditAndExportFlow(CardMakerMobilePack pack, string installRoot)
        {
            MobileCardRecord target = null;
            for (var i = 0; i < pack.Cards.Cards.Count; i++)
            {
                if (pack.Cards.Cards[i].Game == "MAI")
                {
                    target = pack.Cards.Cards[i];
                    break;
                }
            }
            if (target == null)
            {
                target = pack.Cards.Cards[0];
            }

            var editsPath = Path.Combine(installRoot, "smoke-edits.json");
            var session = new MobileEditSession();
            session.SetPrintField(target, "userName", "MOBILE_TEST");
            session.SetPrintField(target, "serialId", "SMOKE-0001");
            session.Save(editsPath);

            var loaded = MobileEditSession.Load(editsPath);
            var editedCard = loaded.Apply(target);
            if (editedCard.PrintField("userName") != "MOBILE_TEST")
            {
                throw new InvalidOperationException("Edit session did not apply userName.");
            }
            if (editedCard.PrintField("serialId") != "SMOKE-0001")
            {
                throw new InvalidOperationException("Edit session did not apply serialId.");
            }

            var renderPlan = new MobileCardRenderPlanner(pack).Build(editedCard);
            if (!renderPlan.CanPreview)
            {
                throw new InvalidOperationException("Edited card cannot build preview plan.");
            }

            var exportRoot = Path.Combine(installRoot, "exports");
            var exportPlan = new MobileExportPlanner().Build(renderPlan, MobileExportRequest.Default(exportRoot));
            if (!exportPlan.CanExportImage)
            {
                throw new InvalidOperationException("Edited card cannot build export plan.");
            }
            if (string.IsNullOrEmpty(exportPlan.CardImagePath) || !exportPlan.CardImagePath.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Export plan did not produce a PNG output path.");
            }

            Console.WriteLine("editSession=" + editsPath);
            Console.WriteLine("editSessionCards=" + loaded.Count);
            Console.WriteLine("exportPlan.card=" + exportPlan.CardImagePath);
            Console.WriteLine("exportPlan.holo=" + (exportPlan.HoloMaskPath ?? ""));
            Console.WriteLine("exportPlan.requiresUnityRender=" + exportPlan.RequiresUnityRender);
            Console.WriteLine("exportPlan.requiresUnityHoloPass=" + exportPlan.RequiresUnityHoloPass);
        }

        private static void VerifyOfflineClientFlow(string installRoot)
        {
            var client = CardMakerMobileOfflineClient.Load(installRoot);
            var report = client.ValidateOfflineFlow();
            if (report.HasErrors)
            {
                throw new InvalidOperationException("Offline workflow validation found errors.");
            }

            for (var i = 0; i < report.Games.Count; i++)
            {
                Console.WriteLine(
                    "workflow." + report.Games[i].Game
                    + ".cards=" + report.Games[i].CardCount
                    + ",previewable=" + report.Games[i].PreviewableCount
                    + ",holoRequested=" + report.Games[i].HoloRequestedCount
                    + ",missingInputs=" + report.Games[i].MissingInputCount);
            }
            Console.WriteLine("workflow.issues=" + report.Issues.Count);

            MobileCardRecord target = null;
            var maiCards = client.ListCards("MAI");
            if (maiCards.Count > 0)
            {
                target = maiCards[0];
            }
            else if (client.Pack.Cards.Cards.Count > 0)
            {
                target = client.Pack.Cards.Cards[0];
            }
            if (target == null)
            {
                throw new InvalidOperationException("Offline client has no cards to select.");
            }

            client.SetPrintField(target.Game, target.Id, "userName", "OFFLINE_CLIENT");
            client.SaveEdits();
            var edited = CardMakerMobileOfflineClient.Load(installRoot).GetCard(target.Game, target.Id);
            if (edited.PrintField("userName") != "OFFLINE_CLIENT")
            {
                throw new InvalidOperationException("Offline client edit was not persisted.");
            }

            var previewPlan = client.BuildPreviewPlan(target.Game, target.Id);
            if (!previewPlan.CanPreview)
            {
                throw new InvalidOperationException("Offline client preview plan is not previewable.");
            }
            var exportPlan = client.BuildExportPlan(
                target.Game,
                target.Id,
                MobileExportRequest.Default(Path.Combine(installRoot, "exports-client")));
            if (!exportPlan.CanExportImage)
            {
                throw new InvalidOperationException("Offline client export plan is not exportable.");
            }

            Console.WriteLine("workflow.editPath=" + client.EditSessionPath);
            Console.WriteLine("workflow.selected=" + target.Game + "/" + target.Id);
            Console.WriteLine("workflow.export=" + exportPlan.CardImagePath);
        }
    }
}

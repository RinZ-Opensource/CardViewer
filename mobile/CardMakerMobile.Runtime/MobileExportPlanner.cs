using System.IO;
using System.Text.RegularExpressions;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileExportPlanner
    {
        public MobileExportPlan Build(MobileCardRenderPlan renderPlan, MobileExportRequest request)
        {
            var outputRoot = string.IsNullOrEmpty(request.OutputRoot) ? "." : request.OutputRoot;
            Directory.CreateDirectory(outputRoot);

            var baseName = SafeFileName(renderPlan.Card.Game + "_" + renderPlan.Card.Id + "_" + renderPlan.Card.DataName);
            var imageExtension = request.Format == MobileExportFormat.Pdf ? ".pdf" : ".png";
            var plan = new MobileExportPlan
            {
                Card = renderPlan.Card,
                RenderPlan = renderPlan,
                Format = request.Format,
                CardImagePath = Path.Combine(outputRoot, baseName + imageExtension),
                CanExportImage = renderPlan.CanPreview && renderPlan.MissingInputs.Count == 0,
                RequiresUnityRender = true,
                RequiresUnityHoloPass = renderPlan.Holo.Requested
                    && (!renderPlan.Holo.CanGenerateFromStaticInputs || renderPlan.Holo.MissingInputs.Count > 0)
            };

            if (request.IncludeHoloMask && renderPlan.Holo.Requested)
            {
                plan.HoloMaskPath = Path.Combine(outputRoot, baseName + ".holo.png");
            }
            if (request.IncludeMetadataJson)
            {
                plan.MetadataPath = Path.Combine(outputRoot, baseName + ".export.json");
            }
            return plan;
        }

        private static string SafeFileName(string value)
        {
            var text = Regex.Replace(value ?? "card", "[^0-9A-Za-z._-]+", "_").Trim('_', '.', '-');
            return string.IsNullOrEmpty(text) ? "card" : text;
        }
    }
}

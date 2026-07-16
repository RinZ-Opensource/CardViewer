using System;
using System.Collections.Generic;
using System.IO;

namespace CardMakerMobile.Runtime
{
    public sealed class CardMakerMobileOfflineClient
    {
        private readonly Dictionary<string, MobileCardRecord> cardsByKey =
            new Dictionary<string, MobileCardRecord>();

        private CardMakerMobileOfflineClient()
        {
        }

        public string InstallRoot { get; private set; }
        public string EditSessionPath { get; private set; }
        public CardMakerMobilePack Pack { get; private set; }
        public MobileEditSession Edits { get; private set; }

        public static CardMakerMobileOfflineClient Import(string cmpackPath, string installRoot, bool overwrite)
        {
            new CmpackImporter().Import(cmpackPath, installRoot, overwrite);
            return Load(installRoot);
        }

        public static CardMakerMobileOfflineClient Load(string installRoot)
        {
            return Load(installRoot, DefaultEditSessionPath(installRoot));
        }

        public static CardMakerMobileOfflineClient Load(string installRoot, string editSessionPath)
        {
            var client = new CardMakerMobileOfflineClient
            {
                InstallRoot = Path.GetFullPath(installRoot),
                EditSessionPath = string.IsNullOrEmpty(editSessionPath)
                    ? DefaultEditSessionPath(installRoot)
                    : Path.GetFullPath(editSessionPath)
            };
            client.Pack = CardMakerMobilePack.Load(client.InstallRoot);
            client.Edits = MobileEditSession.Load(client.EditSessionPath);
            client.IndexCards();
            return client;
        }

        public static string DefaultEditSessionPath(string installRoot)
        {
            return Path.Combine(Path.Combine(Path.GetFullPath(installRoot), "user"), "edits.json");
        }

        public MobileGameCapabilities CapabilitiesForGame(string game)
        {
            return MobileGameCapabilities.ForGame(game);
        }

        public int CountCards(string game)
        {
            return Pack.CountCardsForGame(game);
        }

        public List<MobileCardRecord> ListCards(string game)
        {
            var result = new List<MobileCardRecord>();
            foreach (var card in Pack.CardsForGame(game))
            {
                result.Add(Edits.Apply(card));
            }
            return result;
        }

        public MobileCardRecord GetCard(string game, string id)
        {
            var key = MobileEditSession.CardKey(game, id);
            MobileCardRecord card;
            if (!cardsByKey.TryGetValue(key, out card))
            {
                throw new KeyNotFoundException("Card does not exist: " + key);
            }
            return Edits.Apply(card);
        }

        public bool TryGetCard(string game, string id, out MobileCardRecord card)
        {
            var key = MobileEditSession.CardKey(game, id);
            MobileCardRecord source;
            if (!cardsByKey.TryGetValue(key, out source))
            {
                card = null;
                return false;
            }
            card = Edits.Apply(source);
            return true;
        }

        public void SetPrintField(string game, string id, string fieldKey, string value)
        {
            var source = GetSourceCard(game, id);
            Edits.SetPrintField(source, fieldKey, value);
        }

        public void SetPrintFields(string game, string id, IDictionary<string, string> fields)
        {
            if (fields == null)
            {
                return;
            }
            foreach (var item in fields)
            {
                SetPrintField(game, id, item.Key, item.Value);
            }
        }

        public void SaveEdits()
        {
            Edits.Save(EditSessionPath);
        }

        public MobileCardRenderPlan BuildPreviewPlan(string game, string id)
        {
            return new MobileCardRenderPlanner(Pack).Build(GetCard(game, id));
        }

        public MobileExportPlan BuildExportPlan(string game, string id, MobileExportRequest request)
        {
            if (request == null)
            {
                throw new ArgumentNullException("request");
            }
            var previewPlan = BuildPreviewPlan(game, id);
            return new MobileExportPlanner().Build(previewPlan, request);
        }

        public MobileWorkflowReport ValidateOfflineFlow()
        {
            var report = new MobileWorkflowReport();
            AddGameSummary(report, "CHU");
            AddGameSummary(report, "MAI");
            AddGameSummary(report, "MU3");
            return report;
        }

        private void IndexCards()
        {
            cardsByKey.Clear();
            for (var i = 0; i < Pack.Cards.Cards.Count; i++)
            {
                var card = Pack.Cards.Cards[i];
                cardsByKey[MobileEditSession.CardKey(card.Game, card.Id)] = card;
            }
        }

        private MobileCardRecord GetSourceCard(string game, string id)
        {
            var key = MobileEditSession.CardKey(game, id);
            MobileCardRecord card;
            if (!cardsByKey.TryGetValue(key, out card))
            {
                throw new KeyNotFoundException("Card does not exist: " + key);
            }
            return card;
        }

        private void AddGameSummary(MobileWorkflowReport report, string game)
        {
            var summary = new MobileWorkflowGameSummary { Game = game };
            var planner = new MobileCardRenderPlanner(Pack);
            foreach (var card in Pack.CardsForGame(game))
            {
                summary.CardCount++;
                var plan = planner.Build(Edits.Apply(card));
                if (plan.CanPreview)
                {
                    summary.PreviewableCount++;
                }
                else
                {
                    AddIssue(report, "error", "preview-input-missing", game, card.Id,
                        "Card has no resolved image or official asset layer.");
                }

                for (var i = 0; i < plan.MissingInputs.Count; i++)
                {
                    summary.MissingInputCount++;
                    AddIssue(report, "error", "render-input-missing", game, card.Id,
                        plan.MissingInputs[i]);
                }

                if (plan.Holo.Requested)
                {
                    summary.HoloRequestedCount++;
                    if (!MobileGameCapabilities.ForGame(game).SupportsHoloMask)
                    {
                        AddIssue(report, "warning", "holo-not-supported", game, card.Id,
                            "Official flow for this game does not generate a holo mask.");
                    }
                    for (var i = 0; i < plan.Holo.MissingInputs.Count; i++)
                    {
                        AddIssue(report, "warning", "holo-input-missing", game, card.Id,
                            plan.Holo.MissingInputs[i]);
                    }
                }
            }
            report.Games.Add(summary);
        }

        private static void AddIssue(
            MobileWorkflowReport report,
            string severity,
            string code,
            string game,
            string cardId,
            string message)
        {
            report.Issues.Add(new MobileWorkflowIssue
            {
                Severity = severity,
                Code = code,
                Game = game,
                CardId = cardId,
                Message = message
            });
        }
    }
}

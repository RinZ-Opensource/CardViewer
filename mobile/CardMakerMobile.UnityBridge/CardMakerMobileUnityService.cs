#if UNITY_5_6_OR_NEWER
using System;
using System.Collections.Generic;
using System.IO;
using CardMaker.CHU;
using CardMaker.MAI;
using CardMaker.MU3;
using CardMakerMobile.Runtime;
using UnityEngine;

namespace CardMakerMobile.UnityBridge
{
    public sealed class MobileUnityCardListItem
    {
        public string Game;
        public string Id;
        public string DataName;
        public string DisplayName;
        public string CharacterName;
        public string SkillName;
        public string ThumbnailPath;
        public bool CanPreview;
        public bool HoloRequested;
    }

    public sealed class CardMakerMobileUnityService : MonoBehaviour
    {
        private CardMakerMobileOfflineClient client_;
        private string lastError_;

        public bool IsReady
        {
            get { return client_ != null; }
        }

        public string LastError
        {
            get { return lastError_ ?? string.Empty; }
        }

        public string InstallRoot
        {
            get { return client_ == null ? string.Empty : client_.InstallRoot; }
        }

        public CardMakerMobileOfflineClient Client
        {
            get { return client_; }
        }

        public bool TryImportPack(string cmpackPath, string installRoot, bool overwrite)
        {
            try
            {
                client_ = CardMakerMobileOfflineClient.Import(cmpackPath, installRoot, overwrite);
                CardMakerMobileUnityResources.Initialize(client_.InstallRoot);
                lastError_ = null;
                return true;
            }
            catch (Exception ex)
            {
                lastError_ = ex.ToString();
                Debug.LogError(lastError_);
                return false;
            }
        }

        public bool TryLoadInstalledPack(string installRoot)
        {
            try
            {
                client_ = CardMakerMobileOfflineClient.Load(installRoot);
                CardMakerMobileUnityResources.Initialize(client_.InstallRoot);
                lastError_ = null;
                return true;
            }
            catch (Exception ex)
            {
                lastError_ = ex.ToString();
                Debug.LogError(lastError_);
                return false;
            }
        }

        public void Release()
        {
            client_ = null;
            lastError_ = null;
            CardMakerMobileUnityResources.ReleaseAll();
        }

        public int CountCards(string game)
        {
            RequireReady();
            return client_.CountCards(game);
        }

        public MobileGameCapabilities CapabilitiesForGame(string game)
        {
            RequireReady();
            return client_.CapabilitiesForGame(game);
        }

        public List<MobileCardRecord> ListCards(string game)
        {
            RequireReady();
            return client_.ListCards(game);
        }

        public List<MobileUnityCardListItem> ListCardItems(string game)
        {
            RequireReady();
            List<MobileUnityCardListItem> result = new List<MobileUnityCardListItem>();
            List<MobileCardRecord> cards = client_.ListCards(game);
            for (int i = 0; i < cards.Count; i++)
            {
                MobileCardRenderPlan plan = client_.BuildPreviewPlan(cards[i].Game, cards[i].Id);
                result.Add(new MobileUnityCardListItem
                {
                    Game = cards[i].Game,
                    Id = cards[i].Id,
                    DataName = cards[i].DataName,
                    DisplayName = cards[i].DisplayName,
                    CharacterName = cards[i].CharacterName,
                    SkillName = cards[i].SkillName,
                    ThumbnailPath = cards[i].ThumbnailPath,
                    CanPreview = plan.CanPreview && plan.MissingInputs.Count == 0,
                    HoloRequested = plan.Holo.Requested
                });
            }
            return result;
        }

        public MobileCardRecord GetCard(string game, string id)
        {
            RequireReady();
            return client_.GetCard(game, id);
        }

        public void SetPrintField(string game, string id, string fieldKey, string value)
        {
            RequireReady();
            client_.SetPrintField(game, id, fieldKey, value);
        }

        public void SaveEdits()
        {
            RequireReady();
            client_.SaveEdits();
        }

        public MobileCardRenderPlan BuildPreviewPlan(string game, string id)
        {
            RequireReady();
            return client_.BuildPreviewPlan(game, id);
        }

        public MobileUnityRenderPlanTextures LoadPreviewTextures(string game, string id)
        {
            RequireReady();
            return MobileUnityRenderPlanLoader.Load(client_.BuildPreviewPlan(game, id));
        }

        public bool BindChuCardData(UI_CCH_CardData_00 target, string id)
        {
            RequireReady();
            return BindResult(MobileUnityOfficialCardDataBinder.TryBindChu(
                target,
                client_.GetCard("CHU", id),
                out lastError_));
        }

        public bool BindMaiCardData(UI_CMA_CardData_00 target, string id)
        {
            RequireReady();
            return BindResult(MobileUnityOfficialCardDataBinder.TryBindMai(
                target,
                client_.GetCard("MAI", id),
                out lastError_));
        }

        public bool BindMu3CardData(UI_CMN_CardData_00 target, string id, MU3DataManager dataManager)
        {
            RequireReady();
            return BindResult(MobileUnityOfficialCardDataBinder.TryBindMu3(
                target,
                client_.GetCard("MU3", id),
                dataManager,
                out lastError_));
        }

        public MobileExportPlan BuildExportPlan(string game, string id, string outputRoot)
        {
            RequireReady();
            return client_.BuildExportPlan(game, id, MobileExportRequest.Default(outputRoot));
        }

        public MobileWorkflowReport ValidateOfflineFlow()
        {
            RequireReady();
            return client_.ValidateOfflineFlow();
        }

        public string ValidateOfflineFlowSummary()
        {
            MobileWorkflowReport report = ValidateOfflineFlow();
            List<string> lines = new List<string>();
            lines.Add("ready=" + (!report.HasErrors).ToString());
            for (int i = 0; i < report.Games.Count; i++)
            {
                MobileWorkflowGameSummary game = report.Games[i];
                lines.Add(
                    game.Game
                    + ": cards=" + game.CardCount
                    + ", previewable=" + game.PreviewableCount
                    + ", holoRequested=" + game.HoloRequestedCount
                    + ", missingInputs=" + game.MissingInputCount);
            }
            lines.Add("issues=" + report.Issues.Count);
            for (int i = 0; i < report.Issues.Count; i++)
            {
                MobileWorkflowIssue issue = report.Issues[i];
                lines.Add(
                    issue.Severity
                    + " " + issue.Code
                    + " " + issue.Game
                    + "/" + issue.CardId
                    + ": " + issue.Message);
            }
            return string.Join("\n", lines.ToArray());
        }

        public string DefaultExportRoot()
        {
            RequireReady();
            return Path.Combine(client_.InstallRoot, "exports");
        }

        private void RequireReady()
        {
            if (client_ == null)
            {
                throw new InvalidOperationException("CardMaker mobile pack is not loaded.");
            }
        }

        private bool BindResult(bool ok)
        {
            if (!ok)
            {
                Debug.LogError(lastError_);
            }
            return ok;
        }
    }
}
#endif

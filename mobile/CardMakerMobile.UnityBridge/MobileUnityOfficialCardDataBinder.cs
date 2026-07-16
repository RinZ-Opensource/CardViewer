#if UNITY_5_6_OR_NEWER
using System;
using CardMaker.CHU;
using CardMaker.Common;
using CardMaker.MAI;
using CardMaker.MU3;
using CardMakerMobile.Runtime;
using MaiUserDataRaw = CardMaker.MAI.UserData;

namespace CardMakerMobile.UnityBridge
{
    public static class MobileUnityOfficialCardDataBinder
    {
        public static bool TryBindChu(
            UI_CCH_CardData_00 target,
            MobileCardRecord card,
            out string error)
        {
            error = null;
            if (target == null)
            {
                error = "CHU card data component is null.";
                return false;
            }
            if (!ValidateGame(card, "CHU", out error))
            {
                return false;
            }

            int cardId;
            if (!TryReadId(card, out cardId, out error))
            {
                return false;
            }

            UI_CCH_CardData_00.DispInfo info = default(UI_CCH_CardData_00.DispInfo);
            info.clear(cardId);
            if (info.Data == null)
            {
                error = "Official CHU card data was not found: " + cardId;
                return false;
            }
            info.SerialId = card.PrintField("serialId") ?? string.Empty;
            target.set(info);
            return true;
        }

        public static bool TryBindMai(
            UI_CMA_CardData_00 target,
            MobileCardRecord card,
            out string error)
        {
            error = null;
            if (target == null)
            {
                error = "MAI card data component is null.";
                return false;
            }
            if (!ValidateGame(card, "MAI", out error))
            {
                return false;
            }

            int cardId;
            if (!TryReadId(card, out cardId, out error))
            {
                return false;
            }
            if (!UI_CMA_CardData_00.DispInfo.canSetNoChara(cardId))
            {
                error = "Official MAI card data was not found: " + cardId;
                return false;
            }

            MaiUserDataRaw userData = new MaiUserDataRaw
            {
                userName = FirstNonEmpty(card.PrintField("userName"), "PLAYER"),
                playerRating = ReadInt(card, "rating", 0),
                friendCode = card.PrintBool("hasFriendCode") ? (card.PrintField("friendCode") ?? string.Empty) : string.Empty
            };
            MAIUserData maiUserData = new MAIUserData();
            maiUserData.copyFrom(userData);

            UI_CMA_CardData_00.DispInfo info = new UI_CMA_CardData_00.DispInfo();
            int charaId = ReadInt(card, "charaId", 0);
            if (charaId > 0)
            {
                info.setupWithCharaId(cardId, charaId, maiUserData);
            }
            else
            {
                info.setupNoChara(cardId, maiUserData);
            }
            info.SerialId = card.PrintField("serialId") ?? string.Empty;
            target.set(info);
            return true;
        }

        public static bool TryBindMu3(
            UI_CMN_CardData_00 target,
            MobileCardRecord card,
            MU3DataManager dataManager,
            out string error)
        {
            error = null;
            if (target == null)
            {
                error = "MU3 card data component is null.";
                return false;
            }
            if (!ValidateGame(card, "MU3", out error))
            {
                return false;
            }

            int cardId;
            if (!TryReadId(card, out cardId, out error))
            {
                return false;
            }

            if (dataManager == null && ContextBase<CommonContext>.Exists)
            {
                dataManager = ContextBase<CommonContext>.Instance.MU3DataManager;
            }
            if (dataManager == null)
            {
                error = "MU3DataManager is required before binding official MU3 card data.";
                return false;
            }

            CardMaker.MU3.DataStudio.CardData officialCard = dataManager.getCard(cardId);
            if (officialCard == null)
            {
                error = "Official MU3 card data was not found: " + cardId;
                return false;
            }
            CardMaker.MU3.DataStudio.CharaData officialChara =
                dataManager.getChara(officialCard.CharaID.GetID());

            UI_CMN_CardData_00.CardData info = default(UI_CMN_CardData_00.CardData);
            info.clear(
                officialCard,
                officialChara,
                FirstNonEmpty(card.PrintField("userName"), "PLAYER"),
                ReadInt(card, "ownCount", 1));
            info.serialId_ = card.PrintField("serialId") ?? string.Empty;
            info.holo_ = MobileFeatureFlags.HoloEnabled && card.PrintBool("holo");
            info.awaken_ = ReadMu3Awaken(card);
            info.degitalOnly_ = card.PrintBool("digitalOnly");
            info.hideAttrRarity_ = card.PrintBool("hideAttrRarity");
            info.hideAttackLimit_ = card.PrintBool("hideAttackLimit");
            info.hideSkill_ = card.PrintBool("hideSkill");
            info.hideGrade_ = card.PrintBool("hideGrade");
            info.hideFrame_ = card.PrintBool("hideFrame");
            info.hideName_ = card.PrintBool("hideName");
            info.hideAwaken_ = card.PrintBool("hideAwaken");
            info.hideUserName_ = card.PrintBool("hideUserName");
            info.hideQRCode_ = card.PrintBool("hideQRCode");
            info.hideCardNo_ = card.PrintBool("hideCardNo");

            if (card.PrintBool("sign"))
            {
                ApplyMu3SignLayout(ref info);
            }

            target.initialize(dataManager);
            target.set(info, info.holo_);
            return true;
        }

        private static void ApplyMu3SignLayout(ref UI_CMN_CardData_00.CardData info)
        {
            info.hideAttrRarity_ = true;
            info.hideAttackLimit_ = true;
            info.hideSkill_ = true;
            info.hideGrade_ = true;
            info.hideName_ = true;
            info.hideAwaken_ = true;
            info.hideUserName_ = true;
            info.hideQRCode_ = true;
        }

        private static UI_CMN_CardData_00.Awaken ReadMu3Awaken(MobileCardRecord card)
        {
            int value = ReadInt(card, "awaken", 1);
            if (value <= 0)
            {
                return UI_CMN_CardData_00.Awaken.None;
            }
            if (value == 1)
            {
                return UI_CMN_CardData_00.Awaken.Level0;
            }
            return UI_CMN_CardData_00.Awaken.Level1;
        }

        private static bool ValidateGame(MobileCardRecord card, string game, out string error)
        {
            error = null;
            if (card == null)
            {
                error = "Mobile card record is null.";
                return false;
            }
            if (card.Game != game)
            {
                error = "Expected " + game + " card, got " + (card.Game ?? string.Empty) + ".";
                return false;
            }
            return true;
        }

        private static bool TryReadId(MobileCardRecord card, out int id, out string error)
        {
            error = null;
            if (!int.TryParse(card.Id, out id))
            {
                error = "Card id is not numeric: " + (card.Id ?? string.Empty);
                return false;
            }
            return true;
        }

        private static int ReadInt(MobileCardRecord card, string key, int fallback)
        {
            int value;
            return int.TryParse(card.PrintField(key), out value) ? value : fallback;
        }

        private static string FirstNonEmpty(string value, string fallback)
        {
            return string.IsNullOrEmpty(value) ? fallback : value;
        }
    }
}
#endif

#if UNITY_5_6_OR_NEWER
using CardMaker.Common;
using CardMakerMobile.UnityBridge;
using System.Collections.Generic;
using UnityEngine;

namespace CardMaker.Common
{
    public static class MobileAssetBundleDBBridge
    {
        private static readonly HashSet<string> loggedMisses_ = new HashSet<string>();

        public static Object Load(AssetBundleDB.Title title, string assetBundleName, string name)
        {
            if (!CardMakerMobileUnityResources.IsLoaded && !CardMakerMobileUnityResources.TryInitializeDefault())
            {
                LogMiss(title, assetBundleName, name, "pack-not-loaded");
                return null;
            }

            string group = TitleToGroup(title);
            if (string.IsNullOrEmpty(group))
            {
                LogMiss(title, assetBundleName, name, "unsupported-title");
                return null;
            }

            Object obj = CardMakerMobileUnityResources.LoadTexture(group, assetBundleName);
            if (obj != null)
            {
                return obj;
            }
            obj = CardMakerMobileUnityResources.LoadTexture(group, name);
            if (obj == null)
            {
                LogMiss(title, assetBundleName, name, "texture-not-found");
            }
            return obj;
        }

        public static string TitleToGroup(AssetBundleDB.Title title)
        {
            switch (title)
            {
                case AssetBundleDB.Title.MU3:
                case AssetBundleDB.Title.MU3_Option:
                    return "mu3";
                case AssetBundleDB.Title.Maimai:
                case AssetBundleDB.Title.Maimai_Option:
                    return "mai";
                case AssetBundleDB.Title.Common:
                    return "common";
                case AssetBundleDB.Title.Chunithm:
                case AssetBundleDB.Title.Chunithm_Option:
                    return "chu";
                default:
                    return null;
            }
        }

        private static void LogMiss(AssetBundleDB.Title title, string assetBundleName, string name, string reason)
        {
            string key = title + "|" + assetBundleName + "|" + name + "|" + reason;
            if (loggedMisses_.Contains(key))
            {
                return;
            }
            loggedMisses_.Add(key);
            Debug.LogWarning("CardMakerMobile AssetBundleDBBridge miss title="
                + title + " group=" + TitleToGroup(title)
                + " bundle=" + assetBundleName + " name=" + name
                + " reason=" + reason
                + " installRoot=" + CardMakerMobileUnityResources.DefaultInstallRoot);
        }
    }
}
#endif

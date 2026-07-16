#if UNITY_5_6_OR_NEWER
using System.Collections.Generic;
using CardMakerMobile.Runtime;
using UnityEngine;

namespace CardMakerMobile.UnityBridge
{
    public sealed class MobileUnityRenderPlanTextures
    {
        public Texture2D Primary;
        public Texture2D Thumbnail;
        public readonly Dictionary<string, Texture2D> Layers = new Dictionary<string, Texture2D>();
        public readonly Dictionary<string, Texture2D> HoloInputs = new Dictionary<string, Texture2D>();
    }

    public static class MobileUnityRenderPlanLoader
    {
        public static MobileUnityRenderPlanTextures Load(MobileCardRenderPlan plan)
        {
            MobileUnityRenderPlanTextures textures = new MobileUnityRenderPlanTextures();
            if (plan == null)
            {
                return textures;
            }

            textures.Primary = LoadResolved(plan.Primary);
            textures.Thumbnail = LoadResolved(plan.Thumbnail);

            for (int i = 0; i < plan.Layers.Count; i++)
            {
                Texture2D texture = LoadResolved(plan.Layers[i]);
                if (texture != null && !string.IsNullOrEmpty(plan.Layers[i].Key))
                {
                    textures.Layers[plan.Layers[i].Key] = texture;
                }
            }

            for (int i = 0; i < plan.Holo.Inputs.Count; i++)
            {
                Texture2D texture = LoadResolved(plan.Holo.Inputs[i]);
                if (texture != null && !string.IsNullOrEmpty(plan.Holo.Inputs[i].Key))
                {
                    textures.HoloInputs[plan.Holo.Inputs[i].Key] = texture;
                }
            }

            return textures;
        }

        private static Texture2D LoadResolved(MobileResolvedAsset asset)
        {
            if (asset == null || string.IsNullOrEmpty(asset.ArchivePath))
            {
                return null;
            }
            return CardMakerMobileUnityResources.LoadTextureFromArchiveOrRaw(asset.ArchivePath);
        }
    }
}
#endif

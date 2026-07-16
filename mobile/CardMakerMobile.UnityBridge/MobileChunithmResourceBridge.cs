#if UNITY_5_6_OR_NEWER
using CardMakerMobile.UnityBridge;
using UnityEngine;

namespace CardMaker.CHU
{
    public static class MobileChunithmResourceBridge
    {
        public static Texture2D LoadTexture(string officialPathOrArchivePath)
        {
            return CardMakerMobileUnityResources.LoadTextureFromArchiveOrRaw(officialPathOrArchivePath);
        }

        public static Sprite LoadSprite(string officialPathOrArchivePath)
        {
            Texture2D texture = LoadTexture(officialPathOrArchivePath);
            if (texture == null)
            {
                return null;
            }
            return Sprite.Create(
                texture,
                new Rect(0f, 0f, texture.width, texture.height),
                new Vector2(0.5f, 0.5f),
                100f);
        }
    }
}
#endif

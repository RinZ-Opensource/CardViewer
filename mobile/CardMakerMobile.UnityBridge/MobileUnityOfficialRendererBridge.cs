#if UNITY_5_6_OR_NEWER
using System;
using System.IO;
using CardMaker.CHU;
using CardMaker.MAI;
using CardMaker.MU3;
using CardMakerMobile.Runtime;
using UnityEngine;

namespace CardMakerMobile.UnityBridge
{
    public static class MobileUnityOfficialRendererBridge
    {
        public delegate void TextureDone(Texture2D texture);
        public delegate void Mu3HoloDone(Texture2D texture, bool isSign);
        public delegate void ErrorDone(string message);

        public static void RenderChuCardTexture(
            CHUCardRenderer renderer,
            UI_CCH_CardData_00 cardData,
            bool printMask,
            TextureDone onDone,
            ErrorDone onError)
        {
            if (!Validate(renderer, cardData, onError))
            {
                return;
            }
            renderer.renderTexture(cardData, printMask, delegate (int width, int height, Texture2D texture)
            {
                InvokeTexture(onDone, texture);
            });
        }

        public static void RenderMaiCardTexture(
            MAICardRenderer renderer,
            UI_CMA_CardData_00 cardData,
            Texture2D holoMask,
            bool printMask,
            TextureDone onDone,
            ErrorDone onError)
        {
            if (!Validate(renderer, cardData, onError))
            {
                return;
            }
            renderer.renderTexture(cardData, holoMask, printMask, delegate (int width, int height, Texture2D texture)
            {
                InvokeTexture(onDone, texture);
            });
        }

        public static void RenderMaiHoloMaskTexture(
            MAICardRenderer renderer,
            UI_CMA_CardData_00 cardData,
            TextureDone onDone,
            ErrorDone onError)
        {
            if (!Validate(renderer, cardData, onError))
            {
                return;
            }
            renderer.renderHoloMask(cardData, delegate (int width, int height, Color32[] image)
            {
                InvokeTexture(onDone, ColorArrayToTexture(width, height, image));
            });
        }

        public static void RenderMu3CardTexture(
            MU3CardRenderer renderer,
            UI_CMN_CardData_00 cardData,
            Texture2D holoMask,
            bool printMask,
            TextureDone onDone,
            ErrorDone onError)
        {
            if (!Validate(renderer, cardData, onError))
            {
                return;
            }
            renderer.renderTexture(cardData, holoMask, printMask, delegate (int width, int height, Texture2D texture)
            {
                InvokeTexture(onDone, texture);
            });
        }

        public static void RenderMu3HoloMaskTexture(
            MU3CardRenderer renderer,
            UI_CMN_CardData_00 cardData,
            Mu3HoloDone onDone,
            ErrorDone onError)
        {
            if (!Validate(renderer, cardData, onError))
            {
                return;
            }
            renderer.renderHoloMask(cardData, delegate (int width, int height, bool isSign, Color32[] image)
            {
                if (onDone != null)
                {
                    onDone(ColorArrayToTexture(width, height, image), isSign);
                }
            });
        }

        public static bool SaveCardPng(MobileExportPlan plan, Texture2D texture, ErrorDone onError)
        {
            if (plan == null || string.IsNullOrEmpty(plan.CardImagePath))
            {
                InvokeError(onError, "Export plan has no card image path.");
                return false;
            }
            return SavePng(plan.CardImagePath, texture, onError);
        }

        public static bool SaveHoloMaskPng(MobileExportPlan plan, Texture2D texture, ErrorDone onError)
        {
            if (plan == null || string.IsNullOrEmpty(plan.HoloMaskPath))
            {
                InvokeError(onError, "Export plan has no holo mask path.");
                return false;
            }
            return SavePng(plan.HoloMaskPath, texture, onError);
        }

        public static Texture2D ColorArrayToTexture(int width, int height, Color32[] image)
        {
            if (width <= 0 || height <= 0 || image == null)
            {
                return null;
            }
            Texture2D texture = new Texture2D(width, height, TextureFormat.ARGB32, false, false);
            texture.filterMode = FilterMode.Point;
            texture.SetPixels32(image);
            texture.Apply(false, false);
            return texture;
        }

        private static bool SavePng(string path, Texture2D texture, ErrorDone onError)
        {
            if (texture == null)
            {
                InvokeError(onError, "Texture is null.");
                return false;
            }
            try
            {
                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                File.WriteAllBytes(path, texture.EncodeToPNG());
                return true;
            }
            catch (Exception ex)
            {
                InvokeError(onError, ex.ToString());
                return false;
            }
        }

        private static bool Validate(UnityEngine.Object renderer, UnityEngine.Object cardData, ErrorDone onError)
        {
            if (renderer == null)
            {
                InvokeError(onError, "Official renderer is null.");
                return false;
            }
            if (cardData == null)
            {
                InvokeError(onError, "Official card data component is null.");
                return false;
            }
            return true;
        }

        private static void InvokeTexture(TextureDone onDone, Texture2D texture)
        {
            if (onDone != null)
            {
                onDone(texture);
            }
        }

        private static void InvokeError(ErrorDone onError, string message)
        {
            if (onError != null)
            {
                onError(message);
            }
            Debug.LogError(message);
        }
    }
}
#endif

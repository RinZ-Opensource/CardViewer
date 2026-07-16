#if UNITY_5_6_OR_NEWER
using CardMakerMobile.Runtime;
using UnityEngine;

namespace CardMakerMobile.UnityBridge
{
    public static class MobileHoloMaskBridge
    {
        public static Color32[] Generate(Color32[] frontMaskPass, Color32[] rootHoloPass, int width, int height)
        {
            byte[] rgba = HoloMaskGenerator.GenerateMaskRgba(
                ToRgba(frontMaskPass, width, height),
                ToRgba(rootHoloPass, width, height),
                width,
                height);
            return FromRgba(rgba);
        }

        public static Color32[] ApplyMu3Sign(Color32[] baseMask, Texture2D sign, Texture2D signMask, int width, int height)
        {
            if (sign == null || signMask == null)
            {
                return baseMask;
            }

            byte[] rgba = HoloMaskGenerator.ApplyMu3SignRgba(
                ToRgba(baseMask, width, height),
                ToRgba(sign.GetPixels32(), width, height),
                ToRgba(signMask.GetPixels32(), width, height),
                width,
                height);
            return FromRgba(rgba);
        }

        private static byte[] ToRgba(Color32[] colors, int width, int height)
        {
            int expected = width * height;
            if (colors == null || colors.Length != expected)
            {
                throw new System.ArgumentException("Color array size does not match width/height.");
            }

            byte[] rgba = new byte[expected * 4];
            for (int i = 0; i < expected; i++)
            {
                int offset = i * 4;
                rgba[offset] = colors[i].r;
                rgba[offset + 1] = colors[i].g;
                rgba[offset + 2] = colors[i].b;
                rgba[offset + 3] = colors[i].a;
            }
            return rgba;
        }

        private static Color32[] FromRgba(byte[] rgba)
        {
            Color32[] colors = new Color32[rgba.Length / 4];
            for (int i = 0; i < colors.Length; i++)
            {
                int offset = i * 4;
                colors[i] = new Color32(rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]);
            }
            return colors;
        }
    }
}
#endif

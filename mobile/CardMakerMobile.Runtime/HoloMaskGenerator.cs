using System;

namespace CardMakerMobile.Runtime
{
    public static class HoloMaskGenerator
    {
        public const int OfficialDilateIterations = 7;

        public static byte[] GenerateMaskBytes(byte[] frontMaskRgba, byte[] rootHoloRgba, int width, int height)
        {
            return GenerateMaskBytes(frontMaskRgba, rootHoloRgba, width, height, OfficialDilateIterations);
        }

        public static byte[] GenerateMaskBytes(
            byte[] frontMaskRgba,
            byte[] rootHoloRgba,
            int width,
            int height,
            int dilateIterations)
        {
            ValidateRgba(frontMaskRgba, width, height, "frontMaskRgba");
            ValidateRgba(rootHoloRgba, width, height, "rootHoloRgba");

            var pixels = width * height;
            var current = new byte[pixels];
            var next = new byte[pixels];
            BinarizeAnyChannel(frontMaskRgba, current);

            for (var i = 0; i < dilateIterations; i++)
            {
                Dilate(width, height, next, current);
                var swap = current;
                current = next;
                next = swap;
            }

            var output = new byte[pixels];
            for (var i = 0; i < pixels; i++)
            {
                output[i] = (byte)(current[i] <= 127 && rootHoloRgba[i * 4] <= 127 ? 0 : 255);
            }
            return output;
        }

        public static byte[] GenerateMaskRgba(byte[] frontMaskRgba, byte[] rootHoloRgba, int width, int height)
        {
            var mask = GenerateMaskBytes(frontMaskRgba, rootHoloRgba, width, height);
            return MaskBytesToRgba(mask);
        }

        public static byte[] ApplyMu3SignRgba(byte[] baseMaskRgba, byte[] signRgba, byte[] signMaskRgba, int width, int height)
        {
            ValidateRgba(baseMaskRgba, width, height, "baseMaskRgba");
            ValidateRgba(signRgba, width, height, "signRgba");
            ValidateRgba(signMaskRgba, width, height, "signMaskRgba");

            var result = new byte[baseMaskRgba.Length];
            Buffer.BlockCopy(baseMaskRgba, 0, result, 0, baseMaskRgba.Length);
            var pixels = width * height;
            for (var i = 0; i < pixels; i++)
            {
                var offset = i * 4;
                if (signMaskRgba[offset + 3] > 127)
                {
                    SetWhite(result, offset);
                }
                if (signRgba[offset + 3] > 127)
                {
                    SetClear(result, offset);
                }
            }
            return result;
        }

        public static byte[] MaskBytesToRgba(byte[] mask)
        {
            if (mask == null)
            {
                throw new ArgumentNullException("mask");
            }
            var rgba = new byte[mask.Length * 4];
            for (var i = 0; i < mask.Length; i++)
            {
                var offset = i * 4;
                if (mask[i] > 127)
                {
                    SetWhite(rgba, offset);
                }
            }
            return rgba;
        }

        private static void BinarizeAnyChannel(byte[] rgba, byte[] output)
        {
            for (var i = 0; i < output.Length; i++)
            {
                var offset = i * 4;
                output[i] = (byte)(rgba[offset] > 0
                    || rgba[offset + 1] > 0
                    || rgba[offset + 2] > 0
                    || rgba[offset + 3] > 0
                        ? 255
                        : 0);
            }
        }

        private static void Dilate(int width, int height, byte[] dst, byte[] src)
        {
            for (var y = 0; y < height; y++)
            {
                var y0 = Math.Max(y - 1, 0) * width;
                var y1 = y * width;
                var y2 = Math.Min(y + 1, height - 1) * width;
                for (var x = 0; x < width; x++)
                {
                    var x0 = Math.Max(x - 1, 0);
                    var x1 = x;
                    var x2 = Math.Min(x + 1, width - 1);
                    var value =
                        src[y0 + x0] > 0 || src[y0 + x1] > 0 || src[y0 + x2] > 0 ||
                        src[y1 + x0] > 0 || src[y1 + x2] > 0 ||
                        src[y2 + x0] > 0 || src[y2 + x1] > 0 || src[y2 + x2] > 0;
                    dst[y1 + x1] = (byte)(value ? 255 : 0);
                }
            }
        }

        private static void ValidateRgba(byte[] rgba, int width, int height, string name)
        {
            if (rgba == null)
            {
                throw new ArgumentNullException(name);
            }
            if (width <= 0 || height <= 0)
            {
                throw new ArgumentOutOfRangeException("width/height");
            }
            var expected = width * height * 4;
            if (rgba.Length != expected)
            {
                throw new ArgumentException(name + " length must be " + expected + " bytes.");
            }
        }

        private static void SetWhite(byte[] rgba, int offset)
        {
            rgba[offset] = 255;
            rgba[offset + 1] = 255;
            rgba[offset + 2] = 255;
            rgba[offset + 3] = 255;
        }

        private static void SetClear(byte[] rgba, int offset)
        {
            rgba[offset] = 0;
            rgba[offset + 1] = 0;
            rgba[offset + 2] = 0;
            rgba[offset + 3] = 0;
        }
    }
}

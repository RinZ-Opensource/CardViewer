using System;
using System.IO;
using System.Text;

namespace CardMakerMobile.Runtime
{
    public sealed class CmpackArchiveReader
    {
        private const int BlockSize = 512;

        public delegate void EntryDataCallback(CmpackEntry entry, Stream data);

        public void Read(Stream archive, EntryDataCallback callback)
        {
            if (archive == null)
            {
                throw new ArgumentNullException("archive");
            }
            if (callback == null)
            {
                throw new ArgumentNullException("callback");
            }

            var header = new byte[BlockSize];
            while (true)
            {
                var read = ReadFullBlock(archive, header);
                if (read == 0)
                {
                    return;
                }
                if (read != BlockSize)
                {
                    throw new InvalidDataException("Truncated cmpack tar header.");
                }
                if (IsZeroBlock(header))
                {
                    return;
                }

                var entry = ParseEntry(header);
                var limited = new LimitedReadStream(archive, entry.Size);
                callback(entry, limited);
                limited.Drain();
                SkipPadding(archive, entry.Size);
            }
        }

        private static CmpackEntry ParseEntry(byte[] header)
        {
            VerifyChecksum(header);

            var name = ReadString(header, 0, 100);
            var prefix = ReadString(header, 345, 155);
            var archivePath = string.IsNullOrEmpty(prefix) ? name : prefix + "/" + name;
            var size = ReadOctal(header, 124, 12);
            var typeFlag = (char)header[156];

            if (string.IsNullOrEmpty(archivePath))
            {
                throw new InvalidDataException("Tar entry has an empty path.");
            }

            return new CmpackEntry(archivePath.Replace('\\', '/'), size, typeFlag);
        }

        private static int ReadFullBlock(Stream stream, byte[] block)
        {
            var offset = 0;
            while (offset < block.Length)
            {
                var read = stream.Read(block, offset, block.Length - offset);
                if (read == 0)
                {
                    break;
                }
                offset += read;
            }
            return offset;
        }

        private static bool IsZeroBlock(byte[] block)
        {
            for (var i = 0; i < block.Length; i++)
            {
                if (block[i] != 0)
                {
                    return false;
                }
            }
            return true;
        }

        private static string ReadString(byte[] bytes, int offset, int length)
        {
            var end = offset;
            var max = offset + length;
            while (end < max && bytes[end] != 0)
            {
                end++;
            }
            return Encoding.UTF8.GetString(bytes, offset, end - offset).Trim();
        }

        private static long ReadOctal(byte[] bytes, int offset, int length)
        {
            long value = 0;
            var end = offset + length;
            for (var i = offset; i < end; i++)
            {
                var b = bytes[i];
                if (b == 0 || b == 32)
                {
                    continue;
                }
                if (b < '0' || b > '7')
                {
                    throw new InvalidDataException("Invalid tar octal field.");
                }
                value = (value << 3) + (b - '0');
            }
            return value;
        }

        private static void VerifyChecksum(byte[] header)
        {
            long expected;
            try
            {
                expected = ReadOctal(header, 148, 8);
            }
            catch (InvalidDataException)
            {
                throw new InvalidDataException("Invalid tar checksum field.");
            }

            long actual = 0;
            for (var i = 0; i < header.Length; i++)
            {
                actual += (i >= 148 && i < 156) ? (byte)' ' : header[i];
            }
            if (expected != actual)
            {
                throw new InvalidDataException("Tar checksum mismatch.");
            }
        }

        private static void SkipPadding(Stream archive, long size)
        {
            var padding = (BlockSize - (size % BlockSize)) % BlockSize;
            if (padding == 0)
            {
                return;
            }

            var buffer = new byte[padding];
            var read = 0;
            while (read < padding)
            {
                var count = archive.Read(buffer, read, (int)padding - read);
                if (count == 0)
                {
                    throw new InvalidDataException("Truncated cmpack tar padding.");
                }
                read += count;
            }
        }
    }
}

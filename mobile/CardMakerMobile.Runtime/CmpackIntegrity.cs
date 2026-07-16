using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;

namespace CardMakerMobile.Runtime
{
    public sealed class CmpackIntegrityEntry
    {
        public string Path { get; set; }
        public long Size { get; set; }
        public string Sha256 { get; set; }
    }

    public sealed class CmpackIntegrityManifest
    {
        public CmpackIntegrityManifest()
        {
            Files = new List<CmpackIntegrityEntry>();
        }

        public List<CmpackIntegrityEntry> Files { get; private set; }

        public static CmpackIntegrityManifest Load(string manifestPath)
        {
            var json = File.ReadAllText(manifestPath);
            var manifest = new CmpackIntegrityManifest();
            foreach (var itemJson in JsonLite.ReadObjectsFromArray(json, "files"))
            {
                var path = JsonLite.ReadStringField(itemJson, "path");
                var size = JsonLite.ReadLongField(itemJson, "size");
                var sha256 = JsonLite.ReadStringField(itemJson, "sha256");
                if (path == null || !size.HasValue || sha256 == null)
                {
                    throw new InvalidDataException("Invalid integrity entry.");
                }
                manifest.Files.Add(new CmpackIntegrityEntry
                {
                    Path = ArchivePath.Normalize(path),
                    Size = size.Value,
                    Sha256 = sha256.ToLowerInvariant()
                });
            }
            if (manifest.Files.Count == 0)
            {
                throw new InvalidDataException("Integrity manifest contains no files.");
            }
            return manifest;
        }
    }

    public static class CmpackIntegrityVerifier
    {
        public static List<string> Verify(string installRoot, string integrityManifestPath)
        {
            var manifest = CmpackIntegrityManifest.Load(integrityManifestPath);
            var verified = new List<string>();
            foreach (var entry in manifest.Files)
            {
                var filePath = ArchivePath.ToSafeFilePath(installRoot, entry.Path);
                if (!File.Exists(filePath))
                {
                    throw new FileNotFoundException("Missing cmpack payload file.", filePath);
                }

                var info = new FileInfo(filePath);
                if (info.Length != entry.Size)
                {
                    throw new InvalidDataException(
                        "Size mismatch for " + entry.Path + ": expected "
                        + entry.Size + ", got " + info.Length);
                }

                var hash = ComputeSha256(filePath);
                if (!string.Equals(hash, entry.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException("SHA-256 mismatch for " + entry.Path);
                }

                verified.Add(entry.Path);
            }
            return verified;
        }

        private static string ComputeSha256(string filePath)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(filePath))
            {
                return ToHex(sha.ComputeHash(stream));
            }
        }

        private static string ToHex(byte[] bytes)
        {
            var chars = new char[bytes.Length * 2];
            for (var i = 0; i < bytes.Length; i++)
            {
                var value = bytes[i];
                chars[i * 2] = NibbleToHex(value >> 4);
                chars[i * 2 + 1] = NibbleToHex(value & 0x0f);
            }
            return new string(chars);
        }

        private static char NibbleToHex(int value)
        {
            return (char)(value < 10 ? '0' + value : 'a' + value - 10);
        }
    }
}

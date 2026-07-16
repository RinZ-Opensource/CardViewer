using System;
using System.IO;

namespace CardMakerMobile.Runtime
{
    internal static class ArchivePath
    {
        public static string Normalize(string archivePath)
        {
            if (string.IsNullOrEmpty(archivePath))
            {
                throw new InvalidDataException("Archive path is empty.");
            }

            var path = archivePath.Replace('\\', '/');
            if (path.StartsWith("/", StringComparison.Ordinal) || path.Contains(":"))
            {
                throw new InvalidDataException("Archive path must be relative: " + archivePath);
            }

            var parts = path.Split('/');
            var normalized = "";
            for (var i = 0; i < parts.Length; i++)
            {
                var part = parts[i];
                if (part.Length == 0 || part == ".")
                {
                    continue;
                }
                if (part == "..")
                {
                    throw new InvalidDataException("Archive path escapes root: " + archivePath);
                }
                normalized = normalized.Length == 0 ? part : normalized + "/" + part;
            }

            if (normalized.Length == 0)
            {
                throw new InvalidDataException("Archive path is empty after normalization.");
            }
            return normalized;
        }

        public static string ToSafeFilePath(string root, string archivePath)
        {
            var normalized = Normalize(archivePath);
            var relative = normalized.Replace('/', Path.DirectorySeparatorChar);
            var rootFull = Path.GetFullPath(root);
            var candidate = Path.GetFullPath(Path.Combine(rootFull, relative));
            var comparison = Path.DirectorySeparatorChar == '\\'
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal;
            var rootWithSeparator = rootFull.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            if (!candidate.Equals(rootFull, comparison)
                && !candidate.StartsWith(rootWithSeparator, comparison))
            {
                throw new InvalidDataException("Archive path resolves outside destination: " + archivePath);
            }
            return candidate;
        }
    }
}

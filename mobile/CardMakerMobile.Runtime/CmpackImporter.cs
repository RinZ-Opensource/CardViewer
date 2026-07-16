using System;
using System.Collections.Generic;
using System.IO;

namespace CardMakerMobile.Runtime
{
    public sealed class CmpackImporter
    {
        public CmpackImportResult Import(string cmpackPath, string installRoot, bool overwrite)
        {
            if (string.IsNullOrEmpty(cmpackPath))
            {
                throw new ArgumentException("cmpackPath is required.", "cmpackPath");
            }
            if (string.IsNullOrEmpty(installRoot))
            {
                throw new ArgumentException("installRoot is required.", "installRoot");
            }
            if (!File.Exists(cmpackPath))
            {
                throw new FileNotFoundException("Cmpack file does not exist.", cmpackPath);
            }

            var finalRoot = Path.GetFullPath(installRoot);
            var parent = Path.GetDirectoryName(finalRoot);
            if (string.IsNullOrEmpty(parent))
            {
                parent = Directory.GetCurrentDirectory();
            }
            Directory.CreateDirectory(parent);

            var tempRoot = Path.Combine(parent, "." + Path.GetFileName(finalRoot) + ".importing-" + DateTime.UtcNow.Ticks);
            var result = new CmpackImportResult(finalRoot);
            try
            {
                Directory.CreateDirectory(tempRoot);
                Extract(cmpackPath, tempRoot, result.ExtractedFiles);

                result.ManifestPath = RequireFile(tempRoot, "manifest.json");
                var summary = MobilePackManifestSummary.Load(result.ManifestPath);
                result.CardsManifestPath = RequireFile(tempRoot, summary.CardsManifest ?? "cards.json");
                result.CardsIndexPath = RequireFile(tempRoot, summary.IndexManifest ?? "cards.index.json");
                result.AssetIndexPath = RequireFile(tempRoot, summary.AssetIndex ?? "assets/index.json");
                result.IntegrityManifestPath = RequireFile(tempRoot, summary.IntegrityManifest);
                result.VerifiedFiles.AddRange(
                    CmpackIntegrityVerifier.Verify(tempRoot, result.IntegrityManifestPath));

                if (Directory.Exists(finalRoot))
                {
                    if (!overwrite)
                    {
                        throw new IOException("Install root already exists: " + finalRoot);
                    }
                    Directory.Delete(finalRoot, true);
                }
                Directory.Move(tempRoot, finalRoot);
                RebaseResultPaths(result, tempRoot, finalRoot);
                return result;
            }
            catch
            {
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
                throw;
            }
        }

        private static void Extract(string cmpackPath, string destinationRoot, List<string> extractedFiles)
        {
            var reader = new CmpackArchiveReader();
            using (var stream = File.OpenRead(cmpackPath))
            {
                reader.Read(stream, delegate (CmpackEntry entry, Stream data)
                {
                    if (!entry.IsRegularFile)
                    {
                        return;
                    }

                    var archivePath = ArchivePath.Normalize(entry.ArchivePath);
                    var outputPath = ArchivePath.ToSafeFilePath(destinationRoot, archivePath);
                    var outputDir = Path.GetDirectoryName(outputPath);
                    if (!string.IsNullOrEmpty(outputDir))
                    {
                        Directory.CreateDirectory(outputDir);
                    }

                    using (var output = File.Create(outputPath))
                    {
                        Copy(data, output);
                    }
                    extractedFiles.Add(archivePath);
                });
            }
        }

        private static string RequireFile(string root, string archivePath)
        {
            var path = ArchivePath.ToSafeFilePath(root, archivePath);
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("Required mobile pack file is missing.", path);
            }
            return path;
        }

        private static void RebaseResultPaths(CmpackImportResult result, string oldRoot, string newRoot)
        {
            result.ManifestPath = Rebase(result.ManifestPath, oldRoot, newRoot);
            result.CardsManifestPath = Rebase(result.CardsManifestPath, oldRoot, newRoot);
            result.CardsIndexPath = Rebase(result.CardsIndexPath, oldRoot, newRoot);
            result.AssetIndexPath = Rebase(result.AssetIndexPath, oldRoot, newRoot);
            result.IntegrityManifestPath = Rebase(result.IntegrityManifestPath, oldRoot, newRoot);
        }

        private static string Rebase(string path, string oldRoot, string newRoot)
        {
            if (path == null)
            {
                return null;
            }
            var relative = path.Substring(oldRoot.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return Path.Combine(newRoot, relative);
        }

        private static void Copy(Stream input, Stream output)
        {
            var buffer = new byte[81920];
            while (true)
            {
                var read = input.Read(buffer, 0, buffer.Length);
                if (read == 0)
                {
                    return;
                }
                output.Write(buffer, 0, read);
            }
        }
    }
}

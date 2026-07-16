#if UNITY_5_6_OR_NEWER
using System.Collections.Generic;
using System.IO;
using CardMakerMobile.Runtime;
using UnityEngine;

namespace CardMakerMobile.UnityBridge
{
    public static class CardMakerMobileUnityResources
    {
        private static CardMakerMobilePack pack_;
        private static bool defaultInitializeAttempted_;
        private static readonly Dictionary<string, Texture2D> textureCache_ = new Dictionary<string, Texture2D>();
        private static readonly Dictionary<string, Sprite> spriteCache_ = new Dictionary<string, Sprite>();

        public static bool IsLoaded
        {
            get { return pack_ != null; }
        }

        public static CardMakerMobilePack Pack
        {
            get { return pack_; }
        }

        public static string DefaultInstallRoot
        {
            get { return Path.Combine(Application.persistentDataPath, "CardMakerMobilePack"); }
        }

        public static void Initialize(string installRoot)
        {
            ReleaseAll();
            pack_ = CardMakerMobilePack.Load(installRoot);
            Debug.Log("CardMakerMobileUnityResources loaded manifest format="
                + pack_.Manifest.PackFormat
                + " assets="
                + ((pack_.Assets != null && pack_.Assets.Bundles != null) ? pack_.Assets.Bundles.Count : 0)
                + " cards="
                + ((pack_.CardsIndex != null) ? pack_.CardsIndex.TotalCards : 0)
                + " root="
                + pack_.InstallRoot);
        }

        public static bool TryInitializeDefault()
        {
            if (pack_ != null)
            {
                return true;
            }
            if (defaultInitializeAttempted_)
            {
                return false;
            }
            defaultInitializeAttempted_ = true;

            string[] candidates =
            {
                DefaultInstallRoot,
                Path.Combine(Application.persistentDataPath, "mobile-pack"),
                Path.Combine(Application.persistentDataPath, "cardmaker-pack")
            };
            for (int i = 0; i < candidates.Length; i++)
            {
                var candidate = candidates[i];
                if (string.IsNullOrEmpty(candidate))
                {
                    continue;
                }
                var manifestPath = Path.Combine(candidate, "manifest.json");
                Debug.Log("CardMakerMobileUnityResources probe default pack="
                    + candidate
                    + " dir="
                    + Directory.Exists(candidate)
                    + " manifest="
                    + File.Exists(manifestPath));
                if (!File.Exists(manifestPath))
                {
                    continue;
                }
                try
                {
                    Initialize(candidate);
                    Debug.Log("CardMakerMobileUnityResources default pack=" + candidate);
                    return true;
                }
                catch (System.Exception exception)
                {
                    Debug.LogWarning("CardMakerMobileUnityResources failed to load default pack "
                        + candidate + ": " + exception);
                }
            }
            Debug.LogWarning("CardMakerMobileUnityResources no default pack loaded under "
                + Application.persistentDataPath);
            return false;
        }

        public static Texture2D LoadTexture(string group, string officialNameOrArchivePath)
        {
            if (!EnsureLoaded() || string.IsNullOrEmpty(officialNameOrArchivePath))
            {
                return null;
            }

            string filePath;
            if (!TryResolveTexturePath(group, officialNameOrArchivePath, out filePath))
            {
                return null;
            }
            return LoadTextureFile(filePath);
        }

        public static Sprite LoadSprite(string group, string officialNameOrArchivePath)
        {
            Texture2D texture = LoadTexture(group, officialNameOrArchivePath);
            if (texture == null)
            {
                return null;
            }

            string key = "sprite:" + texture.GetInstanceID();
            Sprite sprite;
            if (spriteCache_.TryGetValue(key, out sprite))
            {
                return sprite;
            }

            sprite = Sprite.Create(
                texture,
                new Rect(0f, 0f, texture.width, texture.height),
                new Vector2(0.5f, 0.5f),
                100f);
            spriteCache_[key] = sprite;
            return sprite;
        }

        public static Texture2D LoadTextureFromArchiveOrRaw(string archiveOrRawPath)
        {
            if (!EnsureLoaded() || string.IsNullOrEmpty(archiveOrRawPath))
            {
                return null;
            }

            string filePath;
            if (TryResolveKnownOfficialPath(archiveOrRawPath, out filePath))
            {
                return LoadTextureFile(filePath);
            }
            if (pack_.TryResolveArchivePath(archiveOrRawPath, out filePath))
            {
                return LoadTextureFile(filePath);
            }
            if (pack_.TryResolveRaw(archiveOrRawPath, out filePath))
            {
                return LoadTextureFile(filePath);
            }
            if (File.Exists(archiveOrRawPath))
            {
                return LoadTextureFile(archiveOrRawPath);
            }
            return null;
        }

        public static bool TryResolveTexturePath(string group, string officialNameOrArchivePath, out string filePath)
        {
            filePath = null;
            if (!EnsureLoaded())
            {
                return false;
            }
            if (TryResolveKnownOfficialPath(officialNameOrArchivePath, out filePath))
            {
                return true;
            }
            if (pack_.TryResolveArchivePath(officialNameOrArchivePath, out filePath))
            {
                return true;
            }
            if (pack_.TryResolveOfficialAsset(group, officialNameOrArchivePath, out filePath))
            {
                return true;
            }
            if (pack_.TryResolveRaw(officialNameOrArchivePath, out filePath))
            {
                return true;
            }
            return false;
        }

        public static bool TryResolveRawFile(string suffix, out string filePath)
        {
            filePath = null;
            if (!EnsureLoaded())
            {
                return false;
            }
            return pack_.TryResolveRaw(suffix, out filePath);
        }

        public static bool TryResolveRawDirectory(string suffix, out string directoryPath)
        {
            directoryPath = null;
            if (!EnsureLoaded())
            {
                return false;
            }
            if (!pack_.TryResolveRawDirectory(suffix, out directoryPath))
            {
                return false;
            }
            if (!directoryPath.EndsWith(Path.DirectorySeparatorChar.ToString()))
            {
                directoryPath += Path.DirectorySeparatorChar;
            }
            return true;
        }

        public static string ResolveRawFileOrDefault(string suffix, string defaultPath)
        {
            string filePath;
            return TryResolveRawFile(suffix, out filePath) ? filePath : defaultPath;
        }

        public static string ResolveRawDirectoryOrDefault(string suffix, string defaultPath)
        {
            string directoryPath;
            return TryResolveRawDirectory(suffix, out directoryPath) ? directoryPath : defaultPath;
        }

        private static bool TryResolveKnownOfficialPath(string officialPath, out string filePath)
        {
            filePath = null;
            if (!EnsureLoaded() || string.IsNullOrEmpty(officialPath))
            {
                return false;
            }

            string normalized = officialPath.Replace('\\', '/');
            string relative;
            if (TryAfterMarker(normalized, "/StreamingAssets/", out relative))
            {
                if (TryResolveOfficialRelative(relative, out filePath))
                {
                    return true;
                }
            }
            if (TryAfterMarker(normalized, "/CHU/Data/", out relative))
            {
                if (TryResolveOfficialRelative("CHU/Data/" + relative, out filePath))
                {
                    return true;
                }
            }
            if (TryAfterMarker(normalized, "/MAI/", out relative))
            {
                if (TryResolveOfficialRelative("MAI/" + relative, out filePath))
                {
                    return true;
                }
            }
            if (TryAfterMarker(normalized, "/MU3/", out relative))
            {
                if (TryResolveOfficialRelative("MU3/" + relative, out filePath))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool TryResolveOfficialRelative(string relative, out string filePath)
        {
            filePath = null;
            if (string.IsNullOrEmpty(relative))
            {
                return false;
            }
            relative = relative.Replace('\\', '/').TrimStart('/');
            if (pack_.TryResolveArchivePath(relative, out filePath))
            {
                return true;
            }
            if (pack_.TryResolveRaw(relative, out filePath))
            {
                return true;
            }
            if (relative.StartsWith("CHU/") && pack_.TryResolveArchivePath("assets/chu/" + relative, out filePath))
            {
                return true;
            }
            if (relative.StartsWith("MAI/") && pack_.TryResolveArchivePath("assets/mai/" + relative, out filePath))
            {
                return true;
            }
            if (relative.StartsWith("MU3/") && pack_.TryResolveArchivePath("assets/mu3/" + relative, out filePath))
            {
                return true;
            }
            if (relative.StartsWith("Common/") && pack_.TryResolveArchivePath("assets/common/" + relative, out filePath))
            {
                return true;
            }
            return false;
        }

        private static bool TryAfterMarker(string text, string marker, out string value)
        {
            value = null;
            int index = text.IndexOf(marker, System.StringComparison.OrdinalIgnoreCase);
            if (index < 0)
            {
                return false;
            }
            value = text.Substring(index + marker.Length);
            return !string.IsNullOrEmpty(value);
        }

        public static void ReleaseAll()
        {
            foreach (Sprite sprite in spriteCache_.Values)
            {
                if (sprite != null)
                {
                    Object.Destroy(sprite);
                }
            }
            spriteCache_.Clear();

            foreach (Texture2D texture in textureCache_.Values)
            {
                if (texture != null)
                {
                    Object.Destroy(texture);
                }
            }
            textureCache_.Clear();
            pack_ = null;
        }

        private static bool EnsureLoaded()
        {
            return pack_ != null || TryInitializeDefault();
        }

        private static Texture2D LoadTextureFile(string filePath)
        {
            Texture2D cached;
            if (textureCache_.TryGetValue(filePath, out cached))
            {
                return cached;
            }

            byte[] bytes;
            try
            {
                bytes = File.ReadAllBytes(filePath);
            }
            catch
            {
                return null;
            }

            Texture2D texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!texture.LoadImage(bytes, false))
            {
                Object.Destroy(texture);
                return null;
            }
            texture.wrapMode = TextureWrapMode.Clamp;
            texture.filterMode = FilterMode.Bilinear;
            textureCache_[filePath] = texture;
            return texture;
        }
    }
}
#endif

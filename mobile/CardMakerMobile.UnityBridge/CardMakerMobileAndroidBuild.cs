#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
#if UNITY_2018_1_OR_NEWER
using UnityEditor.Build.Reporting;
#endif
using UnityEngine;

namespace CardMakerMobile.UnityBridge
{
    public static class CardMakerMobileAndroidBuild
    {
        public static void BuildOfficialAndroid()
        {
            ConfigureAndroidToolchain();

            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.Android)
            {
                throw new InvalidOperationException(
                    "Android is not the active build target. Start Unity with -buildTarget android.");
            }

            string outputPath = ArgumentValue("-mobileApkPath");
            if (string.IsNullOrEmpty(outputPath))
            {
                outputPath = Path.GetFullPath(Path.Combine(Path.Combine("Builds", "Android"), "CardMakerMobile.apk"));
            }
            else
            {
                outputPath = Path.GetFullPath(outputPath);
            }

            string outputDir = Path.GetDirectoryName(outputPath);
            if (!Directory.Exists(outputDir))
            {
                Directory.CreateDirectory(outputDir);
            }

            PlayerSettings.companyName = "ConfigArc";
            PlayerSettings.productName = "CardMakerMobile";
            SetAndroidApplicationIdentifier("com.local.cardmaker.mobile");
            PlayerSettings.Android.bundleVersionCode = 1;
            SetAndroidSdkVersion("minSdkVersion", "AndroidApiLevel25", "AndroidApiLevel23", "AndroidApiLevel21", "AndroidApiLevel19", "AndroidApiLevel16");
            SetAndroidSdkVersion("targetSdkVersion", "AndroidApiLevelAuto");
            SetAndroidBool("useAPKExpansionFiles", HasFlag("-androidUseObb"));
            ConfigureModernAndroidTarget();

            string[] scenes = EnabledScenes();
            if (scenes.Length == 0)
            {
                throw new InvalidOperationException("No enabled scenes are present in EditorBuildSettings.");
            }

            Debug.Log("CardMakerMobileAndroidBuild output=" + outputPath);
            Debug.Log("CardMakerMobileAndroidBuild scenes=" + scenes.Length);
            for (int i = 0; i < scenes.Length; i++)
            {
                Debug.Log("  scene[" + i + "]=" + scenes[i]);
            }

            BuildOptions options = BuildOptions.None;
            if (HasFlag("-mobileDevelopment"))
            {
                options |= BuildOptions.Development;
            }

            ExternalizedStreamingAssets externalizedStreamingAssets = null;
            try
            {
                if (!HasFlag("-androidEmbedStreamingAssets"))
                {
                    externalizedStreamingAssets = ExternalizeStreamingAssets();
                }

#if UNITY_2018_1_OR_NEWER
                BuildPlayerOptions buildPlayerOptions = new BuildPlayerOptions
                {
                    scenes = scenes,
                    locationPathName = outputPath,
                    target = BuildTarget.Android,
                    options = options
                };
                BuildReport report = BuildPipeline.BuildPlayer(buildPlayerOptions);
                if (report.summary.result != BuildResult.Succeeded)
                {
                    throw new InvalidOperationException(
                        "Android build failed: "
                        + report.summary.result
                        + ", errors="
                        + report.summary.totalErrors
                        + ", warnings="
                        + report.summary.totalWarnings);
                }
#else
                string error = BuildPipeline.BuildPlayer(scenes, outputPath, BuildTarget.Android, options);
                if (!string.IsNullOrEmpty(error))
                {
                    throw new InvalidOperationException("Android build failed: " + error);
                }
#endif
            }
            finally
            {
                if (externalizedStreamingAssets != null)
                {
                    externalizedStreamingAssets.Restore();
                }
            }

            if (!File.Exists(outputPath))
            {
                throw new FileNotFoundException("Android build did not create an APK.", outputPath);
            }

            Debug.Log("CardMakerMobileAndroidBuild success=" + outputPath);
        }

        private static void ConfigureAndroidToolchain()
        {
            ConfigureAndroidPath("-androidSdkRoot", "AndroidSdkRoot", "ANDROID_HOME", "ANDROID_SDK_ROOT", "sdkRootPath");
            ConfigureAndroidPath("-androidNdkRoot", "AndroidNdkRoot", "ANDROID_NDK_ROOT", "NDK_ROOT", "ndkRootPath");
            ConfigureAndroidPath("-androidJdkRoot", "JdkPath", "JAVA_HOME", null, "jdkRootPath");
        }

        private static void ConfigureAndroidPath(
            string argumentName,
            string editorPrefsKey,
            string environmentVariable,
            string alternateEnvironmentVariable,
            string androidExternalToolsProperty)
        {
            string path = ArgumentValue(argumentName);
            if (string.IsNullOrEmpty(path))
            {
                return;
            }

            path = Path.GetFullPath(path);
            EditorPrefs.SetString(editorPrefsKey, path);
            Environment.SetEnvironmentVariable(environmentVariable, path);
            if (!string.IsNullOrEmpty(alternateEnvironmentVariable))
            {
                Environment.SetEnvironmentVariable(alternateEnvironmentVariable, path);
            }
            Debug.Log("CardMakerMobileAndroidBuild " + editorPrefsKey + "=" + path);
            SetAndroidExternalToolsPath(androidExternalToolsProperty, path);
        }

        private static void SetAndroidExternalToolsPath(string propertyName, string path)
        {
            Type type = FindLoadedType("UnityEditor.Android.AndroidExternalToolsSettings");
            if (type == null)
            {
                return;
            }

            System.Reflection.PropertyInfo property = type.GetProperty(
                propertyName,
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
            if (property == null || !property.CanWrite)
            {
                Debug.LogWarning("CardMakerMobileAndroidBuild AndroidExternalToolsSettings." + propertyName + " not writable");
                return;
            }

            property.SetValue(null, path, null);
            Debug.Log("CardMakerMobileAndroidBuild AndroidExternalToolsSettings." + propertyName + "=" + path);
        }

        private static Type FindLoadedType(string fullName)
        {
            System.Reflection.Assembly[] assemblies = AppDomain.CurrentDomain.GetAssemblies();
            for (int i = 0; i < assemblies.Length; i++)
            {
                Type type = assemblies[i].GetType(fullName, false);
                if (type != null)
                {
                    return type;
                }
            }
            return null;
        }

        private static void SetAndroidBool(string propertyName, bool value)
        {
            System.Reflection.PropertyInfo property = typeof(PlayerSettings.Android).GetProperty(propertyName);
            if (property != null && property.CanWrite)
            {
                property.SetValue(null, value, null);
                Debug.Log("CardMakerMobileAndroidBuild Android." + propertyName + "=" + value);
            }
        }

        private static void SetAndroidSdkVersion(string propertyName, params string[] enumNames)
        {
            System.Reflection.PropertyInfo property = typeof(PlayerSettings.Android).GetProperty(propertyName);
            if (property == null || !property.CanWrite)
            {
                return;
            }

            for (int i = 0; i < enumNames.Length; i++)
            {
                try
                {
                    object value = Enum.Parse(property.PropertyType, enumNames[i]);
                    property.SetValue(null, value, null);
                    Debug.Log("CardMakerMobileAndroidBuild Android." + propertyName + "=" + enumNames[i]);
                    return;
                }
                catch
                {
                }
            }
        }

        private static void ConfigureModernAndroidTarget()
        {
#if UNITY_2017_1_OR_NEWER
            bool il2cpp = HasFlag("-androidIl2Cpp");
            ScriptingImplementation backend = il2cpp
                ? ScriptingImplementation.IL2CPP
                : ScriptingImplementation.Mono2x;
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, backend);
            SetNamedBuildTargetScriptingBackend(backend);
            Debug.Log("CardMakerMobileAndroidBuild Android scriptingBackend=" + backend);
#endif
#if UNITY_2018_3_OR_NEWER
            AndroidArchitecture architecture =
#if UNITY_2017_1_OR_NEWER
                il2cpp ? AndroidArchitecture.ARM64 : AndroidArchitecture.ARMv7;
#else
                AndroidArchitecture.ARMv7;
#endif
            PlayerSettings.Android.targetArchitectures = architecture;
            Debug.Log("CardMakerMobileAndroidBuild Android targetArchitectures=" + architecture);
#if UNITY_2017_1_OR_NEWER
            if (il2cpp)
            {
                SetNamedBuildTargetArchitecture(1);
            }
#endif
#endif
        }

#if UNITY_2017_1_OR_NEWER
        private static void SetNamedBuildTargetScriptingBackend(ScriptingImplementation backend)
        {
            object android = GetNamedBuildTargetAndroid();
            if (android == null)
            {
                return;
            }

            System.Reflection.MethodInfo method = typeof(PlayerSettings).GetMethod(
                "SetScriptingBackend",
                new Type[] { android.GetType(), typeof(ScriptingImplementation) });
            if (method == null)
            {
                return;
            }

            method.Invoke(null, new object[] { android, backend });
            Debug.Log("CardMakerMobileAndroidBuild NamedBuildTarget.Android scriptingBackend=" + backend);
        }
#endif

        private static void SetNamedBuildTargetArchitecture(int architecture)
        {
            object android = GetNamedBuildTargetAndroid();
            if (android == null)
            {
                return;
            }

            System.Reflection.MethodInfo method = typeof(PlayerSettings).GetMethod(
                "SetArchitecture",
                new Type[] { android.GetType(), typeof(int) });
            if (method == null)
            {
                return;
            }

            method.Invoke(null, new object[] { android, architecture });
            Debug.Log("CardMakerMobileAndroidBuild NamedBuildTarget.Android architecture=" + architecture);
        }

        private static object GetNamedBuildTargetAndroid()
        {
            Type type = FindLoadedType("UnityEditor.Build.NamedBuildTarget");
            if (type == null)
            {
                return null;
            }

            System.Reflection.PropertyInfo property = type.GetProperty(
                "Android",
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            if (property != null)
            {
                return property.GetValue(null, null);
            }

            System.Reflection.FieldInfo field = type.GetField(
                "Android",
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            return field != null ? field.GetValue(null) : null;
        }

        private static void SetAndroidApplicationIdentifier(string value)
        {
            System.Reflection.MethodInfo method = typeof(PlayerSettings).GetMethod(
                "SetApplicationIdentifier",
                new Type[] { typeof(BuildTargetGroup), typeof(string) });
            if (method != null)
            {
                method.Invoke(null, new object[] { BuildTargetGroup.Android, value });
            }
            else
            {
                SetPlayerSettingsString("applicationIdentifier", value);
            }
        }

        private static ExternalizedStreamingAssets ExternalizeStreamingAssets()
        {
            ExternalizedStreamingAssets externalized = new ExternalizedStreamingAssets(
                Path.Combine(Application.dataPath, "StreamingAssets"));
            externalized.MoveOut();
            return externalized;
        }

        private static string[] EnabledScenes()
        {
            List<string> scenes = new List<string>();
            EditorBuildSettingsScene[] configured = EditorBuildSettings.scenes;
            for (int i = 0; i < configured.Length; i++)
            {
                EditorBuildSettingsScene scene = configured[i];
                if (scene != null && scene.enabled && !string.IsNullOrEmpty(scene.path))
                {
                    scenes.Add(scene.path);
                }
            }
            return scenes.ToArray();
        }

        private static string ArgumentValue(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == name)
                {
                    return args[i + 1];
                }
            }
            return null;
        }

        private static bool HasFlag(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == name)
                {
                    return true;
                }
            }
            return false;
        }

        private static void SetPlayerSettingsString(string propertyName, string value)
        {
            System.Reflection.PropertyInfo property = typeof(PlayerSettings).GetProperty(propertyName);
            if (property != null && property.CanWrite)
            {
                property.SetValue(null, value, null);
            }
        }

        private sealed class ExternalizedStreamingAssets
        {
            private readonly string path_;
            private readonly string backupPath_;
            private readonly string metaPath_;
            private readonly string backupMetaPath_;
            private bool moved_;

            public ExternalizedStreamingAssets(string path)
            {
                path_ = path;
                string projectRoot = Directory.GetParent(Application.dataPath).FullName;
                backupPath_ = Path.Combine(projectRoot, "StreamingAssets.mobilebuild_externalized");
                metaPath_ = path + ".meta";
                backupMetaPath_ = backupPath_ + ".meta";
            }

            public void MoveOut()
            {
                if (!Directory.Exists(path_))
                {
                    if (Directory.Exists(backupPath_))
                    {
                        Restore();
                    }
                    return;
                }

                if (Directory.Exists(backupPath_))
                {
                    throw new InvalidOperationException("StreamingAssets backup already exists: " + backupPath_);
                }

                Debug.Log("CardMakerMobileAndroidBuild externalizing StreamingAssets=" + path_);
                Directory.Move(path_, backupPath_);
                if (File.Exists(metaPath_))
                {
                    File.Move(metaPath_, backupMetaPath_);
                }
                moved_ = true;
                AssetDatabase.Refresh();
            }

            public void Restore()
            {
                if (!Directory.Exists(backupPath_))
                {
                    return;
                }

                if (Directory.Exists(path_))
                {
                    throw new InvalidOperationException("Cannot restore StreamingAssets because destination exists: " + path_);
                }

                Debug.Log("CardMakerMobileAndroidBuild restoring StreamingAssets=" + path_);
                Directory.Move(backupPath_, path_);
                if (File.Exists(backupMetaPath_))
                {
                    File.Move(backupMetaPath_, metaPath_);
                }
                moved_ = false;
                AssetDatabase.Refresh();
            }
        }
    }
}
#endif

#if UNITY_5_6_OR_NEWER
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using CardMaker.CHU;
using CardMaker.Common;
using CardMaker.MAI;
using CardMaker.MU3;
using CardMakerMobile.Runtime;
using UnityEngine;

#if UNITY_EDITOR
using System.Reflection;
using UnityEditor;
using Object = UnityEngine.Object;
#endif

namespace CardMakerMobile.UnityBridge
{
    public sealed class CardMakerMobileRenderSmokeResult
    {
        public string Game;
        public string CardId;
        public bool Success;
        public string CardImagePath;
        public string HoloMaskPath;
        public string Error;

        public string ToSummaryLine()
        {
            return Game
                + ": cardId=" + (CardId ?? string.Empty)
                + ", success=" + Success
                + ", card=" + (CardImagePath ?? string.Empty)
                + ", holo=" + (HoloMaskPath ?? string.Empty)
                + ", error=" + (Error ?? string.Empty);
        }
    }

    public sealed class CardMakerMobileRenderSmokeReport
    {
        public readonly List<CardMakerMobileRenderSmokeResult> Results =
            new List<CardMakerMobileRenderSmokeResult>();

        public bool HasError
        {
            get
            {
                for (int i = 0; i < Results.Count; i++)
                {
                    if (!Results[i].Success)
                    {
                        return true;
                    }
                }
                return false;
            }
        }

        public string ToSummary()
        {
            StringBuilder builder = new StringBuilder(512);
            builder.AppendLine("success=" + (!HasError));
            for (int i = 0; i < Results.Count; i++)
            {
                builder.AppendLine(Results[i].ToSummaryLine());
            }
            return builder.ToString();
        }
    }

    public sealed class CardMakerMobileRenderSmokeRunner : MonoBehaviour
    {
        public CardMakerMobileUnityService Service;
        public string OutputRoot;

        public CHUCardRenderer ChuRenderer;
        public UI_CCH_CardData_00 ChuCardData;
        public MAICardRenderer MaiRenderer;
        public UI_CMA_CardData_00 MaiCardData;
        public MU3CardRenderer Mu3Renderer;
        public UI_CMN_CardData_00 Mu3CardData;
        public MU3DataManager Mu3DataManager;

        public bool RunOnStart;
        public CardMakerMobileRenderSmokeReport LastReport;

        private void Start()
        {
            if (RunOnStart)
            {
                StartCoroutine(RunAll());
            }
        }

        public IEnumerator RunAll()
        {
            LastReport = new CardMakerMobileRenderSmokeReport();
            if (Service == null)
            {
                Service = GetComponent<CardMakerMobileUnityService>();
            }
            if (Service == null || !Service.IsReady)
            {
                AddError("ALL", string.Empty, "CardMakerMobileUnityService is not ready.");
                yield break;
            }
            if (string.IsNullOrEmpty(OutputRoot))
            {
                OutputRoot = Service.DefaultExportRoot();
            }

            yield return RunChu();
            yield return RunMai();
            yield return RunMu3();

            Debug.Log(LastReport.ToSummary());
        }

        private IEnumerator RunChu()
        {
            MobileCardRecord card = FirstCard("CHU");
            if (card == null)
            {
                AddError("CHU", string.Empty, "No CHU card is available.");
                yield break;
            }
            if (ChuRenderer == null || ChuCardData == null)
            {
                AddError("CHU", card.Id, "CHU renderer/card-data references are not assigned.");
                yield break;
            }
            if (!Service.BindChuCardData(ChuCardData, card.Id))
            {
                AddError("CHU", card.Id, Service.LastError);
                yield break;
            }

            MobileExportPlan plan = Service.BuildExportPlan("CHU", card.Id, OutputRoot);
            CallbackState state = new CallbackState();
            MobileUnityOfficialRendererBridge.RenderChuCardTexture(
                ChuRenderer,
                ChuCardData,
                false,
                delegate (Texture2D texture)
                {
                    if (MobileUnityOfficialRendererBridge.SaveCardPng(plan, texture, state.Fail))
                    {
                        state.Done = true;
                    }
                },
                state.Fail);
            yield return WaitFor(state);
            AddResult("CHU", card.Id, state.Error, plan.CardImagePath, null);
        }

        private IEnumerator RunMai()
        {
            MobileCardRecord card = FirstCard("MAI");
            if (card == null)
            {
                AddError("MAI", string.Empty, "No MAI card is available.");
                yield break;
            }
            if (MaiRenderer == null || MaiCardData == null)
            {
                AddError("MAI", card.Id, "MAI renderer/card-data references are not assigned.");
                yield break;
            }
            if (!Service.BindMaiCardData(MaiCardData, card.Id))
            {
                AddError("MAI", card.Id, Service.LastError);
                yield break;
            }

            MobileExportPlan plan = Service.BuildExportPlan("MAI", card.Id, OutputRoot);
            Texture2D holoMask = null;
            if (plan.RenderPlan.Holo.Requested)
            {
                CallbackState holoState = new CallbackState();
                MobileUnityOfficialRendererBridge.RenderMaiHoloMaskTexture(
                    MaiRenderer,
                    MaiCardData,
                    delegate (Texture2D texture)
                    {
                        holoMask = texture;
                        MobileUnityOfficialRendererBridge.SaveHoloMaskPng(plan, texture, holoState.Fail);
                        holoState.Done = true;
                    },
                    holoState.Fail);
                yield return WaitFor(holoState);
                if (!string.IsNullOrEmpty(holoState.Error))
                {
                    AddResult("MAI", card.Id, holoState.Error, plan.CardImagePath, plan.HoloMaskPath);
                    yield break;
                }
            }

            CallbackState state = new CallbackState();
            MobileUnityOfficialRendererBridge.RenderMaiCardTexture(
                MaiRenderer,
                MaiCardData,
                holoMask,
                false,
                delegate (Texture2D texture)
                {
                    if (MobileUnityOfficialRendererBridge.SaveCardPng(plan, texture, state.Fail))
                    {
                        state.Done = true;
                    }
                },
                state.Fail);
            yield return WaitFor(state);
            AddResult("MAI", card.Id, state.Error, plan.CardImagePath, plan.HoloMaskPath);
        }

        private IEnumerator RunMu3()
        {
            MobileCardRecord card = FirstCard("MU3");
            if (card == null)
            {
                AddError("MU3", string.Empty, "No MU3 card is available.");
                yield break;
            }
            if (Mu3Renderer == null || Mu3CardData == null)
            {
                AddError("MU3", card.Id, "MU3 renderer/card-data references are not assigned.");
                yield break;
            }
            if (Mu3DataManager != null)
            {
                Mu3Renderer.initialize(Mu3DataManager);
            }
            if (!Service.BindMu3CardData(Mu3CardData, card.Id, Mu3DataManager))
            {
                AddError("MU3", card.Id, Service.LastError);
                yield break;
            }

            MobileExportPlan plan = Service.BuildExportPlan("MU3", card.Id, OutputRoot);
            Texture2D holoMask = null;
            if (plan.RenderPlan.Holo.Requested)
            {
                CallbackState holoState = new CallbackState();
                MobileUnityOfficialRendererBridge.RenderMu3HoloMaskTexture(
                    Mu3Renderer,
                    Mu3CardData,
                    delegate (Texture2D texture, bool isSign)
                    {
                        holoMask = texture;
                        MobileUnityOfficialRendererBridge.SaveHoloMaskPng(plan, texture, holoState.Fail);
                        holoState.Done = true;
                    },
                    holoState.Fail);
                yield return WaitFor(holoState);
                if (!string.IsNullOrEmpty(holoState.Error))
                {
                    AddResult("MU3", card.Id, holoState.Error, plan.CardImagePath, plan.HoloMaskPath);
                    yield break;
                }
            }

            CallbackState state = new CallbackState();
            MobileUnityOfficialRendererBridge.RenderMu3CardTexture(
                Mu3Renderer,
                Mu3CardData,
                holoMask,
                false,
                delegate (Texture2D texture)
                {
                    if (MobileUnityOfficialRendererBridge.SaveCardPng(plan, texture, state.Fail))
                    {
                        state.Done = true;
                    }
                },
                state.Fail);
            yield return WaitFor(state);
            AddResult("MU3", card.Id, state.Error, plan.CardImagePath, plan.HoloMaskPath);
        }

        private IEnumerator WaitFor(CallbackState state)
        {
            int guard = 0;
            while (!state.Done && string.IsNullOrEmpty(state.Error))
            {
                guard++;
                if (guard > 1800)
                {
                    state.Fail("Render callback timeout.");
                    yield break;
                }
                yield return null;
            }
        }

        private MobileCardRecord FirstCard(string game)
        {
            List<MobileCardRecord> cards = Service.ListCards(game);
            return cards.Count == 0 ? null : cards[0];
        }

        private void AddResult(string game, string cardId, string error, string cardPath, string holoPath)
        {
            LastReport.Results.Add(new CardMakerMobileRenderSmokeResult
            {
                Game = game,
                CardId = cardId,
                Success = string.IsNullOrEmpty(error),
                CardImagePath = cardPath,
                HoloMaskPath = holoPath,
                Error = error
            });
        }

        private void AddError(string game, string cardId, string error)
        {
            AddResult(game, cardId, string.IsNullOrEmpty(error) ? "Unknown error." : error, null, null);
        }

        private sealed class CallbackState
        {
            public bool Done;
            public string Error;

            public void Fail(string message)
            {
                Error = message;
                Done = true;
            }
        }
    }

#if UNITY_EDITOR
    public static class CardMakerMobileRenderSmokeBatch
    {
        private const int Width = 768;
        private const int Height = 1052;

        private static string outputRoot_;
        private static StringBuilder summary_ = new StringBuilder(4096);

        public static void Run()
        {
            int exitCode = 0;
            try
            {
                outputRoot_ = ReadArg("-mobileOutputRoot", "CARDMAKER_MOBILE_OUTPUT_ROOT");
                if (string.IsNullOrEmpty(outputRoot_))
                {
                    outputRoot_ = Path.Combine(
                        Path.Combine(Path.GetTempPath(), "CardMakerMobile"),
                        "mobile_smoke_" + DateTime.Now.ToString("yyyyMMdd_HHmmss"));
                }
                Directory.CreateDirectory(outputRoot_);

                summary_.Length = 0;
                summary_.AppendLine("CardMakerMobileRenderSmokeBatch");
                summary_.AppendLine("project=" + Application.dataPath);
                summary_.AppendLine("streamingAssets=" + Application.streamingAssetsPath);
                summary_.AppendLine("output=" + outputRoot_);

                CommonContext context = SetupOfficialRuntime();
                CardMakerMobileUnityService service = CreateService();
                LoadPack(service);
                summary_.AppendLine(service.ValidateOfflineFlowSummary());

                RenderChu(service);
                RenderMai(service);
                RenderMu3(service, context);
            }
            catch (Exception ex)
            {
                exitCode = 1;
                Debug.LogException(ex);
                summary_.AppendLine("ERROR=" + ex.ToString());
            }
            finally
            {
                if (string.IsNullOrEmpty(outputRoot_))
                {
                    outputRoot_ = Path.Combine(Application.dataPath, "../CardMakerMobileRenderSmokeFailed");
                    Directory.CreateDirectory(outputRoot_);
                }
                File.WriteAllText(Path.Combine(outputRoot_, "summary.txt"), summary_.ToString(), Encoding.UTF8);
                Debug.Log(summary_.ToString());
                EditorApplication.Exit(exitCode);
            }
        }

        private static CardMakerMobileUnityService CreateService()
        {
            GameObject go = new GameObject("CardMakerMobileUnityService_Smoke");
            return go.AddComponent<CardMakerMobileUnityService>();
        }

        private static void LoadPack(CardMakerMobileUnityService service)
        {
            string cmpack = ReadArg("-mobileCmpack", "CARDMAKER_MOBILE_CMPACK");
            string installRoot = ReadArg("-mobileInstallRoot", "CARDMAKER_MOBILE_INSTALL_ROOT");
            string packRoot = ReadArg("-mobilePackRoot", "CARDMAKER_MOBILE_PACK_ROOT");

            bool ok;
            if (!string.IsNullOrEmpty(cmpack))
            {
                if (string.IsNullOrEmpty(installRoot))
                {
                    installRoot = Path.Combine(outputRoot_, "installed-pack");
                }
                ok = service.TryImportPack(cmpack, installRoot, true);
                summary_.AppendLine("cmpack=" + cmpack);
                summary_.AppendLine("installRoot=" + installRoot);
            }
            else
            {
                if (string.IsNullOrEmpty(packRoot))
                {
                    throw new ArgumentException("Set -mobilePackRoot or -mobileCmpack for render smoke.");
                }
                ok = service.TryLoadInstalledPack(packRoot);
                summary_.AppendLine("packRoot=" + packRoot);
            }

            if (!ok)
            {
                throw new Exception("Failed to load mobile pack: " + service.LastError);
            }
        }

        private static void RenderChu(CardMakerMobileUnityService service)
        {
            MobileCardRecord card = FirstCard(service, "CHU");
            GameObject rendererGo = InstantiatePrefab("Assets/GameObject/TestModeUserSupportCHUFile.prefab");
            CHUCardRenderer renderer = rendererGo.GetComponentInChildren<CHUCardRenderer>(true);
            if (renderer == null)
            {
                throw new Exception("TestModeUserSupportCHUFile prefab has no CHUCardRenderer.");
            }
            InvokePrivate(renderer, "Start");

            GameObject sourceGo = InstantiatePrefab("Assets/GameObject/ANM_CCH_CardData_00.prefab");
            UI_CCH_CardData_00 source = sourceGo.GetComponent<UI_CCH_CardData_00>();
            if (source == null)
            {
                throw new Exception("ANM_CCH_CardData_00 prefab has no UI_CCH_CardData_00.");
            }
            if (!service.BindChuCardData(source, card.Id))
            {
                throw new Exception(service.LastError);
            }

            MobileExportPlan plan = service.BuildExportPlan("CHU", card.Id, outputRoot_);
            renderer.setSize(Width, Height);
            UI_CCH_CardData_00 internalCard = GetField<UI_CCH_CardData_00>(renderer, "cardData_");
            internalCard.copyFrom(source);
            internalCard.setForRender(false);
            Canvas.ForceUpdateCanvases();
            Texture2D cardImage = RenderToTexture(renderer, Width, Height);
            SaveTexture(cardImage, plan.CardImagePath, "CHU", card.Id, "card");

            Object.DestroyImmediate(sourceGo);
            Object.DestroyImmediate(rendererGo);
        }

        private static void RenderMai(CardMakerMobileUnityService service)
        {
            MobileCardRecord card = FirstCard(service, "MAI");
            GameObject rendererGo = InstantiatePrefab("Assets/GameObject/MAIHoloMaskRender.prefab");
            MAICardRenderer renderer = rendererGo.GetComponentInChildren<MAICardRenderer>(true);
            if (renderer == null)
            {
                throw new Exception("MAIHoloMaskRender prefab has no MAICardRenderer.");
            }
            InvokePrivate(renderer, "Awake");
            InvokePrivate(renderer, "Start");

            GameObject sourceGo = InstantiatePrefab("Assets/GameObject/ANM_CMA_CardData_00.prefab");
            UI_CMA_CardData_00 source = sourceGo.GetComponent<UI_CMA_CardData_00>();
            if (source == null)
            {
                throw new Exception("ANM_CMA_CardData_00 prefab has no UI_CMA_CardData_00.");
            }
            if (!service.BindMaiCardData(source, card.Id))
            {
                throw new Exception(service.LastError);
            }
            source.CardMask = true;
            source.setImage();
            Canvas.ForceUpdateCanvases();

            MobileExportPlan plan = service.BuildExportPlan("MAI", card.Id, outputRoot_);
            Texture2D holoMask = null;
            if (plan.RenderPlan.Holo.Requested)
            {
                holoMask = RenderMaiHoloMask(renderer, source);
                SaveTexture(holoMask, plan.HoloMaskPath, "MAI", card.Id, "holo");
            }

            Texture2D cardImage = RenderMaiCard(renderer, source, holoMask);
            SaveTexture(cardImage, plan.CardImagePath, "MAI", card.Id, "card");

            Object.DestroyImmediate(sourceGo);
            Object.DestroyImmediate(rendererGo);
        }

        private static void RenderMu3(CardMakerMobileUnityService service, CommonContext context)
        {
            MobileCardRecord card = FirstCard(service, "MU3");
            GameObject rendererGo = InstantiatePrefab("Assets/GameObject/TestModeUserSupportMU3File.prefab");
            MU3CardRenderer renderer = rendererGo.GetComponentInChildren<MU3CardRenderer>(true);
            if (renderer == null)
            {
                throw new Exception("TestModeUserSupportMU3File prefab has no MU3CardRenderer.");
            }
            InvokePrivate(renderer, "Start");
            renderer.initialize(context.MU3DataManager);

            GameObject sourceGo = InstantiatePrefab("Assets/GameObject/ANM_CMN_CardData_00.prefab");
            UI_CMN_CardData_00 source = sourceGo.GetComponent<UI_CMN_CardData_00>();
            if (source == null)
            {
                throw new Exception("ANM_CMN_CardData_00 prefab has no UI_CMN_CardData_00.");
            }
            if (!service.BindMu3CardData(source, card.Id, context.MU3DataManager))
            {
                throw new Exception(service.LastError);
            }
            Canvas.ForceUpdateCanvases();

            MobileExportPlan plan = service.BuildExportPlan("MU3", card.Id, outputRoot_);
            Texture2D holoMask = null;
            if (plan.RenderPlan.Holo.Requested)
            {
                bool isSign;
                holoMask = RenderMu3HoloMask(renderer, source, out isSign);
                summary_.AppendLine("MU3." + card.Id + ".isSign=" + isSign);
                SaveTexture(holoMask, plan.HoloMaskPath, "MU3", card.Id, "holo");
            }

            Texture2D cardImage = RenderMu3Card(renderer, source, holoMask);
            SaveTexture(cardImage, plan.CardImagePath, "MU3", card.Id, "card");

            Object.DestroyImmediate(sourceGo);
            Object.DestroyImmediate(rendererGo);
        }

        private static Texture2D RenderMaiHoloMask(MAICardRenderer renderer, UI_CMA_CardData_00 source)
        {
            renderer.setSize(Width, Height);
            InvokePrivate(renderer, "createTempHoloMaskTexture", Width, Height);
            UI_CMA_CardData_00 internalCard = GetField<UI_CMA_CardData_00>(renderer, "cardData_");
            internalCard.copyFrom(source);
            internalCard.setForHoloMaskRender();
            Canvas.ForceUpdateCanvases();
            Color32[] mask = (Color32[])InvokePrivate(renderer, "renderHolo", Width, Height);
            return PixelsToTexture(mask, Width, Height);
        }

        private static Texture2D RenderMaiCard(MAICardRenderer renderer, UI_CMA_CardData_00 source, Texture2D holoMask)
        {
            renderer.setSize(Width, Height);
            UI_CMA_CardData_00 internalCard = GetField<UI_CMA_CardData_00>(renderer, "cardData_");
            internalCard.copyFrom(source);
            internalCard.setForRender(null, false);
            if (holoMask != null)
            {
                internalCard.setHoloMask(holoMask);
            }
            Canvas.ForceUpdateCanvases();
            Texture2D texture = RenderToTexture(renderer, Width, Height);
            if (holoMask != null)
            {
                internalCard.removeHoloPreview();
            }
            return texture;
        }

        private static Texture2D RenderMu3HoloMask(MU3CardRenderer renderer, UI_CMN_CardData_00 source, out bool isSign)
        {
            renderer.setSize(Width, Height);
            InvokePrivate(renderer, "createTempHoloMaskTexture", Width, Height);
            UI_CMN_CardData_00 internalCard = GetField<UI_CMN_CardData_00>(renderer, "cardData_");
            internalCard.copyFrom(source);
            internalCard.setForHoloMaskRender();
            Canvas.ForceUpdateCanvases();
            object[] args = new object[] { false, Width, Height };
            Color32[] mask = (Color32[])InvokePrivate(renderer, "renderHolo", args);
            isSign = (bool)args[0];
            return PixelsToTexture(mask, Width, Height);
        }

        private static Texture2D RenderMu3Card(MU3CardRenderer renderer, UI_CMN_CardData_00 source, Texture2D holoMask)
        {
            renderer.setSize(Width, Height);
            UI_CMN_CardData_00 internalCard = GetField<UI_CMN_CardData_00>(renderer, "cardData_");
            internalCard.copyFrom(source);
            internalCard.setForRender(null, false);
            if (holoMask != null)
            {
                internalCard.setHoloMask(holoMask);
            }
            Canvas.ForceUpdateCanvases();
            Texture2D texture = RenderToTexture(renderer, Width, Height);
            if (holoMask != null)
            {
                internalCard.removeHoloPreview();
            }
            return texture;
        }

        private static MobileCardRecord FirstCard(CardMakerMobileUnityService service, string game)
        {
            List<MobileCardRecord> cards = service.ListCards(game);
            if (cards.Count == 0)
            {
                throw new Exception("No " + game + " card is available in the mobile pack.");
            }
            return cards[0];
        }

        private static CommonContext SetupOfficialRuntime()
        {
            GameObject contextGo = new GameObject("CommonContextShim_MobileSmoke");
            contextGo.SetActive(false);
            CommonContext context = contextGo.AddComponent<CommonContext>();

            FieldInfo instanceField = typeof(ContextBase<CommonContext>).GetField(
                "instance_",
                BindingFlags.Static | BindingFlags.NonPublic);
            if (instanceField == null)
            {
                throw new MissingFieldException("ContextBase<CommonContext>.instance_");
            }
            instanceField.SetValue(null, context);
            SetField(context, "stringBuilder_", new StringBuilder(256));

            CommonStatic.initialize();
            CHUStatic.initialize();
            MAIStatic.initialize();
            MU3Static.initialize();

            string streaming = Application.dataPath.Replace('\\', '/') + "/StreamingAssets/";
            CardMaker.Common.DB.DBLoader.loadAll(streaming + "Common/DB/");
            CardMaker.MU3.DB.DBLoader.loadAll(streaming + "MU3/DB/");
            summary_.AppendLine("db=loaded Common,MU3");

            AssetBundleDB.initialize(AssetBundleDB.Title.Common);
            AssetBundleDB.initialize(AssetBundleDB.Title.Chunithm);
            AssetBundleDB.initialize(AssetBundleDB.Title.Maimai);
            AssetBundleDB.initialize(AssetBundleDB.Title.MU3);
            summary_.AppendLine("assetBundleDB=initialized");

            DrainLoader(context.CHUDataManager.initialize(), "CHUDataManager");
            DrainLoader(context.MAIDataManager.initialize(), "MAIDataManager");
            DrainLoader(context.MU3DataManager.initialize(), "MU3DataManager");
            return context;
        }

        private static Texture2D RenderToTexture(object renderer, int width, int height)
        {
            Texture2D texture = new Texture2D(width, height, TextureFormat.ARGB32, false, false);
            texture.filterMode = FilterMode.Point;
            InvokePrivate(renderer, "renderTo", texture);
            return texture;
        }

        private static Texture2D PixelsToTexture(Color32[] pixels, int width, int height)
        {
            Texture2D texture = new Texture2D(width, height, TextureFormat.ARGB32, false, false);
            texture.filterMode = FilterMode.Point;
            texture.SetPixels32(pixels);
            texture.Apply(false, false);
            return texture;
        }

        private static void SaveTexture(Texture2D texture, string path, string game, string cardId, string kind)
        {
            if (texture == null)
            {
                throw new Exception(game + " " + kind + " texture is null.");
            }
            if (string.IsNullOrEmpty(path))
            {
                path = Path.Combine(outputRoot_, game + "_" + cardId + "_" + kind + ".png");
            }
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }
            File.WriteAllBytes(path, texture.EncodeToPNG());
            summary_.AppendLine(game + "." + cardId + "." + kind + ".path=" + path);
            summary_.AppendLine(game + "." + cardId + "." + kind + ".nonClearRatio=" + NonClearRatio(texture.GetPixels32()).ToString("F6"));
        }

        private static float NonClearRatio(Color32[] pixels)
        {
            if (pixels == null || pixels.Length == 0)
            {
                return 0f;
            }
            int count = 0;
            for (int i = 0; i < pixels.Length; i++)
            {
                Color32 c = pixels[i];
                if (c.r != 0 || c.g != 0 || c.b != 0 || c.a != 0)
                {
                    count++;
                }
            }
            return (float)count / (float)pixels.Length;
        }

        private static GameObject InstantiatePrefab(string assetPath)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (prefab == null)
            {
                throw new FileNotFoundException("Prefab not found", assetPath);
            }
            GameObject instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
            if (instance == null)
            {
                instance = Object.Instantiate(prefab) as GameObject;
            }
            if (instance == null)
            {
                throw new Exception("Failed to instantiate " + assetPath);
            }
            instance.name = Path.GetFileNameWithoutExtension(assetPath) + "_MobileSmoke";
            instance.SetActive(true);
            return instance;
        }

        private static void DrainLoader(ILoader loader, string label)
        {
            if (loader == null)
            {
                throw new Exception(label + " loader failed to initialize.");
            }
            int guard = 0;
            while (loader.moveNext())
            {
                guard++;
                if (guard > 200000)
                {
                    throw new Exception(label + " loader guard exceeded.");
                }
            }
            if (loader.IsErrorOccurred)
            {
                throw new Exception(label + " loader reported error.");
            }
            summary_.AppendLine(label + "=loaded");
        }

        private static object InvokePrivate(object target, string methodName, params object[] args)
        {
            BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            MethodInfo[] methods = target.GetType().GetMethods(flags);
            for (int i = 0; i < methods.Length; i++)
            {
                MethodInfo method = methods[i];
                if (method.Name != methodName)
                {
                    continue;
                }
                ParameterInfo[] parameters = method.GetParameters();
                if (parameters.Length == args.Length)
                {
                    return method.Invoke(target, args);
                }
            }
            throw new MissingMethodException(target.GetType().FullName, methodName + "(" + args.Length + ")");
        }

        private static T GetField<T>(object target, string fieldName) where T : class
        {
            FieldInfo field = target.GetType().GetField(
                fieldName,
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (field == null)
            {
                throw new MissingFieldException(target.GetType().FullName, fieldName);
            }
            return field.GetValue(target) as T;
        }

        private static void SetField(object target, string fieldName, object value)
        {
            FieldInfo field = target.GetType().GetField(
                fieldName,
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (field == null)
            {
                throw new MissingFieldException(target.GetType().FullName, fieldName);
            }
            field.SetValue(target, value);
        }

        private static string ReadArg(string argName, string envName)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == argName)
                {
                    return args[i + 1];
                }
            }
            return Environment.GetEnvironmentVariable(envName);
        }
    }
#endif
}
#endif

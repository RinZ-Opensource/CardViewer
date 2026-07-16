# Unity Bridge

These files are intended to be copied into a Unity Android port together with `mobile/CardMakerMobile.Runtime`.

They are not compiled by the local `.NET` smoke projects because they depend on `UnityEngine` and the decompiled CardMaker namespaces. The bridge keeps the mobile resource path explicit:

1. Import a `.cmpack` with `CmpackImporter`.
2. Load the installed pack with `CardMakerMobileOfflineClient`.
3. Call `CardMakerMobileUnityResources.Initialize(importResult.InstallRoot)`.
4. Integrate official `AssetBundleDB.load(...)` or game-specific resource managers locally so they call the bridge before falling back to desktop `AssetBundle.LoadFromFile`.

## Integration Boundary

The tracked bridge is source-only and does not include an automatic patcher for
an external reconstructed project. The archived local experiment used a
target-specific patcher containing source matching/replacement snippets; it is
excluded pending provenance and redistribution review. A resumed integration
must copy the runtime and bridge sources locally, then review and implement at
least these patch points:

- `CardMaker/Common/AssetBundleDB.cs`: MAI/MU3/Common/CHU AssetBundle lookups consult the mobile pack before desktop bundle loading.
- `CardMaker/CHU/CHUResourceManager.cs`: CHU direct image paths consult the mobile pack before filesystem fallback.

The Android-facing flow should keep one `CardMakerMobileOfflineClient` instance alive for browsing, editing, preview planning, official print-flow state, and diagnostics:

```csharp
var service = gameObject.AddComponent<CardMakerMobile.UnityBridge.CardMakerMobileUnityService>();
service.TryLoadInstalledPack(importResult.InstallRoot);
Debug.Log(service.ValidateOfflineFlowSummary());

var cards = service.ListCardItems("CHU");
var plan = service.BuildPreviewPlan("CHU", cards[0].Id);
```

`MobileGameCapabilities.ForGame(...)` records the official renderer/card-data classes and capability differences. In particular, CHU uses `CHUCardRenderer` with direct image paths and does not request a holo mask because the official CHU print queue constructs its print query with `holo` set to `false`.

Minimum patch point:

```csharp
public override UnityEngine.Object load(string assetBundleName, string name)
{
    UnityEngine.Object mobileObj = MobileAssetBundleDBBridge.Load((AssetBundleDB.Title)title_, assetBundleName, name);
    if (mobileObj != null)
    {
        return mobileObj;
    }

    // existing official desktop AssetBundle path
}
```

CHU direct PNG paths should use `CardMakerMobileUnityResources.LoadTextureFromArchiveOrRaw(...)` when the official absolute path does not exist on Android.

For holo generation, `MobileHoloMaskBridge` wraps the pure runtime `HoloMaskGenerator` for Unity `Color32[]` and `Texture2D` data. The intended patch point is after the official front-pass and root-holo-pass renders have produced `Color32[]` arrays.

For preview and developer smoke setup, build a `MobileCardRenderPlan` from the runtime pack and pass it to `MobileUnityRenderPlanLoader.Load(...)`. The returned `MobileUnityRenderPlanTextures` contains the primary image, thumbnail, normal layers, and any static holo inputs already loaded as `Texture2D`.

`MobileUnityOfficialRendererBridge` is the wrapper for actual official renderer calls used by preview verification and batch smoke. It intentionally accepts already-prepared official card-data components, so card layout, QR, font, serial, and holo passes stay inside the decompiled official renderer classes:

```csharp
var exportPlan = service.BuildExportPlan("MAI", cardId, service.DefaultExportRoot());
service.BindMaiCardData(maiCardData, cardId);
MobileUnityOfficialRendererBridge.RenderMaiHoloMaskTexture(
    maiRenderer,
    maiCardData,
    delegate(Texture2D holoMask)
    {
        MobileUnityOfficialRendererBridge.SaveHoloMaskPng(exportPlan, holoMask, Debug.LogError);
        MobileUnityOfficialRendererBridge.RenderMaiCardTexture(
            maiRenderer,
            maiCardData,
            holoMask,
            false,
            delegate(Texture2D cardImage)
            {
                MobileUnityOfficialRendererBridge.SaveCardPng(exportPlan, cardImage, Debug.LogError);
            },
            Debug.LogError);
    },
    Debug.LogError);
```

CHU should call `RenderChuCardTexture(...)` and skip holo. MU3 should call `RenderMu3HoloMaskTexture(...)` before `RenderMu3CardTexture(...)` when the render plan requests holo.

`MobileUnityOfficialCardDataBinder` maps mobile card records and local print fields into official card-data components:

- `BindChuCardData(...)`: fills `UI_CCH_CardData_00.DispInfo` from the official CHU data manager.
- `BindMaiCardData(...)`: fills `UI_CMA_CardData_00.DispInfo` from official MAI data plus mobile `userName`, `rating`, `friendCode`, `charaId`, and `serialId`.
- `BindMu3CardData(...)`: fills `UI_CMN_CardData_00.CardData` from official MU3 data plus mobile `userName`, `ownCount`, `awaken`, hide flags, holo, sign layout, and `serialId`.

The editor batch smoke requires Unity 5.6 with Android Build Support. Supply all
machine-specific paths explicitly:

```powershell
$env:CARDVIEWER_MOBILE_REFERENCED_ONLY="1"
$env:CARDVIEWER_MOBILE_SKIP_RAW="1"
$env:CARDVIEWER_MOBILE_CARD_IDS="CHU:1002,MAI:1014,MU3:1"
$packageRoot = "I:\path\to\cardmaker-package"
$unityEditor = "D:\path\to\Unity\Editor\Unity.exe"
$unityProject = "D:\path\to\reconstructed-cardmaker-unity-project"
$packPath = "src-tauri\target\mobile-pack-check\smoke-unity-compatible.cmpack"
$importRoot = "src-tauri\target\mobile-pack-check\imported-unity-compatible"
$outputRoot = Join-Path $env:TEMP "CardMakerMobile\render-smoke"
$logFile = Join-Path $env:TEMP "CardMakerMobile\render-smoke.log"

npm.cmd run export:mobile-pack -- $packageRoot $packPath

dotnet run --project mobile\CardMakerMobile.Tools\CmpackSmoke\CmpackSmoke.csproj -- `
  $packPath `
  $importRoot

& $unityEditor -batchmode -quit `
  -projectPath $unityProject `
  -executeMethod CardMakerMobile.UnityBridge.CardMakerMobileRenderSmokeBatch.Run `
  -mobilePackRoot $importRoot `
  -mobileOutputRoot $outputRoot `
  -logFile $logFile
```

Expected diagnostics for this smoke pack: all three games have one previewable card; CHU has zero holo requests; MAI has one holo request with no missing inputs; `CardMakerMobileRenderSmokeBatch` writes `ready=True` and `issues=0`.

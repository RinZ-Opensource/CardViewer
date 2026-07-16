# CardMaker Mobile Runtime

> Status (2026-07-16): source-only R&D prototype. This directory is not a
> supported Android product or release pipeline. The APK/OBB results formerly
> recorded here belong to the archived 2026-05-26 snapshot and were not
> revalidated during the current repository cleanup.

This folder contains mobile-side code for importing and consuming `.cmpack` resources generated from an official local CardMaker package.

The runtime does not include official assets and does not synthesize replacement artwork. It only reads a user-provided `.cmpack`, verifies it, and installs the official converted payload into app-private storage.

The prototype direction explored patching and repackaging a reconstructed
official Unity project instead of building a separate visual clone. The runtime
and bridge code here are compatibility-layer experiments around official
scripts/assets: resource lookup, mobile pack import, offline state, and platform
stubs.

## Projects

- `CardMakerMobile.Runtime`: dependency-free C# runtime intended to be copied into or referenced by a Unity Android project. The checked-in `.csproj` targets `net8.0` for local smoke validation; the source files avoid .NET 8-specific APIs so they can be imported into Unity.
- `CardMakerMobile.Tools/CmpackSmoke`: desktop smoke tool for validating `.cmpack` parsing and integrity checks.
- `CardMakerMobile.UnityBridge`: Unity-only bridge code for loading converted PNGs as `Texture2D`/`Sprite`, resolving CHU direct image paths, supporting local mobile stubs, and wrapping the holo mask generator for `Color32[]`.

## Smoke Test

Generate a small official-resource smoke pack first:

```powershell
$env:CARDVIEWER_MOBILE_REFERENCED_ONLY="1"
$env:CARDVIEWER_MOBILE_SKIP_RAW="1"
$env:CARDVIEWER_MOBILE_CARD_IDS="CHU:1002,MAI:1014,MU3:1"
$packageRoot = "I:\path\to\cardmaker-package"
npm.cmd run export:mobile-pack -- $packageRoot "src-tauri\target\mobile-pack-check\smoke-unity-compatible.cmpack"
```

Then import and verify it:

```powershell
dotnet run --project mobile\CardMakerMobile.Tools\CmpackSmoke\CmpackSmoke.csproj -- `
  "src-tauri\target\mobile-pack-check\smoke-unity-compatible.cmpack" `
  "src-tauri\target\mobile-pack-check\imported-unity-compatible"
```

Expected checks:

- USTAR archive is parsed without path traversal.
- `manifest.json`, `cards.json`, `cards.index.json`, `assets/index.json`, and `integrity/files.json` are present.
- Every file listed in `integrity/files.json` has the expected size and SHA-256.
- The runtime can load the CHU/MAI/MU3 card catalog from shards.
- Card `imagePath` and `assetLayers` resolve to installed files.
- Every sampled card can build a `MobileCardRenderPlan` for preview and renderer-smoke inputs.
- The `CardMakerMobileOfflineClient` unified flow can list CHU/MAI/MU3 cards, validate preview readiness, persist edits, and build developer render-smoke plans.
- A local edit session can save and reload print-field overrides without modifying official source data.
- An edited card can build a developer-only PNG/holo smoke output plan.
- MAI/MU3 official bundle names resolve through `assets/index.json`.
- The shared holo-mask implementation passes a root-mask merge check and MU3 sign clear-priority check.

## Unity Android Integration

In Unity, import a `.cmpack` selected through Android Storage Access Framework or copied into persistent storage, then call:

```csharp
var importer = new CardMakerMobile.Runtime.CmpackImporter();
var result = importer.Import(cmpackPath, installRoot, true);
```

Use `result.InstallRoot` as the base directory for the CardMaker pack adapter:

- `manifest.json` describes the pack format and manifest paths.
- `cards.index.json` and `cards.<game>.json` drive CHU/MAI/MU3 list startup.
- `assets/index.json` maps official Unity AssetBundle image resources to converted PNG objects.
- `raw/root_XX/...` is the source for XML/DB/PAC/sound compatibility layers in full packs.

For runtime access after import:

```csharp
var client = CardMakerMobile.Runtime.CardMakerMobileOfflineClient.Load(result.InstallRoot);
var maiCards = client.ListCards("MAI");

string imagePath;
client.Pack.TryResolveOfficialAsset("mai", "ui_cardbase_0000004_650001", out imagePath);

var report = client.ValidateOfflineFlow();
var renderPlan = client.BuildPreviewPlan("MAI", maiCards[0].Id);
```

`CardMakerMobileOfflineClient` is the preferred Android-facing entry point. It keeps local edits under `user/edits.json`, applies them without modifying official data, exposes game capabilities, and returns workflow diagnostics that can be shown in an import/settings screen.

Important capability differences:

- CHU uses `CHUCardRenderer` and direct image paths through `CHUResourceManager`.
- CHU official print queue creates `PrintLib.PrintQuery(holo: false, ...)`; the mobile planner therefore does not request a holo mask for CHU.
- MAI and MU3 use `AssetBundleDB` image lookup and official holo passes. Static converted inputs are used where available; otherwise the Unity renderer must run the same front/root-holo passes before preview or the stubbed print flow.

In Unity code, use `CardMakerMobileUnityResources` after import:

```csharp
CardMakerMobile.UnityBridge.CardMakerMobileUnityResources.Initialize(result.InstallRoot);
Texture2D texture = CardMakerMobile.UnityBridge.CardMakerMobileUnityResources.LoadTexture(
    "mai",
    "ui_cardbase_0000004_650001");
```

For a scene-level Android integration, use `CardMakerMobileUnityService`:

```csharp
var service = gameObject.AddComponent<CardMakerMobile.UnityBridge.CardMakerMobileUnityService>();
service.TryLoadInstalledPack(result.InstallRoot);
var cards = service.ListCardItems("MAI");
service.SetPrintField("MAI", cards[0].Id, "userName", "PLAYER");
service.SaveEdits();
service.BindMaiCardData(maiCardData, cards[0].Id);
```

For card preview and developer render-smoke setup:

```csharp
var planner = new CardMakerMobile.Runtime.MobileCardRenderPlanner(pack);
var plan = planner.Build(card);
var textures = CardMakerMobile.UnityBridge.MobileUnityRenderPlanLoader.Load(plan);
```

`textures.Primary` and `textures.Layers` are the image inputs that should be bound to the official card UI/renderer fields before invoking the existing render pass.

`HoloMaskGenerator` implements the official shared mask steps:

- any front-pass RGBA channel greater than zero becomes white
- seven dilate passes with the same eight-neighbor sampling as the official renderer
- merge with root holo pass by OR
- MU3 sign mask adds holo, sign alpha clears holo, and clear wins

`MobileCardRenderPlan` is the handoff object for preview and official-renderer smoke code. It contains resolved file paths for the primary card image, thumbnail, official asset layers, and holo-related inputs when the card metadata requests holo.

Local edits are stored separately from official data:

```csharp
client.SetPrintField("MAI", maiCards[0].Id, "userName", "PLAYER");
client.SaveEdits();

var editedCard = CardMakerMobile.Runtime.CardMakerMobileOfflineClient
    .Load(result.InstallRoot)
    .GetCard("MAI", maiCards[0].Id);
```

Developer smoke code may request an output plan and let Unity write diagnostic PNGs:

```csharp
var exportPlan = service.BuildExportPlan("MAI", cards[0].Id, outputRoot);
```

`MobileUnityOfficialRendererBridge` wraps the official renderers for developer smoke output:

- CHU: `RenderChuCardTexture(...)`, then `SaveCardPng(...)`; no holo mask.
- MAI: `RenderMaiHoloMaskTexture(...)`, `SaveHoloMaskPng(...)`, then `RenderMaiCardTexture(...)`.
- MU3: `RenderMu3HoloMaskTexture(...)`, `SaveHoloMaskPng(...)`, then `RenderMu3CardTexture(...)`.

Before calling the renderer bridge, bind mobile records into official card-data components through `BindChuCardData`, `BindMaiCardData`, or `BindMu3CardData`. These methods keep card layout and resource resolution in the official `UI_*_CardData` classes.

Printer and network calls remain stubs on mobile. The user-visible Android target should preserve the official print-flow screens and states; PNG/PDF/share export is intentionally out of scope for the current official-parity build.

The archived experiment used a local integration patcher for target-specific
changes to reconstructed official sources. That patcher embeds matching
snippets from the local target and is intentionally excluded from this public
repository pending a separate provenance and redistribution review. The tracked
bridge sources do not modify an external Unity project automatically; any
resumed integration must implement and review its patch points locally.

## Archived APK Build Snapshot

The 2026-05-26 local snapshot reported that Unity 5.6 Android Build Support, an
isolated Android SDK, and JDK8 were wired through
`CardMakerMobileAndroidBuild.BuildOfficialAndroid`, producing
`src-tauri/target/android-build/CardMakerMobile.apk` and
`CardMakerMobile.main.obb`. Those outputs are ignored local artifacts, not
repository releases, and that build was not rerun for this cleanup.

The build script temporarily externalizes `Assets/StreamingAssets` during
Android packaging, so official resources are not intended to be embedded into
the APK; any resumed prototype must obtain them through the local mobile
pack/import path and revalidate the full runtime on an Android device.

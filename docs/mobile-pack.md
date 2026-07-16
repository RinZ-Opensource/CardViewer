# Mobile Resource Pack

> Status (2026-07-16): prototype contract. The exporter and source-only mobile
> runtime are useful local R&D, but no supported Android application, Android
> CI job, or mobile release is provided by this repository. The mobile code is
> not used by the React/Tauri application or the Cloudflare deployment.

`export:mobile-pack` converts a local official CardMaker package into an
offline mobile resource pack. The pack is generated locally and must not be
committed to source control.

This format is for offline CHU/MAI/MU3 CardMaker resources. It is unrelated to
the web score-card feature and its `official/scorecard/...` R2 objects. Do not
publish a `.cmpack` to Pages or R2 as part of the normal web deployment.

```powershell
$packageRoot = "I:\path\to\cardmaker-package"
npm.cmd run export:mobile-pack -- $packageRoot
```

Default output:

```text
private-assets/official/mobile/CardMakerMobilePack.cmpack
```

The `.cmpack` file is an uncompressed USTAR archive in the prototype format.
The local C# importer can verify `integrity/files.json` and unpack it into an
application-private directory. A future Android client could put the same
contract behind Android's document picker and app-private storage APIs.

## Contract

The pack contains only official source data or deterministic conversions from it. The exporter does not create placeholder card art. Missing resources are reported as warnings and omitted.

Top-level files:

- `manifest.json`: pack format, source roots, resource policy, game coverage, and scan stats.
- `cards.json`: CHU/MAI/MU3 card records with mobile-relative asset paths.
- `cards.index.json` and `cards.<game>.json`: card shards for faster app startup.
- `assets/index.json`: Unity AssetBundle expansion index. Each entry records the original bundle path, the primary image path used by current card records, and every exported Sprite/Texture2D object.
- `integrity/files.json`: SHA-256 and size for every payload file except the integrity manifest itself.
- `assets/...`: mobile-readable PNG/JPG/WebP render assets. Unity AssetBundle image resources are converted to PNG with UnityPy.
- `raw/root_XX/...`: official XML, DB, PAC, sound, and direct image data needed by compatibility layers. Windows AssetBundle payloads are excluded here because converted render assets live under `assets`.

Exporter implementation files under staging `.tools` are never included in the final `.cmpack`.

Unity bundles are expanded instead of treated as one flat image. For each bundle, the exporter writes:

```text
assets/<group>/<original-relative-path>.png
assets/<group>/<original-relative-path>.bundle/metadata.json
assets/<group>/<original-relative-path>.bundle/objects/*.png
```

The `.png` beside the `.bundle` directory is the same primary image CardViewer
historically used for preview compatibility. Prototype Android integration
should prefer `assets/index.json` for official resource-name lookup or a
non-primary Sprite/Texture2D.

## Modes

Default mode exports all known official image assets from `assets_com`, `assets_mai`, `assets_mu3`, plus direct CHU images. This is the baseline for matching official offline behavior.

For a smaller diagnostic pack:

```powershell
$env:CARDVIEWER_MOBILE_REFERENCED_ONLY="1"
$packageRoot = "I:\path\to\cardmaker-package"
npm.cmd run export:mobile-pack -- $packageRoot
```

This keeps only assets referenced by the generated card manifest. It is a
diagnostic mode, not evidence of full Android experience parity.

For a quick smoke test against a real package:

```powershell
$env:CARDVIEWER_MOBILE_REFERENCED_ONLY="1"
$env:CARDVIEWER_MOBILE_CARD_LIMIT_PER_GAME="1"
$env:CARDVIEWER_MOBILE_SKIP_RAW="1"
$packageRoot = "I:\path\to\cardmaker-package"
npm.cmd run export:mobile-pack -- $packageRoot "src-tauri\target\mobile-pack-check\smoke.cmpack"
```

This still uses official card data and official converted assets, but it
intentionally omits most cards and raw data. Do not treat this mode as a
full-experience Android validation pack.

For a deterministic CHU/MAI/MU3 renderer smoke pack:

```powershell
$env:CARDVIEWER_MOBILE_REFERENCED_ONLY="1"
$env:CARDVIEWER_MOBILE_SKIP_RAW="1"
$env:CARDVIEWER_MOBILE_CARD_IDS="CHU:1002,MAI:1014,MU3:1"
$packageRoot = "I:\path\to\cardmaker-package"
npm.cmd run export:mobile-pack -- $packageRoot "src-tauri\target\mobile-pack-check\smoke-unity-compatible.cmpack"
```

`CARDVIEWER_MOBILE_CARD_IDS` is a diagnostic-only filter. It is useful for
repeatable bridge tests; full Android parity remains unverified until an
unfiltered pack and an actual Android runtime are tested.

## Prototype Android Import Contract

A future Android client would need to:

1. Let the user choose a `.cmpack` file.
2. Read it as USTAR.
3. Verify `integrity/files.json`.
4. Copy payloads into app-private storage.
5. Load `manifest.json` and `cards.index.json`.
6. Route official resource requests through the pack adapter:
   - CHU direct file lookups map to `raw/...` or `assets/chu/...`.
   - MAI/MU3/Common image lookups first consult `assets/index.json`, then fall back to card-level `imagePath`/`assetLayers`.
   - DB/XML/PAC lookups map to `raw/...`.
7. Stub printer/network paths while preserving the official print-flow UI and
   state transitions. User-visible PNG/PDF/share export was not part of the
   prototype parity target.

The source-only runtime prototype under `mobile/CardMakerMobile.Runtime`
implements steps 2-6 for local desktop files:

- `CmpackImporter` extracts and verifies a pack.
- `CardMakerMobileOfflineClient` is the Android-facing offline workflow entry point for import result loading, CHU/MAI/MU3 browsing, edit persistence, preview planning, renderer-smoke planning, and diagnostics.
- `CardMakerMobilePack` loads card shards and asset index data from the installed directory.
- `MobileCardRenderPlanner` turns a card record into preview and renderer-smoke inputs with resolved paths and holo metadata.
- `MobileEditSession` stores local print-field overrides separately from official data.
- `MobileExportPlanner` creates developer-only render output plans for Unity
  smoke tests. It is not a user-visible export/share feature.
- `TryResolveOfficialAsset(group, name, out path)` maps official MAI/MU3/Common bundle names to converted PNGs.
- `HoloMaskGenerator` contains the shared official holo mask merge/dilate logic and MU3 sign clear-priority behavior.

Unity-specific bridge code lives under `mobile/CardMakerMobile.UnityBridge`:

- `CardMakerMobileUnityResources` loads resolved PNGs as readable `Texture2D` and `Sprite` objects with a cache.
- `CardMakerMobileUnityService` is the scene-level Unity facade for Android import/load, card lists, local edits, preview plans, developer render-output plans, and diagnostic text.
- `MobileAssetBundleDBBridge` is the intended patch hook for official `AssetBundleDB.load(...)`.
- `MobileChunithmResourceBridge` handles CHU direct PNG paths when the original absolute file path is unavailable on Android.
- `MobileHoloMaskBridge` adapts `HoloMaskGenerator` to Unity `Color32[]`/`Texture2D` data.
- `MobileUnityOfficialCardDataBinder` maps mobile card records and local print fields into official CHU/MAI/MU3 card-data components before rendering.
- `MobileUnityOfficialRendererBridge` wraps the official CHU/MAI/MU3 renderer methods and writes rendered PNG files from their `Texture2D` output.

## Unity Integration Boundary

The tracked bridge sources do not include an automatic patcher for an external
reconstructed Unity project. The archived experiment used a target-specific
local patcher containing source matching/replacement snippets; it is excluded
from this public repository pending provenance and redistribution review.
Resuming the experiment requires a locally reviewed integration that copies the
bridge sources and implements the documented resource-loading patch points.

## Runtime Workflow

Prototype Unity integration should use the runtime facade instead of directly
wiring every low-level component:

```csharp
var client = CardMakerMobile.Runtime.CardMakerMobileOfflineClient.Load(installRoot);
var report = client.ValidateOfflineFlow();
var cards = client.ListCards("MAI");
client.SetPrintField("MAI", cards[0].Id, "userName", "PLAYER");
client.SaveEdits();

var previewPlan = client.BuildPreviewPlan("MAI", cards[0].Id);
// Developer smoke tests may still build an output plan.
// A future product flow should continue through the official print UI/stub state.
```

`MobileGameCapabilities` records official game differences needed by the UI and renderer adapter:

- CHU: `CHUCardRenderer`, `UI_CCH_CardData_00`, direct `CHUResourceManager` image paths, no official holo mask request.
- MAI: `MAICardRenderer`, `UI_CMA_CardData_00`, `AssetBundleDB Title.Maimai`, official front/root-holo mask pipeline.
- MU3: `MU3CardRenderer`, `UI_CMN_CardData_00`, `AssetBundleDB Title.MU3`, official holo pipeline plus sign/signMask clear-priority behavior.

Developer smoke image output should remain renderer-driven:

1. Build a `MobileExportPlan` with `CardMakerMobileUnityService`.
2. Use `CardMakerMobileUnityService.BindChuCardData`, `BindMaiCardData`, or `BindMu3CardData` to populate the official game card-data component (`UI_CCH_CardData_00`, `UI_CMA_CardData_00`, or `UI_CMN_CardData_00`) from the selected official card record and local print fields.
3. Call `MobileUnityOfficialRendererBridge` for the selected game.
4. Save card PNG and, for MAI/MU3 holo cards, save the generated holo mask PNG as test artifacts only.

## Verification Boundary

The contract and source layout above match the code currently present in this
repository. The Android runtime, full-pack import, external Unity project, and
APK build were not rerun during the 2026-07-16 repository cleanup. Historical
machine-specific smoke/build claims live in
`cardmaker-mobile-android-plan.md` and must not be read as current release
verification.

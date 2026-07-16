# CardMaker Android Port Plan (Archived)

> Archived status (2026-07-16): this is a 2026-05-26 local R&D snapshot, not
> the current repository roadmap or a current verification report. Paths,
> package counts, APK metadata, and successful build claims below describe that
> historical machine state and were not revalidated during repository cleanup.

This document records the mobile-port direction explored for an offline Android
CardMaker client. It is intentionally source-only: official CardMaker data,
textures, fonts, and bundles must remain outside the repository and be imported
locally through a generated `.cmpack`.

## Relationship to the Current Repository

- The maintained products are the React/Vite/Tauri viewer and its Cloudflare
  public deployment.
- CHUNITHM, maimai, and O.N.G.E.K.I. score cards are implemented in
  `src/scorecard/` and are unrelated to this Android CardMaker experiment.
- `mobile/` contains prototype runtime, smoke-tool, and Unity bridge source. The
  snapshot's target-specific local patcher is excluded pending provenance and
  redistribution review. None of this is wired into the web app, Pages
  Functions, song database Worker, or a supported Android release pipeline.
- `export:mobile-pack` remains a local Rust exporter. Generated `.cmpack`,
  imported official resources, APKs, and OBBs are not repository content.
- No Android CI result or live-device result should be inferred from this
  document. Re-establish those independently before resuming the port.

## Archived Integrity Snapshot (2026-05-26)

Reported local official inputs at the time:

- `I:\package\CardMaker.exe` exists.
- `I:\package\CardMaker_Data\Managed\Assembly-CSharp.dll` and Unity managed DLLs exist.
- `I:\package\CardMaker_Data\StreamingAssets` exists.
- StreamingAssets has CHU, MAI, MU3, and Common roots.
- The slim Unity 5.6 experiment is a reconstructed runtime testbed, not a complete original project.

Observed StreamingAssets file counts on 2026-05-26:

- CHU: 2093 files.
- MAI: 1474 files.
- MU3: 29 files.
- Common: 12 files.

The snapshot judged the source/resource set sufficient to investigate an
offline Android port, with the official package as source of truth and
missing-asset diagnostics at import time. Unity 5.6 was reported at
`D:\Codes\Games\CardMaker\tools\Unity564f1\Editor\Unity.exe`, and editor batch
rendering was reported as verified on that machine.

The explored route was direct repackaging of the reconstructed official Unity
project for Android: keep the external reconstructed scripts/assets as the
executable base, apply repeatable mobile patches/stubs, and build an APK from
that patched Unity project. It was not a separate lookalike renderer.

Snapshot build status: Unity 5.6 Android Build Support was installed under
`D:\Codes\Games\CardMaker\tools\Unity564f1\Editor\Data\PlaybackEngines\AndroidPlayer`.
The local build used an isolated SDK and JDK8. A clean APK build was reported at
`D:\Codes\ConfigArc\CardViewer\src-tauri\target\android-build\CardMakerMobile.apk`.
That ignored output is not present in a clean checkout and is not a current
release artifact.

## Archived Module Decisions

Keep or bridge:

- CHU, MAI, and MU3 official card data classes and renderers.
- Official card DB/XML semantics, including game-specific data manager lookups.
- Official Unity renderer passes for final card output.
- Official holo behavior for MAI/MU3. CHU should skip holo because the official CHU print queue sends non-holo print queries.
- Official resource names and lookup patterns. Android must adapt paths, not rename the resource contract.
- Official fonts, QR, serial, and layout logic through the decompiled Unity card-data/rendering components.

Replace:

- PrintDLL and printer device calls with compatibility stubs that preserve the official UI flow and completion/error states.
- Network/server calls with local-only compatibility stubs.
- Windows absolute-path file access with mobile pack lookup.
- Runtime Windows AssetBundle loading with converted image objects plus pack-index lookup.

## Archived Technology Route

Route selected for the experiment: Unity Android port with official C# renderer
retention.

Benefits:

- Keeps CHU/MAI/MU3 render behavior closest to official code.
- Preserves card-data, QR, text layout, serial, font, and holo pass behavior in the same rendering stack.
- Reduces risk compared with reimplementing renderer composition in React Native, Canvas, Skia, or native Android.

Tradeoffs:

- Needs a Unity 5.6-compatible project path or a carefully forward-ported Unity project.
- Requires patch points for resource lookup and platform APIs.
- Needs Android storage/import UI around a Unity scene.

Rejected as primary route:

- Pure web/mobile UI renderer. Useful for catalog browsing, but too risky for full official visual parity.
- Native Android renderer. High effort and likely to diverge on fonts, masks, blend order, and holo passes.

## Resource Packaging

Use an independent packer. The official package is never committed.

The prototype pack format is `.cmpack`, an uncompressed USTAR archive containing:

- `manifest.json`
- `cards.index.json`
- `cards.<game>.json`
- `assets/index.json`
- `integrity/files.json`
- converted official assets under `assets/...`
- raw compatibility files under `raw/root_XX/...`

The exporter converts Unity AssetBundle image objects to PNG through UnityPy
and records object metadata. The planned Android client would import one
`.cmpack`, verify SHA-256/size, then install it into app-private storage.

Full-experience packs should export all known official image assets. The referenced-only mode is only for smoke testing.

## Planned Android Client Architecture

Import layer:

- Pick `.cmpack` through Android Storage Access Framework.
- Extract through the tar reader with path traversal protection.
- Verify `integrity/files.json`.
- Store under app-private versioned install roots.

Pack/runtime layer:

- `CardMakerMobileOfflineClient` loads manifest, shards, asset index, edits, and workflow diagnostics.
- `MobileGameCapabilities` records CHU/MAI/MU3 differences.
- `MobileEditSession` stores local print-field changes in `user/edits.json` without modifying official data.

Resource layer:

- `CardMakerMobileUnityResources` loads installed PNG/JPG/WebP files as `Texture2D`/`Sprite`.
- `MobileAssetBundleDBBridge` hooks official `AssetBundleDB.load(...)`.
- `MobileChunithmResourceBridge` hooks CHU direct image loading.
- Raw XML/DB/PAC compatibility files remain available under `raw/...`.

Render layer:

- `MobileUnityOfficialCardDataBinder` binds mobile records and user edits into official `UI_CCH_CardData_00`, `UI_CMA_CardData_00`, or `UI_CMN_CardData_00`.
- `MobileUnityOfficialRendererBridge` calls official CHU/MAI/MU3 renderer methods and writes PNG outputs.
- `HoloMaskGenerator` mirrors the shared official holo mask algorithm for deterministic mask operations and tests.

UI workflow layer:

- Game tabs for CHU/MAI/MU3.
- Offline card list with search/filter.
- Per-card edit form backed by official print fields.
- Preview scene using official renderer output.
- Official print-flow screens backed by local printer/network stubs.
- Settings and diagnostics for pack version, missing assets, import warnings, and render errors.

## Proposed MVP Scope

The proposed MVP was offline only:

- Import a local official `.cmpack`.
- Verify and install the pack.
- List CHU/MAI/MU3 cards.
- Select a card and bind official card-data components.
- Render a single-card official-style preview.
- Generate MAI/MU3 holo masks when requested by official card metadata and user fields.
- Walk through the official print confirmation/progress/result flow with local stubs instead of real printer/network calls.
- Show diagnostics for missing resources instead of creating placeholder art.

Out of MVP:

- Real server login.
- Real printer output.
- Cloud sync.
- User-visible PNG/PDF/share export.
- Manually invented card art or substitute official assets.

## Prototype Implementation at the Snapshot

Packer:

- `src-tauri/src/bin/export_mobile_pack.rs`
- `src-tauri/src/scanner/mod.rs`
- `src-tauri/scripts/extract_unity_bundle.py`

Runtime:

- `mobile/CardMakerMobile.Runtime`
- `mobile/CardMakerMobile.Tools/CmpackSmoke`

Unity bridge:

- `mobile/CardMakerMobile.UnityBridge`
- The snapshot installed it into the slim Unity experiment through a local
  `patch_unity_project.py` that is not part of the current public repository.
- That local installer patched official `AssetBundleDB`, `CHUResourceManager`,
  `CommonDataLoader`, `CommonContext`, CHU/MAI/MU3 data managers, and `PrintLib`
  in place with marker-based, idempotent changes.
- The snapshot bridge preferred installed `.cmpack/raw/root_XX/...` files for
  root configs, DB tables, game XML roots, and AssetBundle set metadata before
  falling back to desktop `Application.streamingAssetsPath`.
- The snapshot Android/iOS `PrintLib` stub reported Ready and completed local
  print/status/error-log queries while preserving relevant `PrintQuery` fields.

Documentation:

- `docs/mobile-pack.md`
- `mobile/README.md`
- `mobile/CardMakerMobile.UnityBridge/README.md`

## Historical Verification Commands

These commands were reported as passing locally on 2026-05-26. They were not
rerun for the current repository cleanup. Commands naming
`patch_unity_project.py` refer to the excluded local snapshot tool and are not
runnable from a clean checkout:

```powershell
dotnet build mobile\CardMakerMobile.Tools\CmpackSmoke\CmpackSmoke.csproj --no-restore
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
python -B -m py_compile mobile\CardMakerMobile.UnityBridge\patch_unity_project.py src-tauri\scripts\extract_unity_bundle.py
python mobile\CardMakerMobile.UnityBridge\patch_unity_project.py --project "D:\Codes\Games\CardMaker\experiments\unity_slim_20260526_1131" --check
dotnet run --project mobile\CardMakerMobile.Tools\CmpackSmoke\CmpackSmoke.csproj --no-build -- src-tauri\target\mobile-pack-check\smoke-runtime.cmpack src-tauri\target\mobile-pack-check\imported-runtime-final
```

Additional Unity bridge verification:

```powershell
$env:CARDVIEWER_MOBILE_REFERENCED_ONLY="1"
$env:CARDVIEWER_MOBILE_SKIP_RAW="1"
$env:CARDVIEWER_MOBILE_CARD_IDS="CHU:1002,MAI:1014,MU3:1"
npm.cmd run export:mobile-pack -- "I:\package" "src-tauri\target\mobile-pack-check\smoke-unity-compatible.cmpack"
dotnet run --project mobile\CardMakerMobile.Tools\CmpackSmoke\CmpackSmoke.csproj -- src-tauri\target\mobile-pack-check\smoke-unity-compatible.cmpack src-tauri\target\mobile-pack-check\imported-unity-compatible
& "D:\Codes\Games\CardMaker\tools\Unity564f1\Editor\Unity.exe" -batchmode -quit -projectPath "D:\Codes\Games\CardMaker\experiments\unity_slim_20260526_1131" -executeMethod CardMakerMobile.UnityBridge.CardMakerMobileRenderSmokeBatch.Run -mobilePackRoot "D:\Codes\ConfigArc\CardViewer\src-tauri\target\mobile-pack-check\imported-unity-compatible" -mobileOutputRoot "D:\Codes\Games\CardMaker\official_exports\mobile_smoke_20260526_codex4" -logFile "D:\Codes\Games\CardMaker\experiments\unity_slim_20260526_1131\mobile_render_smoke4.log"
```

The archived smoke summary reported `ready=True` and `issues=0`;
CHU/MAI/MU3 each had one previewable card, and MAI/1014 produced a non-empty
official holo mask.

Android build-entry verification:

```powershell
& "D:\Codes\Games\CardMaker\tools\Unity564f1\Editor\Unity.exe" -batchmode -quit `
  -projectPath "D:\Codes\Games\CardMaker\experiments\unity_slim_20260526_1131" `
  -executeMethod CardMakerMobile.UnityBridge.CardMakerMobileAndroidBuild.BuildOfficialAndroid `
  -androidSdkRoot "D:\Codes\Games\CardMaker\tools\android-sdk-unity56" `
  -androidJdkRoot "D:\Codes\Games\CardMaker\tools\jdk8\jdk8u492-b09" `
  -mobileApkPath "D:\Codes\ConfigArc\CardViewer\src-tauri\target\android-build\CardMakerMobile.apk" `
  -logFile "D:\Codes\Games\CardMaker\experiments\unity_slim_20260526_1131\mobile_android_build_shaderfixed.log"
```

The snapshot recorded a successful Android build with these local outputs:

- `D:\Codes\ConfigArc\CardViewer\src-tauri\target\android-build\CardMakerMobile.apk`
- `D:\Codes\ConfigArc\CardViewer\src-tauri\target\android-build\CardMakerMobile.main.obb`

The snapshot APK badging reported `com.local.cardmaker.mobile`,
`minSdkVersion=16`, and `targetSdkVersion=23`. The snapshot build script moved
`Assets/StreamingAssets` out during packaging so the 4.7GB official resource
tree was not embedded in the APK; official resources were expected through the
mobile pack/import path.

## Unexecuted Follow-up Queue

These were the next proposed steps at the time. They remain unverified backlog,
not a commitment or current release plan.

1. Build a full `.cmpack` with raw official data enabled and verify the Android raw path bridge against root configs, DB tables, game XML, and AssetBundle set metadata.
2. Patch the next platform runtime blockers in the same marker-based style, starting with network/libhttp and any official initialization path that still assumes Windows/arcade hardware.
3. Promote the editor smoke scene into a minimal Android scene that loads an installed `.cmpack` and instantiates CHU/MAI/MU3 official renderer paths.
4. Add an editor or runtime smoke script that compares generated holo masks against the known official export samples.
5. Add official card browsing/edit screens over `CardMakerMobileUnityService`.
6. Recreate the official print confirmation/progress/result flow with printer/network stubs.
7. Run a full-pack import with all official assets and record missing-resource diagnostics.

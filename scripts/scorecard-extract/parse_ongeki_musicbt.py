# Parse ANM_SWH_MusicBt.prefab (ONGEKI music-select score card, Unity 5.6 YAML) and dump
# the full tree with CSS-style rects relative to the PAT_DF_base 278x458 plate.
#
# PANEL ORIGIN: top-left corner of PAT_DF_base's 278x458 rect. PAT_DF_base sits at
#   NUL_main-local (0,0) with pivot (0.5,0.5), so in NUL_main space the plate occupies
#   x in [-139,139], y in [-229,229] (Unity Y-up).
#   css_left = unity_x_in_NUL_main + 139 ; css_top = 229 - unity_y_in_NUL_main
#   (computed generically: everything is resolved in root space first, then offset by
#   the plate's computed top-left; NUL chain offsets are all zero in this prefab.)
#
# Outputs: <output-dir>/ongeki_musicbt_tree.txt and ongeki_musicbt_tree.json.
# Requires a GUID cache built by ongeki_guid_index.py (built on demand by default).
import argparse
import json
import os
import re
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__ or "Parse the ONGEKI MusicBt prefab.")
    assets_env = os.environ.get("CARDVIEWER_ONGEKI_ASSETS")
    parser.add_argument(
        "--assets",
        type=Path,
        default=Path(assets_env) if assets_env else None,
        help="Unity ExportedProject/Assets directory (default: CARDVIEWER_ONGEKI_ASSETS).",
    )
    parser.add_argument(
        "--prefab",
        type=Path,
        help="MusicBt prefab path (default: GameObject/ANM_SWH_MusicBt.prefab under --assets).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=SCRIPT_DIR,
        help="Tree dump output directory (default: this script directory).",
    )
    parser.add_argument(
        "--guid-cache",
        type=Path,
        default=SCRIPT_DIR / "ongeki_guid_cache.json",
        help="GUID index cache path (default: next to this script).",
    )
    parser.add_argument(
        "--refresh-guid-cache",
        action="store_true",
        help="Rebuild the GUID cache from --assets before parsing.",
    )
    args = parser.parse_args()
    if args.assets is None:
        parser.error("--assets is required unless CARDVIEWER_ONGEKI_ASSETS is set")
    if args.prefab is None:
        args.prefab = args.assets / "GameObject/ANM_SWH_MusicBt.prefab"
    return args


ARGS = parse_args()
PREFAB = os.fspath(ARGS.prefab.resolve())
ASSETS = os.fspath(ARGS.assets.resolve())
OUT_DIR = os.fspath(ARGS.output_dir.resolve())
GUID_CACHE = os.fspath(ARGS.guid_cache.resolve())
os.makedirs(OUT_DIR, exist_ok=True)

PANEL_NAME = "PAT_DF_base"
PANEL_W, PANEL_H = 278.0, 458.0

import importlib.util
spec = importlib.util.spec_from_file_location("ongeki_guid_index", SCRIPT_DIR / "ongeki_guid_index.py")
gi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gi)
GUID_PATH = gi.load(ASSETS, GUID_CACHE, refresh=ARGS.refresh_guid_cache)  # guid -> relative asset path


def name_of(guid):
    if guid is None:
        return None
    p = GUID_PATH.get(guid)
    if p is None:
        return guid
    base = os.path.basename(p)
    for ext in (".asset", ".png", ".cs", ".ttf", ".otf", ".prefab"):
        if base.endswith(ext):
            base = base[: -len(ext)]
            break
    return base


UGUI_DLL_GUID = "f5f67c52d1564df4a8936ccd202a3bd8"
UGUI_FILEIDS = {-765806418: "UnityEngine.UI.Image", -900027084: "UnityEngine.UI.Shadow/Outline"}

TEXT_ANCHOR = {0: "UpperLeft", 1: "UpperCenter", 2: "UpperRight",
               3: "MiddleLeft", 4: "MiddleCenter", 5: "MiddleRight",
               6: "LowerLeft", 7: "LowerCenter", 8: "LowerRight"}
OVERFLOW_EX = {0: "None", 1: "Fit", 2: "Scroll"}
COUNTER_ALIGN = {0: "Center", 1: "Left", 2: "Right"}
IMAGE_TYPE = {0: "Simple", 1: "Sliced", 2: "Tiled", 3: "Filled"}
# MU3UICounterBase flag bits (Assets/Scripts/Assembly-CSharp/MU3/CustomUI/MU3UICounterBase.cs,
# properties isDispPlus/isDispCamma/ZeroPadding/isDecimal/... lines 128-335)
COUNTER_FLAGS = {1: "DispPlus", 2: "DispCamma", 4: "ZeroPadding", 8: "Decimal",
                 16: "DecimalZeroPadding", 32: "DecimalUseIntegerSpacing",
                 64: "ZeroPaddingOtherUV", 128: "EraseZeroSign", 256: "PaddingIncludeZero",
                 512: "UseUpper", 1024: "UpperUseIntegerSpacing"}


def flag_names(v):
    v = int(v)
    return [n for b, n in COUNTER_FLAGS.items() if v & b] or ["none"]


text = open(PREFAB, "r", encoding="utf-8", errors="replace").read()

doc_re = re.compile(r"^--- !u!(\d+) &(\d+)(?: stripped)?\s*$", re.M)
docs = []
matches = list(doc_re.finditer(text))
for i, m in enumerate(matches):
    end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
    docs.append((int(m.group(1)), int(m.group(2)), text[m.start():end]))


def get(body, field, default=None):
    m = re.search(r"^\s*%s: (.*)$" % re.escape(field), body, re.M)
    return m.group(1).strip() if m else default


def get_vec(body, field):
    m = re.search(r"^\s*%s: \{(.*?)\}" % re.escape(field), body, re.M)
    if not m:
        return None
    parts = dict(p.split(": ") for p in m.group(1).split(", "))
    return {k: float(v) for k, v in parts.items()}


def get_ref(body, field):
    m = re.search(r"^\s*%s: \{fileID: (-?\d+)(?:, guid: ([0-9a-f]+))?" % re.escape(field), body, re.M)
    if not m:
        return None
    return {"fileID": int(m.group(1)), "guid": m.group(2)}


def get_guid_list(body, field):
    m = re.search(r"^\s*%s:\n((?:\s*- \{[^\n]*\}\n)*)" % re.escape(field), body, re.M)
    if not m:
        return []
    out = []
    for lm in re.finditer(r"- \{fileID: (-?\d+)(?:, guid: ([0-9a-f]+))?", m.group(1)):
        out.append(lm.group(2))  # None for fileID: 0
    return out


gameobjects, recttfs, monos = {}, {}, {}
for classid, fid, body in docs:
    if classid == 1:
        comps = re.findall(r"- component: \{fileID: (\d+)\}", body)
        gameobjects[fid] = {"name": get(body, "m_Name"), "active": get(body, "m_IsActive") == "1",
                            "components": [int(c) for c in comps]}
    elif classid == 224:
        children = []
        if "m_Children:" in body:
            children = re.findall(r"- \{fileID: (\d+)\}", body.split("m_Children:")[1].split("m_Father:")[0])
        recttfs[fid] = {
            "go": get_ref(body, "m_GameObject")["fileID"],
            "children": [int(c) for c in children],
            "father": (get_ref(body, "m_Father") or {"fileID": 0})["fileID"],
            "anchoredPos": get_vec(body, "m_AnchoredPosition"),
            "sizeDelta": get_vec(body, "m_SizeDelta"),
            "anchorMin": get_vec(body, "m_AnchorMin"),
            "anchorMax": get_vec(body, "m_AnchorMax"),
            "pivot": get_vec(body, "m_Pivot"),
            "localScale": get_vec(body, "m_LocalScale"),
            "localRotation": get_vec(body, "m_LocalRotation"),
        }
    elif classid == 114:
        monos[fid] = {"go": (get_ref(body, "m_GameObject") or {"fileID": 0})["fileID"], "body": body}

# fileID (component or GO) -> GO fileID, for wiring resolution
comp_to_go = {fid: mi["go"] for fid, mi in monos.items()}
for fid, tf in recttfs.items():
    comp_to_go[fid] = tf["go"]
go_path = {}  # filled during walk


def ref_name(fid):
    if fid == 0:
        return None
    go = comp_to_go.get(fid, fid if fid in gameobjects else None)
    if go in go_path:
        return go_path[go]
    if go in gameobjects:
        return gameobjects[go]["name"]
    return "fileID:%d" % fid


# ---------- component summarizers ----------
def summarize_mono(body):
    script = get_ref(body, "m_Script")
    sguid = script["guid"] if script else None
    sfid = script["fileID"] if script else 0
    if sguid == UGUI_DLL_GUID:
        sname = UGUI_FILEIDS.get(sfid, "UnityEngine.UI (dll fileID %d)" % sfid)
    else:
        sname = name_of(sguid)
    c = {"script": sname}
    color = get_vec(body, "m_Color")

    if sname == "UnityEngine.UI.Image":
        spr = get_ref(body, "m_Sprite")
        c["type"] = "Image"
        c["sprite"] = name_of(spr["guid"]) if spr and spr["guid"] else None
        c["imageType"] = IMAGE_TYPE.get(int(get(body, "m_Type") or 0))
        c["preserveAspect"] = get(body, "m_PreserveAspect") == "1"
        c["color"] = color
        return c

    if sname == "UnityEngine.UI.Shadow/Outline":
        c["type"] = "Shadow/Outline"
        c["effectColor"] = get_vec(body, "m_EffectColor")
        c["effectDistance"] = get_vec(body, "m_EffectDistance")
        return c

    if sname == "MU3Text":
        font = get_ref(body, "m_Font")
        c["type"] = "MU3Text"
        c["text"] = get(body, "m_Text")
        c["font"] = name_of(font["guid"]) if font else None
        c["fontSize"] = int(get(body, "m_FontSize") or 0)
        c["alignment"] = TEXT_ANCHOR.get(int(get(body, "m_Alignment") or 0))
        c["alignByGeometry"] = get(body, "m_AlignByGeometry") == "1"
        c["color"] = color
        c["horizontalOverflowEx"] = OVERFLOW_EX.get(int(get(body, "_horizontalOverflowEx") or 0))
        c["scrollCharaSpace"] = float(get(body, "_scrollCharaSpace"))
        c["scrollWaitTime"] = float(get(body, "_scrollWaitTime"))
        c["scrollSpeed"] = float(get(body, "_scrollSpeed"))
        return c

    if sname == "MU3UICounter":
        c["type"] = "MU3UICounter"
        c["color"] = color
        spr = get_ref(body, "m_Sprite")
        c["sprite"] = name_of(spr["guid"]) if spr and spr["guid"] else None
        for f in ("align_", "spriteIndex_", "numDigits_", "charSpacing_", "cammaYOffset_",
                  "cammaSidePadding_", "flags_", "leftOffset_", "rightOffset_", "counter_",
                  "decimalNumDigits_", "decimalCharSpacing_", "decimalYOffset_",
                  "decimalDotYOffset_", "decimalDotSidePadding_", "enableUV1_", "noCrop_"):
            v = get(body, f)
            if v is not None:
                c[f] = float(v) if re.match(r"^-?[\d.]+$", v) else v
        for f in ("size_", "signSize_", "decimalScale_"):
            c[f] = get_vec(body, f)
        c["align_name"] = COUNTER_ALIGN.get(int(c.get("align_", 0)))
        c["flags_names"] = flag_names(c.get("flags_", 0))
        c["sprites_"] = [name_of(g) for g in get_guid_list(body, "sprites_")]
        ro = get_ref(body, "rightObject_")
        lo = get_ref(body, "leftObject_")
        c["rightObject"] = ref_name(ro["fileID"]) if ro else None
        c["leftObject"] = ref_name(lo["fileID"]) if lo else None
        return c

    if sname == "MU3UIImageChanger":
        c["type"] = "MU3UIImageChanger"
        c["_sprites"] = [name_of(g) for g in get_guid_list(body, "_sprites")]
        c["_patternNo"] = float(get(body, "_patternNo"))
        c["_setNativeSize"] = get(body, "_setNativeSize") == "1"
        tg = get_ref(body, "_targetGraphic")
        c["_targetGraphic_fileID"] = tg["fileID"] if tg else 0
        return c

    # root controller / anything else: dump every "field: {fileID: N}" reference
    c["type"] = sname or "?"
    wiring = {}
    for lm in re.finditer(r"^\s*(\w+): \{fileID: (-?\d+)(?:, guid: ([0-9a-f]+))?", body, re.M):
        fld, fid, g = lm.group(1), int(lm.group(2)), lm.group(3)
        if fld in ("m_GameObject", "m_Script", "m_PrefabParentObject", "m_PrefabInternal",
                   "m_Icon", "m_Material"):
            continue
        wiring[fld] = name_of(g) if g else ref_name(fid)
    if wiring:
        c["wiring"] = wiring
    return c


# ---------- walk (general anchors incl. stretch) ----------
root_tf = None
panel_tf = None
for fid, tf in recttfs.items():
    if tf["father"] not in recttfs:
        root_tf = fid
    if gameobjects[tf["go"]]["name"] == PANEL_NAME and panel_tf is None:
        panel_tf = fid
assert root_tf and panel_tf, "root/panel not found"

nodes = []
node_by_tf = {}


def walk(tf_id, parent_size, parent_center, path, depth, inherited_scale):
    """parent_center: (x,y) center of parent rect in root space (Unity Y-up).
    inherited_scale: cumulative parent scale (sx, sy) -- positions/sizes are kept
    in unscaled design px; scale is reported per node."""
    tf = recttfs[tf_id]
    go = gameobjects[tf["go"]]
    go_path[tf["go"]] = path
    am, ax, piv = tf["anchorMin"], tf["anchorMax"], tf["pivot"]
    ap, sd, sc = tf["anchoredPos"], tf["sizeDelta"], tf["localScale"]
    pw, ph = parent_size
    w = sd["x"] + (ax["x"] - am["x"]) * pw
    h = sd["y"] + (ax["y"] - am["y"]) * ph
    # pivot point in root space: anchor ref + anchoredPosition
    px = parent_center[0] + (am["x"] + piv["x"] * (ax["x"] - am["x"]) - 0.5) * pw + ap["x"]
    py = parent_center[1] + (am["y"] + piv["y"] * (ax["y"] - am["y"]) - 0.5) * ph + ap["y"]
    left_u = px - piv["x"] * w
    top_u = py + (1 - piv["y"]) * h
    node = {
        "path": path, "name": go["name"], "active": go["active"], "depth": depth,
        "unity_root": {"pivot_x": px, "pivot_y": py, "left": left_u, "top": top_u, "w": w, "h": h},
        "anchoredPos": [ap["x"], ap["y"]], "sizeDelta": [sd["x"], sd["y"]],
        "anchorMin": [am["x"], am["y"]], "anchorMax": [ax["x"], ax["y"]],
        "pivot": [piv["x"], piv["y"]], "scale": [sc["x"], sc["y"]],
        "components_tf": tf_id,
        "go_components": go["components"],
    }
    eff_sx = inherited_scale[0] * sc["x"]
    eff_sy = inherited_scale[1] * sc["y"]
    if (eff_sx, eff_sy) != (1.0, 1.0):
        node["effective_scale"] = [eff_sx, eff_sy]
        # visual rect scaled about this node's pivot with the effective scale
        vleft = px - piv["x"] * w * eff_sx
        vtop = py + (1 - piv["y"]) * h * eff_sy
        node["unity_root_scaled"] = {"left": vleft, "top": vtop, "w": w * eff_sx, "h": h * eff_sy}
    rot = tf["localRotation"]
    if rot and (abs(rot["x"]) > 1e-6 or abs(rot["y"]) > 1e-6 or abs(rot["z"]) > 1e-6):
        node["rotation_quat"] = [rot["x"], rot["y"], rot["z"], rot["w"]]
    nodes.append(node)
    node_by_tf[tf_id] = node
    for ch in tf["children"]:
        if ch in recttfs:
            walk(ch, (w, h), (px + (0.5 - piv["x"]) * w, py + (0.5 - piv["y"]) * h),
                 path + "/" + gameobjects[recttfs[ch]["go"]]["name"], depth + 1, (eff_sx, eff_sy))


walk(root_tf, (100.0, 100.0), (0.0, 0.0), gameobjects[recttfs[root_tf]["go"]]["name"], 0, (1.0, 1.0))

# panel top-left in root space -> css conversion
pn = node_by_tf[panel_tf]["unity_root"]
assert abs(pn["w"] - PANEL_W) < 1e-3 and abs(pn["h"] - PANEL_H) < 1e-3, \
    "panel size mismatch: %sx%s" % (pn["w"], pn["h"])
p_left, p_top = pn["left"], pn["top"]

for n in nodes:
    u = n.pop("unity_root")
    n["css"] = {"left": round(u["left"] - p_left, 3), "top": round(p_top - u["top"], 3),
                "width": round(u["w"], 3), "height": round(u["h"], 3)}
    if "unity_root_scaled" in n:
        s = n.pop("unity_root_scaled")
        n["css_scaled"] = {"left": round(s["left"] - p_left, 3), "top": round(p_top - s["top"], 3),
                           "width": round(s["w"], 3), "height": round(s["h"], 3)}

# summarize components now that go_path is complete (ref_name gives full paths)
for n in nodes:
    n["components"] = [summarize_mono(monos[cid]["body"]) for cid in n.pop("go_components") if cid in monos]
    n.pop("components_tf")

meta = {
    "prefab": PREFAB,
    "panel": PANEL_NAME,
    "panel_size": [PANEL_W, PANEL_H],
    "origin": "CSS origin = top-left of the PAT_DF_base 278x458 difficulty plate "
              "(PAT_DF_base center is at NUL_main-local (0,0); css_left = unity_x+139, "
              "css_top = 229-unity_y). Sizes are unscaled design px; nodes with scale "
              "carry css_scaled for the rendered rect.",
    "counter_flag_bits": COUNTER_FLAGS,
    "nodes": nodes,
}
json.dump(meta, open(os.path.join(OUT_DIR, "ongeki_musicbt_tree.json"), "w"), indent=1)

with open(os.path.join(OUT_DIR, "ongeki_musicbt_tree.txt"), "w", encoding="utf-8") as f:
    f.write("panel origin: %s\n\n" % meta["origin"])
    for n in nodes:
        pad = "  " * n["depth"]
        flags = "" if n["active"] else " [INACTIVE]"
        sc = "" if n["scale"] == [1.0, 1.0] else " scale=%s" % n["scale"]
        rot = ""
        if "rotation_quat" in n:
            import math
            q = n["rotation_quat"]
            deg = math.degrees(2 * math.atan2(q[2], q[3]))
            rot = " rotZ=%.1fdeg(unity CCW; css rotate(%.1fdeg))" % (deg, -deg)
        f.write("%s%s%s  css(l=%s t=%s w=%s h=%s)  anch=%s piv=%s aPos=%s%s%s\n" % (
            pad, n["name"], flags, n["css"]["left"], n["css"]["top"], n["css"]["width"], n["css"]["height"],
            n["anchorMin"], n["pivot"], n["anchoredPos"], sc, rot))
        if "css_scaled" in n:
            f.write("%s   [rendered w/ scale: l=%s t=%s w=%s h=%s]\n" % (
                pad, n["css_scaled"]["left"], n["css_scaled"]["top"],
                n["css_scaled"]["width"], n["css_scaled"]["height"]))
        for c in n["components"]:
            t = c.get("type")
            if t == "Image":
                col = c["color"]
                f.write("%s   <Image sprite=%s type=%s preserveAspect=%s color=(%.3f,%.3f,%.3f,%.3f)>\n" % (
                    pad, c["sprite"], c["imageType"], c["preserveAspect"],
                    col["r"], col["g"], col["b"], col["a"]))
            elif t == "Shadow/Outline":
                ec, ed = c["effectColor"], c["effectDistance"]
                f.write("%s   <Shadow/Outline color=(%.3f,%.3f,%.3f,%.3f) dist=(%s,%s)>\n" % (
                    pad, ec["r"], ec["g"], ec["b"], ec["a"], ed["x"], ed["y"]))
            elif t == "MU3Text":
                col = c["color"]
                f.write("%s   <MU3Text %r font=%s size=%s align=%s color=(%.3f,%.3f,%.3f,%.3f) "
                        "overflowEx=%s scroll(space=%s wait=%s speed=%s)>\n" % (
                            pad, (c["text"] or "")[:40], c["font"], c["fontSize"], c["alignment"],
                            col["r"], col["g"], col["b"], col["a"], c["horizontalOverflowEx"],
                            c["scrollCharaSpace"], c["scrollWaitTime"], c["scrollSpeed"]))
            elif t == "MU3UICounter":
                col = c["color"]
                f.write("%s   <MU3UICounter sprites=%s align=%s size_=%s signSize_=%s numDigits=%s "
                        "charSpacing=%s flags=%s(%s) counter=%s decimals(n=%s spacing=%s scale=%s) "
                        "camma(y=%s pad=%s) rightObj=%s rightOffset=%s color=(%.3f,%.3f,%.3f,%.3f)>\n" % (
                            pad, c["sprites_"], c["align_name"], c["size_"], c["signSize_"],
                            c.get("numDigits_"), c.get("charSpacing_"), c.get("flags_"),
                            "+".join(c["flags_names"]), c.get("counter_"),
                            c.get("decimalNumDigits_"), c.get("decimalCharSpacing_"), c.get("decimalScale_"),
                            c.get("cammaYOffset_"), c.get("cammaSidePadding_"),
                            c.get("rightObject"), c.get("rightOffset_"),
                            col["r"], col["g"], col["b"], col["a"]))
            elif t == "MU3UIImageChanger":
                f.write("%s   <MU3UIImageChanger sprites=%s patternNo=%s setNativeSize=%s>\n" % (
                    pad, c["_sprites"], c["_patternNo"], c["_setNativeSize"]))
            else:
                f.write("%s   <%s%s>\n" % (pad, t, (" wiring=" + json.dumps(c["wiring"], ensure_ascii=False))
                                           if "wiring" in c else ""))

print("nodes:", len(nodes))
unresolved = set()
for fid, mi in monos.items():
    for g in re.findall(r"guid: ([0-9a-f]{32})", mi["body"]):
        if g not in GUID_PATH and g != UGUI_DLL_GUID:
            unresolved.add(g)
print("unresolved guids:", sorted(unresolved))

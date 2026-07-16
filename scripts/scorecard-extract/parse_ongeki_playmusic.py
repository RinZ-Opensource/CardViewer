# Parse ANM_PLY_PlayMusic_00.prefab (ONGEKI, Unity 5.6 YAML) and dump the full tree
# with CSS-style rects relative to the PAT_diff_base panel rect.
#
# PANEL ORIGIN: top-left corner of PAT_diff_base's serialized 310x162 rect.
#   PAT_diff_base has pivot (1,1) and anchoredPosition (180.1, 74) inside
#   NUL_PLY_PlayMusic_00, so in NUL-local space the panel occupies
#   x in [-129.9, 180.1], y in [-88, 74] (Unity Y-up).
#   css_left = unity_x + 129.9 ; css_top = 74 - unity_y
#   When the ANM root sits at the center of a 1080x1920 canvas the panel's
#   canvas-CSS position is left=770.1, top=0 (NUL localPosition = 360,886).
#
# Outputs: <output-dir>/ongeki_playmusic_tree.txt and ongeki_playmusic_tree.json.
import argparse
import json
import os
import re
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__ or "Parse the ONGEKI PlayMusic prefab.")
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
        help="PlayMusic prefab path (default: GameObject/ANM_PLY_PlayMusic_00.prefab under --assets).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=SCRIPT_DIR,
        help="Tree dump output directory (default: this script directory).",
    )
    args = parser.parse_args()
    if args.assets is None:
        parser.error("--assets is required unless CARDVIEWER_ONGEKI_ASSETS is set")
    if args.prefab is None:
        args.prefab = args.assets / "GameObject/ANM_PLY_PlayMusic_00.prefab"
    return args


ARGS = parse_args()
PREFAB = os.fspath(ARGS.prefab.resolve())
ASSETS = os.fspath(ARGS.assets.resolve())
OUT_DIR = os.fspath(ARGS.output_dir.resolve())
os.makedirs(OUT_DIR, exist_ok=True)

PANEL_NAME = "PAT_diff_base"
PANEL_W, PANEL_H = 310.0, 162.0

# well-known script guids in this project (Assembly-CSharp .cs.meta)
SCRIPT_GUIDS = {
    "163f4fceeff7cfa938c7531fab972764": "ANM_PLY_PlayMusic_00",
    "59b03a70e87fd0773f344a2c7bdcfb08": "MU3UIImageChanger",
    "30fc8d9980392149971bc720cc3d00b6": "MU3Text",
    "b2864c35c30e34c3b5bb4e9dafb6b774": "MU3UICounter",
    "f5f67c52d1564df4a8936ccd202a3bd8": "UnityEngine.UI.Image (dll)",
}

TEXT_ANCHOR = {0: "UpperLeft", 1: "UpperCenter", 2: "UpperRight",
               3: "MiddleLeft", 4: "MiddleCenter", 5: "MiddleRight",
               6: "LowerLeft", 7: "LowerCenter", 8: "LowerRight"}
OVERFLOW_EX = {0: "None", 1: "Fit", 2: "Scroll"}
COUNTER_ALIGN = {0: "Center", 1: "Left", 2: "Right"}
IMAGE_TYPE = {0: "Simple", 1: "Sliced", 2: "Tiled", 3: "Filled"}

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
    """list entries like: - {fileID: 21300000, guid: xxxx, type: 2} under `field:`"""
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
        }
    elif classid == 114:
        monos[fid] = {"go": (get_ref(body, "m_GameObject") or {"fileID": 0})["fileID"], "body": body}

# ---------- guid -> asset name (scan targeted dirs' .meta) ----------
used_guids = set()
for fid, mi in monos.items():
    for g in re.findall(r"guid: ([0-9a-f]{32})", mi["body"]):
        used_guids.add(g)

guid_to_name = dict(SCRIPT_GUIDS)


def scan_meta_dir(root):
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            if not fn.endswith(".meta"):
                continue
            try:
                head = open(os.path.join(dirpath, fn), "r", encoding="utf-8", errors="replace").read(200)
            except OSError:
                continue
            m = re.search(r"guid: ([0-9a-f]{32})", head)
            if m and m.group(1) in used_guids and m.group(1) not in guid_to_name:
                guid_to_name[m.group(1)] = fn[:-5].replace(".asset", "").replace(".png", "")


for sub in ("Sprite", "Font"):
    scan_meta_dir(os.path.join(ASSETS, sub))


def name_of(guid):
    if guid is None:
        return None
    return guid_to_name.get(guid, guid)


# ---------- component summarizers ----------
def summarize_mono(body):
    script = get_ref(body, "m_Script")
    sguid = script["guid"] if script else None
    sname = SCRIPT_GUIDS.get(sguid, sguid)
    c = {"script": sname}
    color = get_vec(body, "m_Color")

    if sname == "UnityEngine.UI.Image (dll)":
        spr = get_ref(body, "m_Sprite")
        c["type"] = "Image"
        c["sprite"] = name_of(spr["guid"]) if spr and spr["guid"] else None
        c["imageType"] = IMAGE_TYPE.get(int(get(body, "m_Type") or 0))
        c["color"] = color
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
        # verbatim serialized fields
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
        c["sprites_"] = [name_of(g) for g in get_guid_list(body, "sprites_")]
        ro = get_ref(body, "rightObject_")
        lo = get_ref(body, "leftObject_")
        c["rightObject_fileID"] = ro["fileID"] if ro else 0
        c["leftObject_fileID"] = lo["fileID"] if lo else 0
        return c

    if sname == "MU3UIImageChanger":
        c["type"] = "MU3UIImageChanger"
        c["_sprites"] = [name_of(g) for g in get_guid_list(body, "_sprites")]
        c["_patternNo"] = float(get(body, "_patternNo"))
        c["_setNativeSize"] = get(body, "_setNativeSize") == "1"
        tg = get_ref(body, "_targetGraphic")
        c["_targetGraphic_fileID"] = tg["fileID"] if tg else 0
        return c

    if sname == "ANM_PLY_PlayMusic_00":
        c["type"] = "ANM_PLY_PlayMusic_00"
        c["wiring"] = {k: (get_ref(body, k) or {"fileID": 0})["fileID"] for k in (
            "_diffcultyImageChanger", "_jacketImage", "_musicLevelCounter", "_musicLevelPlusObject",
            "_musicNameText", "_artistNameText", "_optionSpeedText", "_optionMirrorImageChanger",
            "_secretMusicInfoObject")}
        return c

    c["type"] = sname or "?"
    return c


# ---------- locate panel & compute its NUL-local rect ----------
panel_tf = None
for fid, tf in recttfs.items():
    if gameobjects[tf["go"]]["name"] == PANEL_NAME:
        panel_tf = fid
        break
assert panel_tf, "panel not found"
ptf = recttfs[panel_tf]
# pivot(1,1): top-right corner = anchoredPos (in NUL space, since anchors are point 0.5/0.5
# on a 100x100 parent -> anchor ref = parent center = NUL origin)
p_right = ptf["anchoredPos"]["x"]
p_top = ptf["anchoredPos"]["y"]
p_left = p_right - PANEL_W    # -129.9
p_bottom = p_top - PANEL_H    # -88

root_tf = panel_tf
while recttfs[root_tf]["father"] in recttfs:
    root_tf = recttfs[root_tf]["father"]

nodes = []


def walk(tf_id, parent_size, parent_origin_unity, path, depth):
    """parent_origin_unity: (x,y) of the parent rect's CENTER in NUL-local space.
    All rects here use anchorMin==anchorMax (point anchors), verified below."""
    tf = recttfs[tf_id]
    go = gameobjects[tf["go"]]
    am, ax, piv = tf["anchorMin"], tf["anchorMax"], tf["pivot"]
    ap, sd, sc = tf["anchoredPos"], tf["sizeDelta"], tf["localScale"]
    pw, ph = parent_size
    assert abs(am["x"] - ax["x"]) < 1e-6 and abs(am["y"] - ax["y"]) < 1e-6, "stretch anchors not handled"
    w = sd["x"]
    h = sd["y"]
    # pivot point in parent space (parent origin = center)
    px = parent_origin_unity[0] + (am["x"] - 0.5) * pw + ap["x"]
    py = parent_origin_unity[1] + (am["y"] - 0.5) * ph + ap["y"]
    # unscaled rect
    left_u = px - piv["x"] * w
    top_u = py + (1 - piv["y"]) * h
    # visual (scaled) rect: scale about pivot
    vw, vh = w * sc["x"], h * sc["y"]
    vleft_u = px - piv["x"] * vw
    vtop_u = py + (1 - piv["y"]) * vh

    css = {
        "left": round(left_u - p_left, 3), "top": round(p_top - top_u, 3),
        "width": round(w, 3), "height": round(h, 3),
    }
    node = {
        "path": path, "name": go["name"], "active": go["active"], "depth": depth,
        "css": css,
        "anchoredPos": [ap["x"], ap["y"]], "sizeDelta": [sd["x"], sd["y"]],
        "anchorMin": [am["x"], am["y"]], "anchorMax": [ax["x"], ax["y"]],
        "pivot": [piv["x"], piv["y"]], "scale": [sc["x"], sc["y"]],
        "components": [summarize_mono(monos[cid]["body"]) for cid in go["components"] if cid in monos],
    }
    if sc["x"] != 1 or sc["y"] != 1:
        node["css_scaled"] = {"left": round(vleft_u - p_left, 3), "top": round(p_top - vtop_u, 3),
                              "width": round(vw, 3), "height": round(vh, 3)}
    nodes.append(node)
    for ch in tf["children"]:
        if ch in recttfs:
            walk(ch, (w, h), (px + (0.5 - piv["x"]) * w, py + (0.5 - piv["y"]) * h),
                 path + "/" + gameobjects[recttfs[ch]["go"]]["name"], depth + 1)


# start at root; root's parent-space center defined so NUL ends up at origin.
# root anchoredPos (0,0), NUL localPosition (360,886) -> shift root origin by -(360,886)
walk(root_tf, (100.0, 100.0), (-360.0, -886.0), gameobjects[recttfs[root_tf]["go"]]["name"], 0)

meta = {
    "prefab": PREFAB,
    "panel": PANEL_NAME,
    "panel_size": [PANEL_W, PANEL_H],
    "origin": "top-left of PAT_diff_base 310x162 rect (pivot(1,1) anchored at NUL-local (180.1,74)); "
              "canvas-CSS left=770.1 top=0 when root is centered on a 1080x1920 canvas",
    "nodes": nodes,
}
json.dump(meta, open(os.path.join(OUT_DIR, "ongeki_playmusic_tree.json"), "w"), indent=1)

with open(os.path.join(OUT_DIR, "ongeki_playmusic_tree.txt"), "w", encoding="utf-8") as f:
    f.write("panel origin: %s\n\n" % meta["origin"])
    for n in nodes:
        pad = "  " * n["depth"]
        flags = "" if n["active"] else " [INACTIVE]"
        sc = "" if n["scale"] == [1.0, 1.0] else " scale=%s" % n["scale"]
        f.write("%s%s%s  css(l=%s t=%s w=%s h=%s)  anch=%s piv=%s aPos=%s%s\n" % (
            pad, n["name"], flags, n["css"]["left"], n["css"]["top"], n["css"]["width"], n["css"]["height"],
            n["anchorMin"], n["pivot"], n["anchoredPos"], sc))
        if "css_scaled" in n:
            f.write("%s   [rendered w/ scale: l=%(left)s t=%(top)s w=%(width)s h=%(height)s]\n"
                    % dict({"0": pad}, **n["css_scaled"]) if False else
                    "%s   [rendered w/ scale: l=%s t=%s w=%s h=%s]\n" % (
                        pad, n["css_scaled"]["left"], n["css_scaled"]["top"],
                        n["css_scaled"]["width"], n["css_scaled"]["height"]))
        for c in n["components"]:
            t = c.get("type")
            if t == "Image":
                col = c["color"]
                f.write("%s   <Image sprite=%s type=%s color=(%.3f,%.3f,%.3f,%.3f)>\n" % (
                    pad, c["sprite"], c["imageType"], col["r"], col["g"], col["b"], col["a"]))
            elif t == "MU3Text":
                col = c["color"]
                f.write("%s   <MU3Text %r font=%s size=%s align=%s color=(%.3f,%.3f,%.3f,%.3f) "
                        "overflowEx=%s scroll(space=%s wait=%s speed=%s)>\n" % (
                            pad, (c["text"] or "")[:30], c["font"], c["fontSize"], c["alignment"],
                            col["r"], col["g"], col["b"], col["a"], c["horizontalOverflowEx"],
                            c["scrollCharaSpace"], c["scrollWaitTime"], c["scrollSpeed"]))
            elif t == "MU3UICounter":
                col = c["color"]
                f.write("%s   <MU3UICounter sprites=%s align=%s size_=%s signSize_=%s numDigits=%s "
                        "charSpacing=%s flags=%s counter=%s rightObj=%s rightOffset=%s "
                        "color=(%.3f,%.3f,%.3f,%.3f)>\n" % (
                            pad, c["sprites_"], c["align_name"], c["size_"], c["signSize_"],
                            c.get("numDigits_"), c.get("charSpacing_"), c.get("flags_"), c.get("counter_"),
                            c["rightObject_fileID"], c.get("rightOffset_"),
                            col["r"], col["g"], col["b"], col["a"]))
            elif t == "MU3UIImageChanger":
                f.write("%s   <MU3UIImageChanger sprites=%s patternNo=%s setNativeSize=%s>\n" % (
                    pad, c["_sprites"], c["_patternNo"], c["_setNativeSize"]))
            elif t == "ANM_PLY_PlayMusic_00":
                f.write("%s   <ANM_PLY_PlayMusic_00 wiring=%s>\n" % (pad, c["wiring"]))
            else:
                f.write("%s   <%s>\n" % (pad, t))

print("nodes:", len(nodes))
print("unresolved guids:", sorted(g for g in used_guids if g not in guid_to_name))

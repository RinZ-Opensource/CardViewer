# Parse TrackStartProcess.prefab (Unity YAML) and dump the MusicBase subtree
# with computed CSS-style rects (left/top from parent top-left), sprites, text.
import argparse
import re, json, os
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__ or "Parse the maimai TrackStart MusicBase subtree.")
    assets_env = os.environ.get("CARDVIEWER_MAIMAI_ASSETS")
    parser.add_argument(
        "--assets",
        type=Path,
        default=Path(assets_env) if assets_env else None,
        help="Unity ExportedProject/Assets directory (default: CARDVIEWER_MAIMAI_ASSETS).",
    )
    parser.add_argument(
        "--prefab",
        type=Path,
        help="TrackStart prefab path (default: Resources/process/trackstart/TrackStartProcess.prefab under --assets).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=SCRIPT_DIR,
        help="Tree dump output directory (default: this script directory).",
    )
    args = parser.parse_args()
    if args.assets is None:
        parser.error("--assets is required unless CARDVIEWER_MAIMAI_ASSETS is set")
    if args.prefab is None:
        args.prefab = args.assets / "Resources/process/trackstart/TrackStartProcess.prefab"
    return args


ARGS = parse_args()
PREFAB = os.fspath(ARGS.prefab.resolve())
ASSETS = os.fspath(ARGS.assets.resolve())
OUT_DIR = os.fspath(ARGS.output_dir.resolve())
os.makedirs(OUT_DIR, exist_ok=True)

text = open(PREFAB, "r", encoding="utf-8", errors="replace").read()

# --- split into documents ---
doc_re = re.compile(r"^--- !u!(\d+) &(\d+)(?: stripped)?\s*$", re.M)
docs = []  # (classid, fileid, body)
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

gameobjects = {}   # fileid -> {name, active, components:[fileids]}
recttfs = {}       # fileid -> {...}
monos = {}         # fileid -> {...}

for classid, fid, body in docs:
    if classid == 1:  # GameObject
        comps = re.findall(r"- component: \{fileID: (\d+)\}", body)
        gameobjects[fid] = {
            "name": get(body, "m_Name"),
            "active": get(body, "m_IsActive") == "1",
            "components": [int(c) for c in comps],
        }
    elif classid == 224:  # RectTransform
        children = re.findall(r"- \{fileID: (\d+)\}", body.split("m_Children:")[1].split("m_Father:")[0]) if "m_Children:" in body else []
        recttfs[fid] = {
            "go": get_ref(body, "m_GameObject")["fileID"],
            "children": [int(c) for c in children],
            "father": get_ref(body, "m_Father")["fileID"] if get_ref(body, "m_Father") else 0,
            "anchoredPos": get_vec(body, "m_AnchoredPosition"),
            "sizeDelta": get_vec(body, "m_SizeDelta"),
            "anchorMin": get_vec(body, "m_AnchorMin"),
            "anchorMax": get_vec(body, "m_AnchorMax"),
            "pivot": get_vec(body, "m_Pivot"),
            "localScale": get_vec(body, "m_LocalScale"),
            "localRot": get_vec(body, "m_LocalRotation"),
        }
    elif classid == 114:  # MonoBehaviour
        go = get_ref(body, "m_GameObject")
        script = get_ref(body, "m_Script")
        info = {
            "go": go["fileID"] if go else 0,
            "script_guid": script["guid"] if script else None,
            "enabled": get(body, "m_Enabled") == "1",
        }
        spr = get_ref(body, "m_Sprite")
        if spr and spr["guid"]:
            info["sprite_guid"] = spr["guid"]
        color = get_vec(body, "m_Color")
        if color:
            info["color"] = color
        imgtype = get(body, "m_Type")
        if imgtype is not None and spr is not None:
            info["image_type"] = imgtype
        # TMP fields
        txt = re.search(r'^\s*m_text:\s*(.*)$', body, re.M)
        if txt and "m_fontAsset" in body:
            info["tmp_text"] = txt.group(1).strip()
            info["fontSize"] = get(body, "m_fontSize")
            info["fontSizeBase"] = get(body, "m_fontSizeBase")
            info["autoSize"] = get(body, "m_enableAutoSizing")
            info["fontSizeMin"] = get(body, "m_fontSizeMin")
            info["fontSizeMax"] = get(body, "m_fontSizeMax")
            fc = get_vec(body, "m_fontColor")
            if fc:
                info["fontColor"] = fc
            info["alignment"] = get(body, "m_textAlignment") or get(body, "m_HorizontalAlignment")
            fa = get_ref(body, "m_fontAsset")
            if fa:
                info["fontAsset_guid"] = fa["guid"]
            info["charSpacing"] = get(body, "m_characterSpacing")
            info["wordSpacing"] = get(body, "m_wordSpacing")
            info["fontStyle"] = get(body, "m_fontStyle")
            grad = get(body, "m_enableVertexGradient")
            if grad == "1":
                info["vertexGradient"] = {
                    "topLeft": get_vec(body, "topLeft"),
                    "bottomLeft": get_vec(body, "bottomLeft"),
                }
            ol = get_vec(body, "m_outlineColor") if "m_outlineColor" in body else None
        # keep raw body for interesting custom scripts (small ones)
        if len(body) < 4000:
            info["_body"] = body
        monos[fid] = info

go_by_tf = {tf["go"]: fid for fid, tf in recttfs.items()}

# --- find MusicBase ---
music_base_go = None
for fid, go in gameobjects.items():
    if go["name"] == "MusicBase":
        music_base_go = fid
        break
assert music_base_go, "MusicBase not found"
mb_tf = None
for fid, tf in recttfs.items():
    if tf["go"] == music_base_go:
        mb_tf = fid
        break

# --- walk subtree, compute rects ---
used_guids = set()
nodes = []

def walk(tf_id, parent_size, path, depth, inherited_scale):
    tf = recttfs[tf_id]
    go = gameobjects[tf["go"]]
    am, ax, piv = tf["anchorMin"], tf["anchorMax"], tf["pivot"]
    ap, sd, sc = tf["anchoredPos"], tf["sizeDelta"], tf["localScale"]
    pw, ph = parent_size
    w = (ax["x"] - am["x"]) * pw + sd["x"]
    h = (ax["y"] - am["y"]) * ph + sd["y"]
    # pivot position in parent space (origin bottom-left of parent rect)
    ref_x = (am["x"] + (ax["x"] - am["x"]) * piv["x"]) * pw
    ref_y = (am["y"] + (ax["y"] - am["y"]) * piv["y"]) * ph
    px = ref_x + ap["x"]
    py = ref_y + ap["y"]
    left = px - piv["x"] * w
    bottom = py - piv["y"] * h
    top = ph - (bottom + h)  # CSS top within parent

    comps = []
    for cid in go["components"]:
        if cid in monos:
            mi = monos[cid]
            c = {k: v for k, v in mi.items() if k not in ("_body", "go")}
            if "sprite_guid" in mi:
                used_guids.add(mi["sprite_guid"])
            if mi.get("fontAsset_guid"):
                used_guids.add(mi["fontAsset_guid"])
            if mi.get("script_guid"):
                used_guids.add(mi["script_guid"])
            comps.append(c)

    node = {
        "path": path,
        "name": go["name"],
        "active": go["active"],
        "depth": depth,
        "size": [round(w, 2), round(h, 2)],
        "left": round(left, 2),
        "top": round(top, 2),
        "anchoredPos": [ap["x"], ap["y"]],
        "sizeDelta": [sd["x"], sd["y"]],
        "anchorMin": [am["x"], am["y"]],
        "anchorMax": [ax["x"], ax["y"]],
        "pivot": [piv["x"], piv["y"]],
        "scale": [sc["x"], sc["y"]],
        "components": comps,
    }
    if tf["localRot"] and abs(tf["localRot"].get("z", 0)) > 1e-6:
        node["rotZ"] = tf["localRot"]
    nodes.append(node)
    for ch in tf["children"]:
        if ch in recttfs:
            ctf = recttfs[ch]
            cgo = gameobjects[ctf["go"]]
            walk(ch, (w, h), path + "/" + cgo["name"], depth + 1,
                 (inherited_scale[0] * sc["x"], inherited_scale[1] * sc["y"]))

# parent size of MusicBase: find its father chain up to canvas for reference
father = recttfs[mb_tf]["father"]
fsize = (1080, 1920)
if father in recttfs:
    # compute father's size crudely by walking up assuming stretch=canvas 1080x1920
    chain = []
    f = father
    while f in recttfs:
        chain.append(f)
        f = recttfs[f]["father"]
    # assume root canvas 1080x1920, compute down
    size = (1080.0, 1920.0)
    for f in reversed(chain):
        tf = recttfs[f]
        am, ax, sd = tf["anchorMin"], tf["anchorMax"], tf["sizeDelta"]
        w = (ax["x"] - am["x"]) * size[0] + sd["x"]
        h = (ax["y"] - am["y"]) * size[1] + sd["y"]
        size = (w, h)
    fsize = size

walk(mb_tf, fsize, "MusicBase", 0, (1.0, 1.0))

# --- resolve guids -> asset names via .meta scan (targeted dirs first) ---
guid_to_path = {}
def scan_meta_dir(root):
    for dirpath, dirnames, filenames in os.walk(root):
        for fn in filenames:
            if not fn.endswith(".meta"):
                continue
            p = os.path.join(dirpath, fn)
            try:
                head = open(p, "r", encoding="utf-8", errors="replace").read(300)
            except OSError:
                continue
            m = re.search(r"guid: ([0-9a-f]{32})", head)
            if m and m.group(1) in used_guids and m.group(1) not in guid_to_path:
                guid_to_path[m.group(1)] = os.path.relpath(p, ASSETS)[:-5]

for sub in ["Resources/process/trackstart/sprites", "Resources/common", "Sprite",
            "Resources/parts", "Scripts", "Font", "Resources/fonts & materials", "MonoBehaviour"]:
    d = os.path.join(ASSETS, sub)
    if os.path.isdir(d) and len(guid_to_path) < len(used_guids):
        scan_meta_dir(d)
missing = used_guids - set(guid_to_path)
if missing:
    scan_meta_dir(ASSETS)

# annotate nodes
for n in nodes:
    for c in n["components"]:
        for key in ("sprite_guid", "fontAsset_guid", "script_guid"):
            if key in c and c[key] in guid_to_path:
                c[key.replace("_guid", "")] = os.path.basename(guid_to_path[c[key]])

json.dump(nodes, open(os.path.join(OUT_DIR, "musicbase_dump.json"), "w"), indent=1)

# readable tree
with open(os.path.join(OUT_DIR, "musicbase_tree.txt"), "w", encoding="utf-8") as f:
    for n in nodes:
        pad = "  " * n["depth"]
        flags = "" if n["active"] else " [INACTIVE]"
        sc = "" if n["scale"] == [1.0, 1.0] else " scale=%s" % n["scale"]
        f.write("%s%s%s  size=%sx%s  left=%s top=%s  anch=%s/%s piv=%s aPos=%s%s\n" % (
            pad, n["name"], flags, n["size"][0], n["size"][1], n["left"], n["top"],
            n["anchorMin"], n["anchorMax"], n["pivot"], n["anchoredPos"], sc))
        for c in n["components"]:
            bits = []
            if "sprite" in c: bits.append("sprite=" + c["sprite"])
            elif "sprite_guid" in c: bits.append("sprite_guid=" + c["sprite_guid"])
            if "image_type" in c: bits.append("imgType=" + str(c["image_type"]))
            if "color" in c and c["color"] != {"r":1,"g":1,"b":1,"a":1}:
                bits.append("color=(%.3f,%.3f,%.3f,%.3f)" % (c["color"]["r"],c["color"]["g"],c["color"]["b"],c["color"]["a"]))
            if "tmp_text" in c:
                bits.append("text=%r size=%s auto=%s(min%s,max%s) align=%s font=%s spacing=%s style=%s" % (
                    c["tmp_text"][:40], c["fontSize"], c.get("autoSize"), c.get("fontSizeMin"), c.get("fontSizeMax"),
                    c.get("alignment"), c.get("fontAsset", c.get("fontAsset_guid")), c.get("charSpacing"), c.get("fontStyle")))
                if "fontColor" in c:
                    fc = c["fontColor"]
                    bits.append("fontColor=(%.3f,%.3f,%.3f,%.3f)" % (fc["r"],fc["g"],fc["b"],fc["a"]))
                if "vertexGradient" in c and c["vertexGradient"]["topLeft"]:
                    bits.append("gradient")
            if "script" in c and "sprite" not in c and "tmp_text" not in c:
                bits.append("script=" + c["script"])
            elif "script_guid" in c and not bits:
                bits.append("script_guid=" + c["script_guid"])
            if bits:
                f.write("%s   <%s>\n" % (pad, " ".join(bits)))

print("nodes:", len(nodes))
print("unresolved guids:", len(used_guids - set(guid_to_path)))
print(json.dumps(sorted(os.path.basename(v) for v in guid_to_path.values()), indent=0))

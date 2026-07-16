# Cut ONGEKI PlayMusic-panel sprites out of the exported atlas PNGs and write them
# (original sprite names) + manifest.json into the CardViewer private assets dir.
# Re-runnable; reads Sprite .asset m_Rect / m_RD.textureRectOffset and resolves the
# atlas texture guid -> Assets/Texture2D/*.png via .meta scan.
#
# Digit sheet choice: UI_NUM_50pt_01_MusicLevel is written BOTH as the full 224x240
# sheet AND as individual 56x60 glyph PNGs (UI_NUM_50pt_01_MusicLevel_<glyph>.png).
# Glyph grid (4x4 cells, 56x60 each, row-major from TOP; from
# MU3UICounterBase.getNormalizedUV): row0=0,1,2,3  row1=4,5,6,7
# row2=8,9,plus,minus  row3=dot,comma,(unused),zeropad
import argparse
import json
import os
import re
import shutil
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__ or "Cut ONGEKI PlayMusic sprites from a Unity export.")
    assets_env = os.environ.get("CARDVIEWER_ONGEKI_ASSETS")
    parser.add_argument(
        "--assets",
        type=Path,
        default=Path(assets_env) if assets_env else None,
        help="Unity ExportedProject/Assets directory (default: CARDVIEWER_ONGEKI_ASSETS).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "private-assets/official/scorecard/ongeki",
        help="Sprite and manifest output directory (default: repository private-assets tree).",
    )
    args = parser.parse_args()
    if args.assets is None:
        parser.error("--assets is required unless CARDVIEWER_ONGEKI_ASSETS is set")
    return args


ARGS = parse_args()
ASSETS = os.fspath(ARGS.assets.resolve())
OUT = os.fspath(ARGS.output_dir.resolve())

SPRITES = [
    "UI_PLY_Userinfo_MusicBase_Basic",
    "UI_PLY_Userinfo_MusicBase_Advanced",
    "UI_PLY_Userinfo_MusicBase_Expert",
    "UI_PLY_Userinfo_MusicBase_Master",
    "UI_PLY_Userinfo_MusicBase_Lunatic",
    "UI_PLY_Userinfo_MusicBase_Secret",
    "UI_PLY_Userinfo_MusicBase_Mirror_On",
    "UI_PLY_Userinfo_MusicBase_Mirror_Off",
    "UI_Jacket_0000",
    "UI_NUM_50pt_01_MusicLevel",
    "UI_NUM_24pt_MusicLevel_Plus",
]

JACKET_SRC = os.path.join(ASSETS, "assetbundles/ui/ui_jacket_s")
JACKET_IDS = ["0001", "0036", "0063", "0064"]  # 0002..0004 don't exist in this export

GLYPH_GRID = [
    ["0", "1", "2", "3"],
    ["4", "5", "6", "7"],
    ["8", "9", "plus", "minus"],
    ["dot", "comma", None, "zeropad"],
]

os.makedirs(OUT, exist_ok=True)


def get_vec(body, field):
    m = re.search(r"^\s*%s: \{(.*?)\}" % re.escape(field), body, re.M)
    if not m:
        return None
    parts = dict(p.split(": ") for p in m.group(1).split(", "))
    return {k: float(v) for k, v in parts.items()}


def parse_sprite_asset(name):
    body = open(os.path.join(ASSETS, "Sprite", name + ".asset"), "r", encoding="utf-8").read()
    m = re.search(r"m_Rect:\s*\n\s*serializedVersion: \d+\s*\n\s*x: ([\d.eE+-]+)\s*\n\s*y: ([\d.eE+-]+)"
                  r"\s*\n\s*width: ([\d.eE+-]+)\s*\n\s*height: ([\d.eE+-]+)", body)
    rect = {"x": float(m.group(1)), "y": float(m.group(2)),
            "width": float(m.group(3)), "height": float(m.group(4))}
    off = get_vec(body, "textureRectOffset") or {"x": 0.0, "y": 0.0}
    tex = re.search(r"texture: \{fileID: \d+, guid: ([0-9a-f]{32})", body).group(1)
    return rect, off, tex


# texture guid -> png path
tex_by_guid = {}
t2d = os.path.join(ASSETS, "Texture2D")
for fn in os.listdir(t2d):
    if fn.endswith(".png.meta"):
        head = open(os.path.join(t2d, fn), "r", encoding="utf-8", errors="replace").read(200)
        m = re.search(r"guid: ([0-9a-f]{32})", head)
        if m:
            tex_by_guid[m.group(1)] = os.path.join(t2d, fn[:-5])

manifest = {
    "source_export": ASSETS,
    "coordinate_note": "m_Rect y is measured from the BOTTOM of the atlas; PIL crop top = texH - (y+h). "
                       "Fractional packing rects are snapped by rounding each edge to the nearest integer.",
    "digit_sheet_note": "UI_NUM_50pt_01_MusicLevel saved as full sheet + per-glyph PNGs (56x60 cells, "
                        "4x4 grid row-major from top: 0123 / 4567 / 8 9 plus minus / dot comma - zeropad). "
                        "MU3UICounter renders each cell at size_=28x30 (0.5x).",
    "sprites": {},
    "jackets": {},
}

atlas_cache = {}
for name in SPRITES:
    rect, off, texguid = parse_sprite_asset(name)
    tex_path = tex_by_guid[texguid]
    if tex_path not in atlas_cache:
        atlas_cache[tex_path] = Image.open(tex_path).convert("RGBA")
    img = atlas_cache[tex_path]
    W, H = img.size
    x0 = round(rect["x"] + off["x"])
    x1 = round(rect["x"] + off["x"] + rect["width"])
    y_bot = round(rect["y"] + off["y"])
    y_top_edge = round(rect["y"] + off["y"] + rect["height"])
    box = (x0, H - y_top_edge, x1, H - y_bot)  # PIL (left, top, right, bottom)
    cut = img.crop(box)
    out_file = os.path.join(OUT, name + ".png")
    cut.save(out_file)
    manifest["sprites"][name] = {
        "file": name + ".png",
        "atlas": os.path.basename(tex_path),
        "m_Rect": rect,
        "textureRectOffset": off,
        "cut_px": {"left": box[0], "top": box[1], "width": box[2] - box[0], "height": box[3] - box[1]},
    }
    print("cut %-40s %4dx%-4d from %s" % (name, cut.width, cut.height, os.path.basename(tex_path)))

    if name == "UI_NUM_50pt_01_MusicLevel":
        cw, ch = cut.width // 4, cut.height // 4  # 56 x 60
        glyphs = {}
        for r, row in enumerate(GLYPH_GRID):
            for c, g in enumerate(row):
                if g is None:
                    continue
                gimg = cut.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
                gfile = "%s_%s.png" % (name, g)
                gimg.save(os.path.join(OUT, gfile))
                glyphs[g] = {"file": gfile, "sheet_px": {"left": c * cw, "top": r * ch,
                                                         "width": cw, "height": ch}}
        manifest["sprites"][name]["glyphs"] = glyphs
        print("  + %d glyph PNGs (%dx%d each)" % (len(glyphs), cw, ch))

for jid in JACKET_IDS:
    src = os.path.join(JACKET_SRC, "UI_Jacket_%s_S.png" % jid)
    dst = os.path.join(OUT, "UI_Jacket_%s_S.png" % jid)
    shutil.copyfile(src, dst)
    with Image.open(dst) as ji:
        manifest["jackets"]["UI_Jacket_%s_S" % jid] = {"file": os.path.basename(dst),
                                                       "size": [ji.width, ji.height]}
    print("copied UI_Jacket_%s_S.png" % jid)

json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print("manifest ->", os.path.join(OUT, "manifest.json"))

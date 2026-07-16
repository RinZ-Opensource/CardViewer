# Cut the ONGEKI music-select (ANM_SWH_MusicBt) sprites out of the exported atlas PNGs
# and write them (original sprite names) + manifest_musicbt.json into the CardViewer
# private assets dir. Re-runnable. Skips sprites already extracted for the play panel
# (UI_Jacket_0000, UI_NUM_50pt_01_MusicLevel + glyphs) but records them in the manifest.
#
# Digit sheets are ALSO split into per-glyph PNGs (<sheet>_<glyph>.png). Glyph grid is a
# 4x4 quarter grid, row-major from the TOP (MU3UICounterBase.getNormalizedUV):
#   row0: 0 1 2 3 | row1: 4 5 6 7 | row2: 8 9 plus minus | row3: dot comma (unused) zeropad
import argparse
import json
import os
import re
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__ or "Cut ONGEKI MusicBt sprites from a Unity export.")
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

# sprite name -> role note (manifest only)
SPRITES = {
    # difficulty plates (PAT_DF_base MU3UIImageChanger pattern 0..4)
    "UI_SLC_MusicSelect_DF_Basic": "difficulty plate pattern 0 (Basic)",
    "UI_SLC_MusicSelect_DF_Advanced": "difficulty plate pattern 1 (Advanced)",
    "UI_SLC_MusicSelect_DF_Expert": "difficulty plate pattern 2 (Expert)",
    "UI_SLC_MusicSelect_DF_Master": "difficulty plate pattern 3 (Master)",
    "UI_SLC_MusicSelect_DF_Lunatic": "difficulty plate pattern 4 (Lunatic)",
    # battle rank badges (PAT_BattleRank pattern 0..4)
    "UI_SLC_MusicSelect_HornorBadge_Usually": "battle rank pattern 0 (Ka)",
    "UI_SLC_MusicSelect_HornorBadge_Good": "battle rank pattern 1 (Ryo)",
    "UI_SLC_MusicSelect_HornorBadge_Great": "battle rank pattern 2 (Yu)",
    "UI_SLC_MusicSelect_HornorBadge_Excellent": "battle rank pattern 3 (Shu)",
    "UI_SLC_MusicSelect_HornorBadge_Unbelievable": "battle rank pattern 4 (Goku)",
    # technical rank badges (PAT_TechnicalRank pattern 0..11)
    "UI_SLC_MusicSelect_HornorBadge_D": "tech rank pattern 0",
    "UI_SLC_MusicSelect_HornorBadge_C": "tech rank pattern 1",
    "UI_SLC_MusicSelect_HornorBadge_B": "tech rank pattern 2",
    "UI_SLC_MusicSelect_HornorBadge_BB": "tech rank pattern 3",
    "UI_SLC_MusicSelect_HornorBadge_BBB": "tech rank pattern 4",
    "UI_SLC_MusicSelect_HornorBadge_A": "tech rank pattern 5",
    "UI_SLC_MusicSelect_HornorBadge_AA": "tech rank pattern 6",
    "UI_SLC_MusicSelect_HornorBadge_AAA": "tech rank pattern 7",
    "UI_SLC_MusicSelect_HornorBadge_S": "tech rank pattern 8",
    "UI_SLC_MusicSelect_HornorBadge_SS": "tech rank pattern 9",
    "UI_SLC_MusicSelect_HornorBadge_SSS": "tech rank pattern 10",
    "UI_SLC_MusicSelect_HornorBadge_SSSplus": "tech rank pattern 11",
    # lamps
    "UI_SLC_MusicSelect_HornorBadge_FB": "full bell lamp (PAT_FB pattern 0; hidden when not FB)",
    "UI_SLC_MusicSelect_HornorBadge_FC": "FC lamp (PAT_FC_AB pattern 0)",
    "UI_SLC_MusicSelect_HornorBadge_AB": "AB lamp (PAT_FC_AB pattern 1)",
    "UI_SLC_MusicSelect_HornorBadge_ABPlus": "AB+ lamp (PAT_FC_AB pattern 2)",
    # platinum star strip (PAT_Platinum_Star pattern 0..6 = PlatinumscorerankrateID)
    "UI_CMN_Platinum_Star_0": "platinum stars rank 0 (Rank_00)",
    "UI_CMN_Platinum_Star_1": "platinum stars rank 1 (Rank_01 >=94.0%)",
    "UI_CMN_Platinum_Star_2": "platinum stars rank 2 (Rank_02 >=95.0%)",
    "UI_CMN_Platinum_Star_3": "platinum stars rank 3 (Rank_03 >=96.0%)",
    "UI_CMN_Platinum_Star_4": "platinum stars rank 4 (Rank_04 >=97.0%)",
    "UI_CMN_Platinum_Star_5": "platinum stars rank 5 (Rank_05 >=98.0%)",
    "UI_CMN_Platinum_Star_6": "platinum stars rank 6 (Rank_05Ex >=99.0%)",
    # digit sheets + suffix glyph images
    "UI_NUM_24pt_00": "digit sheet: battle/tech score, PScore counters (size_ 18x19)",
    "UI_NUM_24pt_00_per": "'%' footer of NUM_OverDamage",
    "UI_NUM_18pt_00": "digit sheet: BPM counter (size_ 20x21.5, node scaled 0.64)",
    "UI_NUM_36pt_01": "digit sheet: over-damage counter + story counters",
    "UI_NUM_50pt_01_plus": "'+' footer of NUM_MusicLevel",
    "UI_NUM_13pt_Charalevel_00": "digit sheet: boss chara level counter",
    "UI_NUM_50pt_Jewel_00": "digit sheet: item bonus counter",
    "UI_NUM_58pt_GP": "digit sheet: master-unlock GP cost counter",
    "UI_NUM_58pt_GP_Header": "'GP' footer of NUM_GP_Cost",
    # boss block
    "UI_SLC_MusicSelect_CharaGauge": "boss card frame/gauge 140x126",
    "UI_SLC_MusicSelect_CharaGauge_VS_01": "VS label 68x30",
    "UI_SLC_MusicSelect_CharaAttribute_Mask": "boss card icon mask (MU3UIMaskedImage)",
    "UI_CMN_CharaLevel_base": "boss Lv plate 73.75x29.7",
    "UI_CMN_CharaLevel_base_Header": "'Lv.' header on boss Lv plate",
    "UI_CMN_AttributeIcon_Fire_mini": "attribute icon pattern 0 (Fire)",
    "UI_CMN_AttributeIcon_Aqua_mini": "attribute icon pattern 1 (Aqua)",
    "UI_CMN_AttributeIcon_Leaf_mini": "attribute icon pattern 2 (Leaf)",
    # platinum score block base
    "UI_SLC_MusicSelect_pscore_base_00": "platinum score pill 122x52 (sliced)",
    # marks
    "UI_SLC_MusicSelect_New": "NEW mark 126x44",
    "UI_SLC_MusicSelect_Get": "GET! mark 124x26",
    "UI_SLC_MusicSelect_FinishBonus_Ribbon": "item bonus ribbon 96x56",
    # rights strip
    "UI_SLC_MusicSelect_LightsBase_00": "rights strip base 378x54.7 (sliced)",
    "UI_DMY_rights_00": "rights dummy text",
    # lock covers / secret
    "UI_SLC_MusicSelect_MusicNG_info_00": "sphere lock cover pattern 0 (locked)",
    "UI_SLC_MusicSelect_MusicNG_info_01": "sphere lock cover pattern 1 (short of jewels)",
    "UI_SWH_JewelCost": "jewel cost bubble on sphere lock",
    "UI_SLC_MusicSelect_DF_MasterLock": "master lock cover 298x476",
    "UI_SLC_MusicSelect_DF_MasterLock_GP_Lack": "master lock cover, GP lacking 290x472",
    "UI_SLC_MusicSelect_DF_GP_unlock": "GP unlock bubble 194x150",
    "UI_SLC_MusicSelect_DF_secret": "secret song plate 278x458",
    "UI_SLC_MusicSelect_SelecterChoosingBlack": "black dim cover (Black_cover 2000x720)",
}

# digit sheets that get the per-glyph split
GLYPH_SHEETS = ["UI_NUM_24pt_00", "UI_NUM_18pt_00", "UI_NUM_36pt_01",
                "UI_NUM_13pt_Charalevel_00", "UI_NUM_50pt_Jewel_00", "UI_NUM_58pt_GP"]

GLYPH_GRID = [
    ["0", "1", "2", "3"],
    ["4", "5", "6", "7"],
    ["8", "9", "plus", "minus"],
    ["dot", "comma", None, "zeropad"],
]

# already extracted by the play-panel pass -> skip cutting, record reference only
REUSED = ["UI_Jacket_0000", "UI_NUM_50pt_01_MusicLevel"]

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
    "prefab": "Assets/GameObject/ANM_SWH_MusicBt.prefab (music-select score card, 278x458 plate)",
    "coordinate_note": "m_Rect y is measured from the BOTTOM of the atlas; PIL crop top = texH - (y+h). "
                       "Fractional packing rects are snapped by rounding each edge to the nearest integer.",
    "digit_sheet_note": "digit sheets saved as full sheet + per-glyph PNGs (4x4 quarter grid row-major "
                        "from top: 0123 / 4567 / 8 9 plus minus / dot comma - zeropad; "
                        "MU3UICounterBase.getNormalizedUV).",
    "reused_from_play_panel": REUSED,
    "sprites": {},
}

atlas_cache = {}
for name, role in SPRITES.items():
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
    box = (x0, H - y_top_edge, x1, H - y_bot)
    cut = img.crop(box)
    out_file = os.path.join(OUT, name + ".png")
    cut.save(out_file)
    entry = {
        "file": name + ".png",
        "role": role,
        "atlas": os.path.basename(tex_path),
        "m_Rect": rect,
        "textureRectOffset": off,
        "cut_px": {"left": box[0], "top": box[1], "width": box[2] - box[0], "height": box[3] - box[1]},
    }
    print("cut %-46s %4dx%-4d from %s" % (name, cut.width, cut.height, os.path.basename(tex_path)))

    if name in GLYPH_SHEETS:
        # quarter-grid UVs; sheet dims are not always divisible by 4 (e.g. 80x86),
        # so compute each cell edge as round(i*dim/4) instead of integer cell*index
        xe = [int(i * cut.width / 4 + 0.5) for i in range(5)]
        ye = [int(i * cut.height / 4 + 0.5) for i in range(5)]
        glyphs = {}
        for r, row in enumerate(GLYPH_GRID):
            for c, g in enumerate(row):
                if g is None:
                    continue
                box_g = (xe[c], ye[r], xe[c + 1], ye[r + 1])
                gimg = cut.crop(box_g)
                gfile = "%s_%s.png" % (name, g)
                gimg.save(os.path.join(OUT, gfile))
                glyphs[g] = {"file": gfile, "sheet_px": {"left": box_g[0], "top": box_g[1],
                                                         "width": box_g[2] - box_g[0],
                                                         "height": box_g[3] - box_g[1]}}
        entry["glyphs"] = glyphs
        print("  + %d glyph PNGs (~%.1fx%.1f each)" % (len(glyphs), cut.width / 4, cut.height / 4))
    manifest["sprites"][name] = entry

json.dump(manifest, open(os.path.join(OUT, "manifest_musicbt.json"), "w"), indent=1)
print("manifest ->", os.path.join(OUT, "manifest_musicbt.json"))

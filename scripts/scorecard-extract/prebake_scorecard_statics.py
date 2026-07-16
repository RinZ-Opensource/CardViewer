"""Pre-bake score-card sprites that CSS cannot reproduce export-safely.

The PNG exporter (html-to-image) does not rasterize border-image/mask urls, so
every 9-slice or vertex-tinted sprite is baked to a plain PNG here instead.

Inputs are the already-cut sprites in private-assets/official/scorecard/;
outputs are written next to them with a `baked_` prefix. Re-runnable.

- chuni decide frame: C_base CSLI 3-slice (454x610) from the 34px gold-glow
  strip (crop0, left cap + mirrored right cap) and the 6px translucent dark
  fill strip (crop1, stretched middle); strips are 600 tall -> stretched to 610.
- chuni BPM digits: crops 20..29 are white ink; C_bpm_num carries vertex color
  ARGB(255,49,60,78) = #313C4E, a non-grayscale multiply CSS filters can't do.
- ongeki platinum-score pill: UI_SLC_MusicSelect_pscore_base_00 122x41 sliced
  vertically (border l,b,r,t = 0,17,0,23) onto the 122x52 cast box.
- ongeki rights strip base: UI_SLC_MusicSelect_LightsBase_00 26x48 sliced
  horizontally (border 13,0,8,0) onto the 378-wide cast box.
"""

import argparse
import os
from pathlib import Path

from PIL import Image, ImageOps

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / "private-assets" / "official" / "scorecard"
ROOT = DEFAULT_ROOT
CHUNI = ROOT / "chuni"
ONGEKI = ROOT / "ongeki"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    root_env = os.environ.get("CARDVIEWER_SCORECARD_ASSET_ROOT")
    parser.add_argument(
        "--scorecard-root",
        type=Path,
        default=Path(root_env) if root_env else DEFAULT_ROOT,
        help=(
            "Directory containing chuni/ and ongeki/ cut sprites; baked PNGs are "
            "written beside their inputs (default: CARDVIEWER_SCORECARD_ASSET_ROOT "
            "or the repository private-assets tree)."
        ),
    )
    return parser.parse_args()


def bake_chuni_decide_frame() -> None:
    gold = Image.open(CHUNI / "CHU_UI_Select_musicbox_00_0.png").convert("RGBA")  # 34x600
    fill = Image.open(CHUNI / "CHU_UI_Select_musicbox_00_1.png").convert("RGBA")  # 6x600
    w, h = 454, 610
    cap_w = gold.width
    frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    frame.paste(fill.resize((w - 2 * cap_w, h), Image.BILINEAR), (cap_w, 0))
    frame.paste(gold.resize((cap_w, h), Image.BILINEAR), (0, 0))
    frame.paste(ImageOps.mirror(gold).resize((cap_w, h), Image.BILINEAR), (w - cap_w, 0))
    frame.save(CHUNI / "baked_musicbox_decide_frame.png")


def bake_chuni_bpm_digits() -> None:
    tint = (49, 60, 78)  # #313C4E
    for digit in range(10):
        src = Image.open(CHUNI / f"CHU_UI_Select_musicbox_00_{20 + digit}.png").convert("RGBA")
        r, g, b, a = src.split()
        out = Image.merge(
            "RGBA",
            (
                r.point(lambda v: v * tint[0] // 255),
                g.point(lambda v: v * tint[1] // 255),
                b.point(lambda v: v * tint[2] // 255),
                a,
            ),
        )
        out.save(CHUNI / f"baked_musicbox_bpm_{digit}.png")


def vslice(src: Image.Image, top: int, bottom: int, out_h: int) -> Image.Image:
    w, h = src.size
    out = Image.new("RGBA", (w, out_h), (0, 0, 0, 0))
    out.paste(src.crop((0, 0, w, top)), (0, 0))
    mid = src.crop((0, top, w, h - bottom))
    out.paste(mid.resize((w, out_h - top - bottom), Image.BILINEAR), (0, top))
    out.paste(src.crop((0, h - bottom, w, h)), (0, out_h - bottom))
    return out


def hslice(src: Image.Image, left: int, right: int, out_w: int) -> Image.Image:
    w, h = src.size
    out = Image.new("RGBA", (out_w, h), (0, 0, 0, 0))
    out.paste(src.crop((0, 0, left, h)), (0, 0))
    mid = src.crop((left, 0, w - right, h))
    out.paste(mid.resize((out_w - left - right, h), Image.BILINEAR), (left, 0))
    out.paste(src.crop((w - right, 0, w, h)), (out_w - right, 0))
    return out


def bake_ongeki_slices() -> None:
    pscore = Image.open(ONGEKI / "UI_SLC_MusicSelect_pscore_base_00.png").convert("RGBA")
    vslice(pscore, top=23, bottom=17, out_h=52).save(ONGEKI / "baked_pscore_base_122x52.png")

    rights = Image.open(ONGEKI / "UI_SLC_MusicSelect_LightsBase_00.png").convert("RGBA")
    hslice(rights, left=13, right=8, out_w=378).save(ONGEKI / "baked_rights_base_378x48.png")


def main() -> int:
    global ROOT, CHUNI, ONGEKI
    args = parse_args()
    ROOT = args.scorecard_root.resolve()
    CHUNI = ROOT / "chuni"
    ONGEKI = ROOT / "ongeki"
    bake_chuni_decide_frame()
    bake_chuni_bpm_digits()
    bake_ongeki_slices()
    print("baked: chuni decide frame, chuni bpm digits x10, ongeki pscore/rights bases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

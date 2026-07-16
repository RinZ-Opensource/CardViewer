#!/usr/bin/env python3
"""
Extract the CHUNITHM music-select score card:
  scene CHU_UI_Select_musicbox_00, layer L_Select_music_box (143 nodes)
  from a caller-supplied CHU_UI_Select_00_v10.srd

Outputs
  <scratchpad>/chuni_musicbox_tree.txt     human-readable layout dump (CSS coords)
  <scratchpad>/chuni_musicbox_tree.json    machine-readable dump incl. full anims
  <scratchpad>/chk_montage_*.png           labeled montages for visual pattern verification
  <output-dir>/<texture>_<cropIdx>.png
  <output-dir>/manifest_musicbox.json
  (the existing playing-panel manifest.json is NOT touched)

CSS coordinate origin: top-left of the 454x610 decide-frame slice
  (node [2] C_start_head/C_base, layer-local box (-227,-305,454x610)).
  The card base C_music_box_base_00 (438x584) sits at CSS (8,13) inside it.
  cssX = layerX + 227, cssY = layerY + 305.

VTBF/SurfRide format knowledge is inherited from extract_chuni_musicinfo.py
(probe_srd_1..6.py). CNUM number params (verified against playing panel):
  0x80 flags?, 0x81 preview value, 0x82 preview decimals, 0x83/0x84 digit cell w/h,
  0x85 separator (comma/dot) cell width, 0x86 ?, 0x87 zero-pad?, 0x88 digits per
  group (3 = thousands commas), 0x89 ?, 0x8a separator y-offset, 0x8b ?,
  0x8c scale vec2, 0x8f dot x-offset, 0x91..0x94 misc pattern ids.
Cast anchor4b: 0=none,3=left-anchored,4=center. Pivot in cast px from top-left.
"""
import argparse
import struct, json, os, sys
from collections import OrderedDict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    surfboard_root = os.environ.get("CARDVIEWER_CHUNI_SURFBOARD_ROOT")
    surfboard_root = Path(surfboard_root) if surfboard_root else None
    parser.add_argument(
        "--srd",
        type=Path,
        default=(surfboard_root / "play/select/CHU_UI_Select_00_v10.srd") if surfboard_root else None,
        help="Input CHU_UI_Select_00_v10.srd (default: derived from CARDVIEWER_CHUNI_SURFBOARD_ROOT).",
    )
    parser.add_argument(
        "--texture-dir",
        type=Path,
        default=(surfboard_root / "texture") if surfboard_root else None,
        help="Directory containing the SRD-referenced DDS files (default: derived from CARDVIEWER_CHUNI_SURFBOARD_ROOT).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "private-assets/official/scorecard/chuni",
        help="Sprite and manifest output directory (default: repository private-assets tree).",
    )
    parser.add_argument(
        "--scratch-dir",
        type=Path,
        default=SCRIPT_DIR,
        help="Layout dumps and montage output directory (default: this script directory).",
    )
    args = parser.parse_args()
    if args.srd is None:
        parser.error("--srd is required unless CARDVIEWER_CHUNI_SURFBOARD_ROOT is set")
    if args.texture_dir is None:
        parser.error("--texture-dir is required unless CARDVIEWER_CHUNI_SURFBOARD_ROOT is set")
    return args


ARGS = parse_args()
SRD = os.fspath(ARGS.srd.resolve())
TEXDIR = os.fspath(ARGS.texture_dir.resolve())
SCRATCH = os.fspath(ARGS.scratch_dir.resolve())
OUTDIR = os.fspath(ARGS.output_dir.resolve())
SCENE, LAYER = 'CHU_UI_Select_musicbox_00', 'L_Select_music_box'

CURVE_TARGETS = {0:'PosX',1:'PosY',2:'PosZ',3:'RotX',4:'RotY',5:'RotZ',6:'ScaleX',7:'ScaleY',
                 8:'ScaleZ',9:'MaterialColor',10:'Display',11:'Width',12:'Height',
                 13:'VtxColorTL',14:'VtxColorTR',15:'VtxColorBL',16:'VtxColorBR',
                 17:'CropIndex0',18:'CropIndex1',19:'Unknown19',20:'IllumColor',
                 21:'MaterialColorAlpha'}
CAST_TYPES = {0:'null',1:'image',2:'slice',3:'reference',4:'number',5:'text?'}

# ---------------------------------------------------------------- VTBF parsing
def read_records(path):
    data = open(path,'rb').read()
    assert data[0:4] == b'VTBF'
    recs, off = [], 16
    while off + 8 <= len(data):
        size = struct.unpack_from('<I', data, off+4)[0]
        recs.append((off, data[off+8:off+8+size]))
        off += 8 + size
    return recs

def parse_fields(body):
    tag = body[0:4]
    a, b = struct.unpack_from('<HH', body, 4)
    o = 8; out = []; n = len(body)
    while o < n:
        sub = body[o]; typ = body[o+1]; o += 2
        if typ == 0x00: out.append((sub, 'mark', None))
        elif typ in (0x01, 0x03, 0x04): out.append((sub, 'u8', body[o])); o += 1
        elif typ == 0x02:
            ln = body[o]; o += 1
            if ln & 0x80: ln = ((ln & 0x7f) << 8) | body[o]; o += 1
            out.append((sub, 'str', body[o:o+ln].decode('utf-8','replace'))); o += ln
        elif typ == 0x05: out.append((sub, 'i16', struct.unpack_from('<h', body, o)[0])); o += 2
        elif typ == 0x06: out.append((sub, 'u16', struct.unpack_from('<H', body, o)[0])); o += 2
        elif typ in (0x07, 0x09): out.append((sub, 'i32', struct.unpack_from('<i', body, o)[0])); o += 4
        elif typ in (0x08, 0x0B): out.append((sub, 'u32', struct.unpack_from('<I', body, o)[0])); o += 4
        elif typ == 0x0A: out.append((sub, 'f32', struct.unpack_from('<f', body, o)[0])); o += 4
        elif typ == 0x0C: out.append((sub, 'rgba', tuple(body[o:o+4]))); o += 4
        elif typ in (0x45, 0x4A, 0x4B):
            cnt = body[o] + 2; o += 1
            fmt = {0x45:'H',0x4A:'f',0x4B:'i'}[typ]; esz = {0x45:2,0x4A:4,0x4B:4}[typ]
            out.append((sub, f'vec{cnt}', struct.unpack_from(f'<{cnt}{fmt}', body, o))); o += esz*cnt
        elif typ & 0x80:
            et = typ & 0x7F; cnt = body[o] + 1; o += 1
            esz = {0x01:1,0x03:1,0x04:1,0x05:2,0x06:2,0x07:4,0x08:4,0x09:4,0x0A:4,0x0C:4}.get(et,1)
            out.append((sub, f'arr{et:02x}x{cnt}', body[o:o+cnt*esz].hex())); o += cnt*esz
        else: raise Exception(f'unk field type {typ:#x} in {tag!r}')
    return tag, a, b, out

def split_groups(fields):
    groups, cur = [], None
    for sub, ty, val in fields:
        if ty == 'mark' and sub in (0xfc, 0xfe):
            if cur is not None: groups.append(cur)
            cur = {}
        elif cur is not None:
            cur.setdefault(sub, []).append(val)
        else:
            cur = {sub: [val]}
    if cur: groups.append(cur)
    return groups

def kv(s):
    out = OrderedDict()
    for part in s.split(','):
        if '#' in part:
            k, _, v = part.partition('#')
            out[k] = v
        elif part:
            out[part] = ''
    return out

# ---------------------------------------------------------------- global tables
recs = read_records(SRD)
texs, crops_by_tex, fonts = [], [], []
for offr, body in recs:
    t4 = body[0:4]
    if t4 == b'TEX ':
        _,a,b_,f = parse_fields(body)
        d = {s:v for s,ty,v in f}
        texs.append((d.get(0x61), d.get(0x40), d.get(0x41)))
    elif t4 == b'CROP':
        _,a,b_,f = parse_fields(body)
        crops_by_tex.append([v for s,ty,v in f if s == 0x65])
    elif t4 == b'FONT':
        _,a,b_,f = parse_fields(body)
        fonts.append([v for s,ty,v in f if ty=='str'][0])

# scene-aware layer blocks (records until ANMS/next SCN; anims live inside)
layer_blocks, layer_order = {}, []
cur = cur_scene = None
for offr, body in recs:
    t4 = body[0:4]
    if t4 == b'SCN ':
        _,a,b_,f = parse_fields(body)
        strs = [v for s,ty,v in f if ty=='str']
        cur_scene = strs[0] if strs else None
        cur = None
    elif t4 == b'LAYR':
        _,a,b_,f = parse_fields(body)
        nm = [v for s,ty,v in f if ty=='str'][0]
        cur = (cur_scene, nm)
        layer_blocks[cur] = []
        layer_order.append(cur)
    elif t4 in (b'ANMS', b'TEXL', b'FONT', b'CAM '):
        cur = None
    if cur: layer_blocks[cur].append((offr, body))

# ---------------------------------------------------------------- layer parser
def parse_layer(key):
    blk = layer_blocks[key]
    nodes, trs, datas, anims = [], [], [], []
    catr_by_node = {}
    for offr, body in blk:
        t4 = body[0:4]
        if t4 == b'NODE':
            _,a,b_,f = parse_fields(body); nodes = split_groups(f)
        elif t4 == b'TRS2':
            _,a,b_,f = parse_fields(body); trs = split_groups(f)
        elif t4 in (b'CIMG', b'CSLI', b'CNUM', b'CRFD'):
            _,a,b_,f = parse_fields(body)
            d = OrderedDict()
            for s,ty,v in f: d.setdefault(s, []).append(v)
            datas.append({'kind': t4.decode().strip(), 'f': d, 'refs': [], 'text': None})
        elif t4 == b'TEXT':
            _,a,b_,f = parse_fields(body)
            d = OrderedDict()
            for s,ty,v in f: d.setdefault(s, []).append(v)
            if datas: datas[-1]['text'] = d
        elif t4 in (b'CREF', b'CRE1'):
            _,a,b_,f = parse_fields(body)
            if datas:
                for s,ty,v in f:
                    if s == 0x4a and len(v) >= 2:
                        datas[-1]['refs'].append((t4.decode().strip(), int(v[0]), int(v[1])))
        elif t4 == b'CATR':
            _,a,b_,f = parse_fields(body)
            nidx = None; attrs = OrderedDict(); lastkind = None
            for s,ty,v in f:
                if s == 0x51: nidx = v
                elif s == 0x03: lastkind = v
                elif s == 0x0f and lastkind is not None:
                    attrs[lastkind] = v; lastkind = None
            if nidx is not None:
                catr_by_node[nidx] = attrs
            elif anims:
                anims[-1]['attrs'] = {k: kv(v) for k, v in attrs.items()}
        elif t4 == b'ANIM':
            _,a,b_,f = parse_fields(body)
            d = {s:(ty,v) for s,ty,v in f}
            anims.append({'name': [v for s,ty,v in f if ty=='str'][0],
                          'endFrame': d.get(0x50, (None,None))[1],
                          'motions': []})
        elif t4 == b'MOT ':
            _,a,b_,f = parse_fields(body)
            d = {s:v for s,ty,v in f}
            anims[-1]['motions'].append({'node': d.get(0x51), 'tracks': []})
        elif t4 == b'TRK ':
            _,a,b_,f = parse_fields(body)
            d = {s:v for s,ty,v in f}
            anims[-1]['motions'][-1]['tracks'].append({
                'target': d.get(0x53), 'targetName': CURVE_TARGETS.get(d.get(0x53), f"t{d.get(0x53)}"),
                'flags': d.get(0x54), 'firstFrame': d.get(0x58), 'lastFrame': d.get(0x59),
                'keys': []})
        elif t4 == b'KEY ':
            _,a,b_,f = parse_fields(body)
            trk = anims[-1]['motions'][-1]['tracks'][-1]
            key2 = None
            for s,ty,v in f:
                if s == 0x5a:
                    key2 = {'frame': v}; trk['keys'].append(key2)
                elif key2 is not None:
                    key2[{0x5b:'value',0x5c:'interp',0x5d:'tanIn',0x5e:'tanOut'}.get(s, f's{s:02x}')] = v

    data_by_node = {}
    for dcast in datas:
        owner = dcast['f'].get(0x51, [None])[0]
        data_by_node[owner] = dcast

    out_nodes = []
    for i, nd in enumerate(nodes):
        tr = trs[i] if i < len(trs) else {}
        flags = nd.get(0x30,[0])[0]
        n = {
            'index': i,
            'name': nd.get(0x03, [None])[0],
            'flags': flags,
            'castType': CAST_TYPES.get(flags & 0xF, f'{flags & 0xF}'),
            'child': nd.get(0x3c, [-1])[0],
            'sibling': nd.get(0x3d, [-1])[0],
            'pos': list(tr.get(0x34, [(0.0, 0.0)])[0]),
            'rot': tr.get(0x35, [0])[0],
            'scale': list(tr.get(0x36, [(1.0, 1.0)])[0]),
            'visible': tr.get(0x3b, [1])[0],
            'materialColor': list(tr.get(0x3a, [(255,255,255,255)])[0]),
            'illumColor': list(tr.get(0x33, [(255,0,0,0)])[0]),
            'prio': tr.get(0x3e, [0])[0],
            'attrs': {k: kv(v) for k, v in catr_by_node.get(i, {}).items()},
        }
        d = data_by_node.get(i)
        if d:
            f = d['f']
            n['cast'] = {
                'kind': d['kind'],
                'size': [f.get(0x40,[None])[0], f.get(0x41,[None])[0]],
                'pivot': [f.get(0x42,[0.0])[0], f.get(0x43,[0.0])[0]],
                'flags49': f.get(0x49,[0])[0],
                'anchor4b': f.get(0x4b,[None])[0],
                'defaultPattern46': f.get(0x46,[None])[0],
                'cropRefCount45': f.get(0x45,[None])[0],
                'vertexColors': [list(c) for c in f.get(0x44, [])],
            }
            if d['kind'] == 'CNUM':
                n['cast']['numParams'] = {f'0x{s:02x}': (list(v[0]) if isinstance(v[0], tuple) else v[0])
                                          for s, v in f.items() if 0x78 <= s <= 0x94}
            n['sprites'] = []
            for reftag, ti, ci in d['refs']:
                if ti >= len(texs):   # 65535 = empty pattern slot
                    n['sprites'].append({'refTag': reftag, 'texIndex': ti, 'texture': None,
                                         'cropIndex': ci, 'rect': None})
                    continue
                texname = texs[ti][0]
                rect = list(crops_by_tex[ti][ci]) if ti < len(crops_by_tex) and ci < len(crops_by_tex[ti]) else None
                n['sprites'].append({'refTag': reftag, 'texIndex': ti, 'texture': texname,
                                     'cropIndex': ci, 'rect': rect})
            if d['text'] is not None:
                td = d['text']
                fi = td.get(0x79,[None])[0]
                n['textCast'] = {
                    'previewText': td.get(0x7a,[None])[0],
                    'fontIndex': fi,
                    'fontFile': fonts[fi] if fi is not None and fi < len(fonts) else None,
                    'sizeHint78': td.get(0x78,[None])[0],
                    'textScale': list(td.get(0x36,[(1.0,1.0)])[0]),
                    'margins7b': list(td.get(0x7b,[(0,0,0,0)])[0]),
                    'f7c': td.get(0x7c,[None])[0],
                    'lineHeight41': td.get(0x41,[None])[0],
                }
        out_nodes.append(n)

    def walk(i, px, py, sx, sy, depth, parent):
        while i != -1 and i is not None and i < len(out_nodes):
            n = out_nodes[i]
            ax = px + n['pos'][0]*sx
            ay = py + n['pos'][1]*sy
            asx, asy = sx*n['scale'][0], sy*n['scale'][1]
            n['abs'] = {'x': round(ax,3), 'y': round(ay,3), 'scaleX': round(asx,6), 'scaleY': round(asy,6)}
            n['depth'] = depth; n['parent'] = parent
            if 'cast' in n and n['cast']['size'][0] is not None:
                w = n['cast']['size'][0]*asx; h = n['cast']['size'][1]*asy
                tlx = ax - n['cast']['pivot'][0]*asx
                tly = ay - n['cast']['pivot'][1]*asy
                n['absBox'] = {'left': round(tlx,3), 'top': round(tly,3),
                               'width': round(w,3), 'height': round(h,3)}
            walk(n['child'], ax, ay, asx, asy, depth+1, i)
            i = n['sibling']
    walk(0, 0.0, 0.0, 1.0, 1.0, 0, None)
    return {'layer': key[1], 'scene': key[0], 'nodes': out_nodes, 'anims': anims}

layer = parse_layer((SCENE, LAYER))
nodes, anims = layer['nodes'], layer['anims']

# ---------------------------------------------------------------- CSS origin
# node[2] C_start_head/C_base = 454x610 decide-frame slice; its top-left is the card origin
frame = nodes[2]['absBox']
ORIGIN_X, ORIGIN_Y = frame['left'], frame['top']     # (-227, -305)
CARD_W, CARD_H = frame['width'], frame['height']     # 454 x 610
for n in nodes:
    if 'absBox' in n:
        b = n['absBox']
        n['cssBox'] = {'left': round(b['left'] - ORIGIN_X, 2), 'top': round(b['top'] - ORIGIN_Y, 2),
                       'width': round(b['width'], 2), 'height': round(b['height'], 2)}
    if 'abs' in n:
        n['cssPos'] = {'x': round(n['abs']['x'] - ORIGIN_X, 2), 'y': round(n['abs']['y'] - ORIGIN_Y, 2)}

# ---------------------------------------------------------------- pattern labels
# 'v' = visually verified from cut pixels (montages chk_montage_*.png / chk_misc_icons.png /
#       chk_cover_ambig.png read at full zoom), 'g' = inferred from context only
LABELS = {
    'C_music_box_base_00': [  # card base per difficulty (v: color + printed header text)
        ('v','base_BASIC_green'), ('v','base_ADVANCED_orange'), ('v','base_EXPERT_red'),
        ('v','base_MASTER_purple'), ('v','base_ULTIMA_black_red'), ('v','base_WORLDS_END_rainbow')],
    'C_achievement_rank': [   # score rank badge (v: lettering read from chk_montage_rank.png)
        ('v','rank_blank'), ('v','rank_D'), ('v','rank_C'), ('v','rank_B'), ('v','rank_BB'),
        ('v','rank_BBB'), ('v','rank_A'), ('v','rank_AA'), ('v','rank_AAA'), ('v','rank_S'),
        ('v','rank_Splus'), ('v','rank_SS'), ('v','rank_SSplus'), ('v','rank_SSS'), ('v','rank_SSSplus')],
    'C_achievement_success': [  # clear lamp (v: chk_montage_success.png; p6 is a fully
        ('v','lamp_blank'), ('v','lamp_FAILED'), ('v','lamp_CLEAR'), ('v','lamp_HARD'),
        ('v','lamp_BRAVE'), ('v','lamp_ABSOLUTE'), ('v','lamp_unused_transparent'),
        ('v','lamp_CATASTROPHY')],                       # transparent 134x26 slot (0 opaque px)
    'C_achievement_combo_perfect': [  # combo lamp (v)
        ('v','combo_blank'), ('v','combo_FULL_COMBO'), ('v','combo_ALL_JUSTICE'), ('v','combo_AJC')],
    'C_achievement_fchain': [  # WE full-chain lamp (v)
        ('v','fchain_blank'), ('v','fchain_FULL_CHAIN_gold'), ('v','fchain_FULL_CHAIN_platinum')],
    'C_score_num': [('v',f'score_digit_{i}') for i in range(10)] + [('v','score_comma')],
    'C_bpm_num':   [('v',f'bpm_digit_{i}') for i in range(10)],
    'C_level_num': [('v',f'level_digit_{i}') for i in range(10)],
    'C_level_plus': [('v','level_plus')],
    'C_level_base': None,  # two nodes share this name; handled below by index
    'C_level_star': [('v', f'westar_dark_{(i+1)*0.5:g}') for i in range(10)] +
                    [('v', f'westar_gold_{(i+1)*0.5:g}') for i in range(10)],  # half-star steps
    'PAT_start_txt': [('v','start_banner_GAME_START'), ('v','start_banner_GAME_junbikanryo_ready'),
                      ('v','start_banner_Link_START')],
    'C_warning': [('v','warning_kadaikyoku_red'), ('v','warning_kadaikyoku_no_difficulty_change')],
    'C_cover_info': [  # full-card 438x584 state overlays (v: chk_montage_coverinfo/chk_cover_ambig)
        ('g','cover_tiny_blank_30x30'), ('v','cover_RANDOM_SELECT'),
        ('v','cover_NO_DATA_no_playable_chart'), ('v','cover_WE_ticket_missing'),
        ('v','cover_no_chart_for_this_difficulty'), ('v','cover_locked_rankS_to_unlock'),
        ('v','cover_store_matching_unavailable'), ('v','cover_fully_transparent_empty'),
        ('v','cover_battle_rank_level_locked'), ('v','cover_greyout_slash_no_text_default'),
        ('v','cover_alert_yellow_band'), ('v','cover_unknown_qmark_song')],
    'C_branch': [('v','branch_record_not_displayed_band'), ('v','branch_plain_cream_band')],
    'C_new': [('v','icon_NEW_ribbon')],
    'C_corner_info': [('v','icon_EVENT_ribbon')],
    'DIS_penguin_selection_info': [('v','penguin_selection_banner')],
    'C_map_bonus_pop': [('v','map_bonus_stamp')],
    'C_map_bonus_pop_shadow': [('v','map_bonus_stamp')],
    'PAT_Ranking_info': [('v','ranking_1st_gold'), ('v','ranking_2nd_silver'),
                         ('v','ranking_3rd_bronze'), ('v','ranking_4th_gray')],
    'Ranking_info': [('v','ranking_label_taisen_rireki')],
    'DIS_transmission_info': [('v','transmission_base_gradient')],
    'PAT_transmission_info': [('v','transmission_0_players'), ('v','transmission_1_player'),
                              ('v','transmission_2_players'), ('v','transmission_3_players')],
    'transmission_info': [('v','transmission_label_mishoji_not_owned')],
    'C_notesdesigner_txt': [('v','notesdesigner_label_strip'), ('g','notesdesigner_slice_edge_a'),
                            ('g','notesdesigner_slice_edge_b')],
    'C_music_box_jacket_body': [('v','jacket_dummy_300x300')],
    'C_base': [('g','decide_frame_strip_a'), ('g','decide_frame_strip_b'),
               ('g','decide_frame_strip_a')],
    'C_LV_cover_info_name': [('v','LV_hidden_title_plate_qmarks')],
    'PAT_LV_cover_info_level': [('g','LV_level_box_pat0'), ('g','LV_level_box_pat1'),
                                ('g','LV_level_box_pat2_switch_target')],
    'C_AJ_effect_02': [('g','aj_eff_glow_square')],
    'C_AJ_effect_03': [('g','aj_eff_glow_square')],
    'C_AJ_effect_04': [('g','aj_eff_glow_square')],
    'C_AJ_effect_05': [('g','aj_eff_outline_roundrect'), ('g','aj_eff_black_rect_a'), ('g','aj_eff_black_rect_b')],
    'C_AJ_effect_06': [('g','aj_eff_outline_roundrect'), ('g','aj_eff_black_rect_a'), ('g','aj_eff_black_rect_b')],
    'C_AJ_effect_07': [('g','aj_eff_outline_square'), ('g','aj_eff_black_rect_a'), ('g','aj_eff_black_rect_b')],
    'C_AJ_effect_08': [('g','aj_eff_outline_square'), ('g','aj_eff_black_rect_a'), ('g','aj_eff_black_rect_b')],
    'C_AJ_effect_09': [('g','aj_eff_outline_square'), ('g','aj_eff_black_rect_a'), ('g','aj_eff_black_rect_b')],
}
def label_for(n, k):
    lab = LABELS.get(n['name'])
    if n['name'] == 'C_level_base':
        return ('v','level_base_normal') if n['index'] == 40 else ('v','level_base_WE')
    if n['name'].startswith('C_star_'):
        return ('g','fx_star_sparkle')
    if n['name'].startswith('C_music_box_achievement_eff'):
        return ('g','fx_achievement_sparkle')
    if n['name'].startswith('C_lv_start_eff'):
        return ('g','fx_lv_start_sparkle')
    if lab and k < len(lab): return lab[k]
    return ('g', None)

# ---------------------------------------------------------------- sprite cutting
from PIL import Image
os.makedirs(OUTDIR, exist_ok=True)
os.makedirs(SCRATCH, exist_ok=True)
_teximg_cache = {}
def teximg(name):
    if name not in _teximg_cache:
        _teximg_cache[name] = Image.open(os.path.join(TEXDIR, name + '.dds')).convert('RGBA')
    return _teximg_cache[name]

def cut(ti, ci):
    name = texs[ti][0]
    rect = crops_by_tex[ti][ci]
    l, t, r, b = rect
    out = teximg(name).crop((l, t, r, b))
    fn = f'{name}_{ci}.png'
    out.save(os.path.join(OUTDIR, fn))
    return fn, list(rect), [r - l, b - t]

manifest = {
    'source': SRD, 'scene': SCENE, 'layer': LAYER,
    'cssOrigin': {'comment': 'top-left of the 454x610 decide-frame (C_start_head/C_base); '
                             'layer-local (%g,%g). Card base 438x584 at CSS (8,13).' % (ORIGIN_X, ORIGIN_Y),
                  'cardW': CARD_W, 'cardH': CARD_H,
                  'base438x584offset': [8, 13]},
    'sprites': [], 'nodes': []}
cut_cache = {}
for n in nodes:
    if not n.get('sprites'): continue
    ent = {'nodeIndex': n['index'], 'node': n['name'], 'castType': n['castType'],
           'visible': n['visible'], 'cssBox': n.get('cssBox'),
           'defaultPattern': n.get('cast',{}).get('defaultPattern46'), 'patterns': []}
    for k, sp in enumerate(n['sprites']):
        if sp['texture'] is None or sp['rect'] is None:
            ent['patterns'].append({'patternIndex': k, 'file': None, 'label': 'EMPTY_SLOT'})
            continue
        ck = (sp['texIndex'], sp['cropIndex'])
        if ck not in cut_cache:
            fn, rect, size = cut(*ck)
            cut_cache[ck] = (fn, rect, size)
            manifest['sprites'].append({'file': fn, 'texture': sp['texture'],
                                        'cropIndex': sp['cropIndex'], 'rect_ltrb': rect, 'size': size})
        fn, rect, size = cut_cache[ck]
        ver, lab = label_for(n, k)
        ent['patterns'].append({'patternIndex': k, 'file': fn, 'size': size,
                                'label': lab, 'labelVerified': ver == 'v'})
    manifest['nodes'].append(ent)

with open(os.path.join(OUTDIR, 'manifest_musicbox.json'), 'w', encoding='utf-8') as fh:
    json.dump(manifest, fh, indent=2, ensure_ascii=False)

# ---------------------------------------------------------------- montages for label verification
from PIL import ImageDraw
def montage(fname, node_idx, scale=2, bg=(40,40,60,255)):
    n = nodes[node_idx]
    cells = []
    for k, sp in enumerate(n.get('sprites', [])):
        if sp['texture'] is None: continue
        fn = f"{sp['texture']}_{sp['cropIndex']}.png"
        im = Image.open(os.path.join(OUTDIR, fn)).convert('RGBA')
        cells.append((k, im))
    if not cells: return
    w = max(im.width for _, im in cells)*scale + 70
    h = sum(im.height*scale + 8 for _, im in cells) + 8
    out = Image.new('RGBA', (w, h), bg)
    dr = ImageDraw.Draw(out)
    y = 4
    for k, im in cells:
        big = im.resize((im.width*scale, im.height*scale), Image.NEAREST)
        out.alpha_composite(big, (60, y))
        dr.text((4, y + big.height//2 - 6), f'p{k}', fill=(255,255,0,255))
        y += big.height + 8
    out.save(os.path.join(SCRATCH, fname))

montage('chk_montage_rank.png', 61)
montage('chk_montage_success.png', 75)
montage('chk_montage_combo.png', 68)
montage('chk_montage_fchain.png', 54, scale=3)
montage('chk_montage_base.png', 4, scale=1)
montage('chk_montage_start_txt.png', 121, scale=1)
montage('chk_montage_warning.png', 33, scale=1)
montage('chk_montage_coverinfo.png', 109, scale=1)
montage('chk_montage_score_digits.png', 36, scale=3)
montage('chk_montage_level.png', 41, scale=2)
montage('chk_montage_westar.png', 45, scale=3)

# ---------------------------------------------------------------- anim analysis
def anim_state_report(anim):
    """per node/target: static value vs value at first & last key of the track"""
    rows = []
    for mot in anim['motions']:
        ni = mot['node']
        n = nodes[ni] if ni is not None and ni < len(nodes) else None
        for trk in mot['tracks']:
            if not trk['keys']: continue
            tgt = trk['targetName']
            static = None
            if n:
                static = {'PosX': n['pos'][0], 'PosY': n['pos'][1], 'Display': n['visible'],
                          'ScaleX': n['scale'][0], 'ScaleY': n['scale'][1],
                          'CropIndex0': (n.get('cast') or {}).get('defaultPattern46'),
                          'MaterialColorAlpha': n['materialColor'][0]}.get(tgt)
            rows.append({'node': ni, 'nodeName': n['name'] if n else None, 'target': tgt,
                         'static': static,
                         'firstFrame': trk['keys'][0]['frame'], 'firstValue': trk['keys'][0].get('value'),
                         'lastFrame': trk['keys'][-1]['frame'], 'lastValue': trk['keys'][-1].get('value'),
                         'numKeys': len(trk['keys'])})
    return rows

anim_reports = {a['name']: anim_state_report(a) for a in anims}

# ---------------------------------------------------------------- text dump
def fmt_pat(n, k, sp):
    if sp['texture'] is None:
        return f'pat[{k}] EMPTY'
    return f"pat[{k}] {sp['texture']} crop{sp['cropIndex']} {sp['rect']}"

with open(os.path.join(SCRATCH, 'chuni_musicbox_tree.txt'), 'w', encoding='utf-8') as fh:
    fh.write(f'source: {SRD}\nscene: {SCENE}  layer: {LAYER}  ({len(nodes)} nodes)\n')
    fh.write(f'CSS origin = top-left of 454x610 decide frame (layer-local {ORIGIN_X:g},{ORIGIN_Y:g});\n')
    fh.write(f'  card base C_music_box_base_00 438x584 at CSS (8,13). cssX=layerX+227, cssY=layerY+305\n')
    fh.write(f'fonts: {fonts}\n\n')
    for n in nodes:
        ind = '  ' * n.get('depth', 0)
        fh.write(f"{ind}[{n['index']:3d}] {n['name']}  type={n['castType']} vis={n['visible']} prio={n['prio']}\n")
        fh.write(f"{ind}      local pos=({n['pos'][0]:g},{n['pos'][1]:g}) scale=({n['scale'][0]:g},{n['scale'][1]:g})"
                 f" cssPos=({n['cssPos']['x']:g},{n['cssPos']['y']:g}) matColor(ARGB)={tuple(n['materialColor'])}\n")
        if 'cast' in n:
            c = n['cast']
            fh.write(f"{ind}      cast={c['kind']} size=({c['size'][0]:g},{c['size'][1]:g})"
                     f" pivot=({c['pivot'][0]:g},{c['pivot'][1]:g}) anchor={c['anchor4b']} flags49={c['flags49']:#x}")
            if 'cssBox' in n:
                b = n['cssBox']
                fh.write(f" -> CSS box left={b['left']:g} top={b['top']:g} w={b['width']:g} h={b['height']:g}")
            fh.write('\n')
            if c.get('defaultPattern46') not in (None,):
                fh.write(f"{ind}      defaultPattern={c['defaultPattern46']}\n")
            if 'numParams' in c:
                fh.write(f"{ind}      numParams={c['numParams']}\n")
        for k, sp in enumerate(n.get('sprites', [])):
            ver, lab = label_for(n, k)
            labtxt = f"  <-- {lab}{' (VERIFIED)' if ver=='v' and lab else ''}" if lab else ''
            fh.write(f"{ind}        {fmt_pat(n,k,sp)}{labtxt}\n")
        if 'textCast' in n:
            t = n['textCast']
            fh.write(f"{ind}      TEXT font={t['fontFile']} (idx {t['fontIndex']}) sizeHint={t['sizeHint78']}"
                     f" scale=({t['textScale'][0]:g},{t['textScale'][1]:g}) margins={t['margins7b']}"
                     f" lineH={t['lineHeight41']} preview={t['previewText']!r}\n")
        fp = n['attrs'].get('FontParamData')
        if fp:
            fh.write(f"{ind}      FontParam {dict(fp)}\n")
        for k2, v in n['attrs'].items():
            if k2.startswith('CastEventData'):
                fh.write(f"{ind}      EVENT {v.get('Event')} (action={v.get('TestAction')})\n")
    fh.write('\n\n================ ANIMATIONS ================\n')
    for a in anims:
        fh.write(f"\nanim {a['name']}  (motions={len(a['motions'])})\n")
        for r in anim_reports[a['name']]:
            fh.write(f"  [{r['node']:3d}] {str(r['nodeName']):<38s} {r['target']:<18s}"
                     f" static={r['static']} first@{r['firstFrame']}={r['firstValue']}"
                     f" last@{r['lastFrame']}={r['lastValue']} keys={r['numKeys']}\n")

payload = {'source': SRD, 'scene': SCENE, 'layer': LAYER, 'fonts': fonts,
           'cssOrigin': manifest['cssOrigin'], 'nodes': nodes,
           'anims': anims, 'animStateReports': anim_reports}
with open(os.path.join(SCRATCH, 'chuni_musicbox_tree.json'), 'w', encoding='utf-8') as fh:
    json.dump(payload, fh, indent=1, ensure_ascii=False, default=str)

print('nodes:', len(nodes), 'anims:', [a['name'] for a in anims])
print('sprites cut:', len(manifest['sprites']))
print('wrote', os.path.join(SCRATCH, 'chuni_musicbox_tree.txt'))
print('wrote', os.path.join(OUTDIR, 'manifest_musicbox.json'))

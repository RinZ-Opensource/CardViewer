#!/usr/bin/env python3
"""
Extract the CHUNITHM in-play music-info panel (layer L_Playing_music, plus the
overlapping right half of L_Playing_difficulty) from a VTBF/SurfRide ``SRFF``
file.

Outputs
  <scratchpad>/chuni_musicinfo_tree.txt      human-readable layout dump
  <scratchpad>/chuni_musicinfo_tree.json     machine-readable layout dump
  <output-dir>/*.png
  <output-dir>/manifest.json

Format knowledge (established by probe_srd_1..6.py in this scratchpad):
  file = 'VTBF' hdr + sequence of 'vtc0' records; record = tag(4cc) u16 u16 fields
  field = u8 subtag, u8 type; types: 00 marker(fc=struct start,fe=sep,fd=end),
    01/03/04 u8, 02 str(u8 or 15-bit len), 05 i16, 06 u16, 07/09 i32, 08/0b u32,
    0a f32, 0c rgba, 45/4a/4b vec of u16/f32/i32 (count = byte+2), 8x arrays.
  NODE: per-cast groups: 0x03 name, 0x30 flags (low nibble = cast type:
        0 null, 1 image(+text), 2 slice, 4 number), 0x3c child idx, 0x3d sibling idx (i16, -1 none)
  TRS2: per-cast groups: 0x34 pos vec2f, 0x35 rot u32, 0x36 scale vec2f, 0x3b visible u8,
        0x3a material rgba, 0x33 illum rgba, 0x3e u16 (prio), 0x3f u16
  CIMG: 0x51 owner node idx, 0x40/0x41 w/h, 0x42/0x43 pivot x/y, 0x49 flags (0x100 = has TEXT),
        0x46 default pattern idx, 0x45 crop-ref count, 0x44 x4 vertex colors, 0x4b anchor code
  CNUM: same + 0x80..0x94 number params (0x83/0x84 digit cell w/h, 0x81 preview value)
  TEXT: 0x78 i32 (px size hint), 0x79 i16 font index -> FONT table, 0x7a str preview text,
        0x36 vec2 text scale, 0x7b vec4 margins, 0x41 i16 line height
  CREF/CRE1: 0x4a vec2 u16 = (textureIndex, cropIndex); one record per data cast, N refs
  TEX : 0x61 name (-> <texture-dir>/<name>.dds, DXT5), TEX order = index
  CROP: 0x65 vec4 u16 (l,t,r,b) exclusive; order within record = crop index for that texture
  CATR: 0x51 node idx, pairs 0x03 kind / 0x0f 'k#v,k#v' (FontParamData, CastEventData*, ...)
  ANIM 0x03 name; MOT 0x51 node idx, 0x52 #tracks; TRK 0x53 curve target id, 0x57 #keys,
        0x58/0x59 first/last frame; KEY groups: 0x5a frame, 0x5b value (f32 or u32 by target),
        0x5c interp, 0x5d/0x5e tangents.
  Curve targets (verified against data): 0 PosX, 1 PosY, 6/7 ScaleX/Y, 10 Display,
        11 Width, 17 CropIndex0, 21 MaterialColorAlpha.
Coordinate system: scene 1920x1080, origin TOP-LEFT, +Y down. Absolute position =
  parent_abs + local_pos * parent_accumulated_scale. Cast top-left = abs - pivot*scale.
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
        default=(surfboard_root / "play/musicInfo/CHU_UI_Playing_00_v10.srd") if surfboard_root else None,
        help="Input CHU_UI_Playing_00_v10.srd (default: derived from CARDVIEWER_CHUNI_SURFBOARD_ROOT).",
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
        help="Layout dump output directory (default: this script directory).",
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
FRAME_W, FRAME_H = 1920, 1080

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
    """parse CATR 'k#v,k#v' strings (Param####-style runs of # are kept raw)"""
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

texs = []          # [(name, w, h)]
crops_by_tex = []  # [[(l,t,r,b), ...]]
fonts = []
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

# layer record blocks (LAYR ... until next LAYR/SCN-level record)
layer_blocks, layer_order, cur = {}, [], None
for offr, body in recs:
    t4 = body[0:4]
    if t4 == b'LAYR':
        _,a,b_,f = parse_fields(body)
        cur = [v for s,ty,v in f if ty=='str'][0]
        layer_blocks[cur] = []
        layer_order.append(cur)
    elif t4 in (b'SCN ', b'ANMS', b'TEXL', b'FONT', b'CAM '):
        cur = None
    if cur: layer_blocks[cur].append((offr, body))

# ---------------------------------------------------------------- layer parser
def parse_layer(name):
    blk = layer_blocks[name]
    nodes, trs, datas, anims = [], [], [], []
    catr_by_node = {}
    for offr, body in blk:
        t4 = body[0:4]
        if t4 == b'NODE':
            _,a,b_,f = parse_fields(body)
            nodes = split_groups(f)
        elif t4 == b'TRS2':
            _,a,b_,f = parse_fields(body)
            trs = split_groups(f)
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
            anims.append({'name': [v for s,ty,v in f if ty=='str'][0], 'motions': []})
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
            key = None
            for s,ty,v in f:
                if s == 0x5a:
                    key = {'frame': v}; trk['keys'].append(key)
                elif key is not None:
                    key[{0x5b:'value',0x5c:'interp',0x5d:'tanIn',0x5e:'tanOut'}.get(s, f's{s:02x}')] = v

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
            'f3f': tr.get(0x3f, [0])[0],
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
                texname = texs[ti][0] if ti < len(texs) else None
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

    # absolute transforms: origin top-left, +Y down
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
    return {'layer': name, 'nodes': out_nodes, 'anims': anims}

music = parse_layer('L_Playing_music')
diff  = parse_layer('L_Playing_difficulty')

# ------------------------------------------------- overlap filter for difficulty
# Panel box = PAT_base_left of L_Playing_difficulty (the difficulty-coloured base
# under the music info): x 1334..1920, y 0..182. Keep difficulty nodes whose box
# strictly intersects it.
PANEL = {'x': 1334.0, 'y': 0.0, 'w': 586.0, 'h': 182.0}
def overlaps_panel(n):
    if 'absBox' not in n: return False
    b = n['absBox']
    return (b['left'] + b['width'] > PANEL['x'] and b['left'] < PANEL['x'] + PANEL['w'] and
            b['top'] + b['height'] > PANEL['y'] and b['top'] < PANEL['y'] + PANEL['h'])
diff_overlap = [n for n in diff['nodes'] if overlaps_panel(n)]

# panel-relative (CSS) coordinates for every node that has a box
for layer in (music, diff):
    for n in layer['nodes']:
        if 'absBox' in n:
            b = n['absBox']
            n['cssBox'] = {'left': round(b['left'] - PANEL['x'], 3), 'top': round(b['top'] - PANEL['y'], 3),
                           'width': b['width'], 'height': b['height']}
        if 'abs' in n:
            n['cssPos'] = {'x': round(n['abs']['x'] - PANEL['x'], 3), 'y': round(n['abs']['y'] - PANEL['y'], 3)}

# ---------------------------------------------------------------- rest-pose check
def rest_pose_report(layer):
    rep = []
    for anim in layer['anims']:
        a = {'anim': anim['name'], 'tracks': []}
        for mot in anim['motions']:
            nname = layer['nodes'][mot['node']]['name'] if mot['node'] is not None and mot['node'] < len(layer['nodes']) else mot['node']
            for trk in mot['tracks']:
                keys = trk['keys']
                a['tracks'].append({
                    'node': mot['node'], 'nodeName': nname,
                    'target': trk['targetName'],
                    'frames': [k['frame'] for k in keys][:4] + (['...'] if len(keys) > 4 else []),
                    'firstValue': keys[0]['value'] if keys else None,
                    'lastValue': keys[-1]['value'] if keys else None,
                    'lastFrame': trk['lastFrame'],
                })
        rep.append(a)
    return rep

music['restPose'] = rest_pose_report(music)
diff['restPose'] = rest_pose_report(diff)

# static-vs-anim confidence: does any anim move a node's PosX/PosY away from static at its end?
conf = []
for anim in music['anims']:
    for mot in anim['motions']:
        node = music['nodes'][mot['node']]
        for trk in mot['tracks']:
            if trk['targetName'] in ('PosX','PosY') and trk['keys']:
                stat = node['pos'][0] if trk['targetName']=='PosX' else node['pos'][1]
                conf.append({'anim': anim['name'], 'node': node['name'], 'target': trk['targetName'],
                             'staticValue': stat, 'animEndValue': trk['keys'][-1]['value'],
                             'matchesStatic': abs(stat - trk['keys'][-1]['value']) < 0.001})
music['staticVsAnimEnd'] = conf

# ---------------------------------------------------------------- text tree dump
def dump_tree(layer, fh, only_nodes=None):
    fh.write(f"### layer {layer['layer']}\n")
    for n in layer['nodes']:
        if only_nodes is not None and n not in only_nodes: continue
        ind = '  ' * n.get('depth', 0)
        fh.write(f"{ind}[{n['index']:2d}] {n['name']}  type={n['castType']} visible={n['visible']}\n")
        fh.write(f"{ind}     local pos=({n['pos'][0]:g},{n['pos'][1]:g}) scale=({n['scale'][0]:g},{n['scale'][1]:g})"
                 f" abs=({n['abs']['x']:g},{n['abs']['y']:g}) matColor(ARGB)={tuple(n['materialColor'])}\n")
        if 'cast' in n:
            c = n['cast']
            fh.write(f"{ind}     cast={c['kind']} size=({c['size'][0]:g},{c['size'][1]:g})"
                     f" pivot=({c['pivot'][0]:g},{c['pivot'][1]:g})")
            if 'absBox' in n:
                b = n['absBox']; c = n['cssBox']
                fh.write(f" -> box x={b['left']:g} y={b['top']:g} w={b['width']:g} h={b['height']:g}"
                         f" | panelRel x={c['left']:g} y={c['top']:g}")
            fh.write('\n')
            if c.get('defaultPattern46') not in (None, 0):
                fh.write(f"{ind}     defaultPatternIndex={c['defaultPattern46']}\n")
        for sp in n.get('sprites', [])[:40]:
            fh.write(f"{ind}       sprite[{n['sprites'].index(sp)}] {sp['texture']} crop{sp['cropIndex']} rect={sp['rect']}\n")
        if 'textCast' in n:
            t = n['textCast']
            fh.write(f"{ind}     TEXT font={t['fontFile']} (idx {t['fontIndex']}) sizeHint={t['sizeHint78']}"
                     f" scale=({t['textScale'][0]:g},{t['textScale'][1]:g}) preview={t['previewText']!r}\n")
        fp = n['attrs'].get('FontParamData')
        if fp:
            keep = {k: fp[k] for k in ('pointX','pointY','wordWrap','monospaced','noWrapPutMode',
                                       'scrollSpeed','scrollWait','shadowX','shadowY') if k in fp}
            fh.write(f"{ind}     FontParam {keep}\n")
        for k, v in n['attrs'].items():
            if k.startswith('CastEventData'):
                fh.write(f"{ind}     EVENT {v.get('Event')} (action={v.get('TestAction')})\n")
    fh.write('\n')

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
    img = teximg(name)
    l, t, r, b = rect
    out = img.crop((l, t, r, b))
    fn = f'{name}_{ci}.png'
    out.save(os.path.join(OUTDIR, fn))
    return fn, list(rect), [r - l, b - t]

def avg_rgb(fn):
    im = Image.open(os.path.join(OUTDIR, fn)).convert('RGBA')
    px = list(im.getdata())
    opaque = [(r,g,b) for r,g,b,a in px if a > 128]
    if not opaque: return None
    n = len(opaque)
    return [round(sum(c[i] for c in opaque)/n) for i in range(3)]

manifest = {'source': SRD, 'frame': [FRAME_W, FRAME_H],
            'panelBox': None, 'sprites': []}

def add_sprites(layer, node, purposes=None):
    n = layer['nodes'][node]
    ent = []
    for k, sp in enumerate(n.get('sprites', [])):
        fn, rect, size = cut(sp['texIndex'], sp['cropIndex'])
        e = {'layer': layer['layer'], 'nodeIndex': n['index'], 'node': n['name'],
             'patternIndex': k, 'purpose': purposes[k] if purposes and k < len(purposes) else None,
             'texture': sp['texture'], 'cropIndex': sp['cropIndex'],
             'rect_ltrb': rect, 'size': size, 'file': fn, 'avgRGB': avg_rgb(fn)}
        manifest['sprites'].append(e); ent.append(e)
    return ent

# L_Playing_music casts  (labels visually verified from cut pixels, see zoom_check.png)
add_sprites(music, 2,  ['option_bar_speed_mirror_labels'])   # black strip: 'スピード設定：| ミラー設定：'
add_sprites(music, 3,  ['speed_sonic_label'])                # white 'SONIC'
add_sprites(music, 4,  [f'speed_digit_{i}' for i in range(10)] + ['speed_decimal_dot'])
add_sprites(music, 5,  ['mirror_OFF (pattern 0, default)', 'mirror_ON (pattern 1)'])  # verified: crop25='OFF', crop24='ON'
add_sprites(music, 7,  ['jacket_dummy_300x300'])
add_sprites(music, 12, [f'level_digit_{i}' for i in range(10)])
add_sprites(music, 13, ['level_plus_mark'])                  # '+'
add_sprites(music, 15, [f'we_stars_hollow_{(i+1)*0.5:g}' for i in range(10)] +
                       [f'we_stars_filled_{(i+1)*0.5:g}' for i in range(10)])  # rows verified: y57 hollow, y73 gold
add_sprites(music, 18, ['lv_label_pattern_0 (EMPTY in this texture)',
                        'lv_label_pattern_1 (EMPTY)', 'lv_label_pattern_2 (EMPTY)',
                        'lv_label_pattern_3_default (EMPTY)'])  # parent DIS_level_LV visible=0; dead element
add_sprites(music, 20, [f'track_digit_{i}' for i in range(10)])
# L_Playing_difficulty PAT_base_left (overlaps panel). Pattern index = difficulty id.
# Verified from pixels: pat0 'TRACK BASIC' green, pat4 'TRACK ULTIMA' black/red,
# pat5 'TRACK WORLD'S END' rainbow, pat6 'TRACK TUTORIAL' gold; pat1/2 by colour.
add_sprites(diff, 1, ['panel_base_BASIC (pattern 0)', 'panel_base_ADVANCED (pattern 1)',
                      'panel_base_EXPERT (pattern 2)', 'panel_base_MASTER (pattern 3)',
                      'panel_base_ULTIMA (pattern 4)', "panel_base_WORLDS_END (pattern 5)",
                      'panel_base_TUTORIAL (pattern 6)'])

# panel box := PAT_base_left box (the difficulty-coloured base under the music info)
base = diff['nodes'][1]['absBox']
manifest['panelBox'] = {'x': base['left'], 'y': base['top'],
                        'w': base['width'], 'h': base['height']}

with open(os.path.join(OUTDIR, 'manifest.json'), 'w', encoding='utf-8') as fh:
    json.dump(manifest, fh, indent=2, ensure_ascii=False)

# ---------------------------------------------------------------- write dumps
with open(os.path.join(SCRATCH, 'chuni_musicinfo_tree.txt'), 'w', encoding='utf-8') as fh:
    fh.write(f'source: {SRD}\nscene: 1920x1080, origin top-left, +Y down\n'
             f'fonts: {fonts}\n\n')
    dump_tree(music, fh)
    fh.write('### L_Playing_difficulty (only nodes overlapping the music panel region x>=1300,y<200)\n')
    dump_tree(diff, fh, only_nodes=diff_overlap)
    fh.write('### rest-pose / animation end values (L_Playing_music)\n')
    for a in music['restPose']:
        fh.write(f"  anim {a['anim']}\n")
        for t in a['tracks']:
            fh.write(f"    node[{t['node']}] {t['nodeName']:<40s} {t['target']:<20s} "
                     f"first={t['firstValue']} last={t['lastValue']} (lastFrame={t['lastFrame']})\n")
    fh.write('\n### static TRS2 vs animation end value (PosX/PosY tracks)\n')
    for c in music['staticVsAnimEnd']:
        fh.write(f"  {c['anim']:<14s} {c['node']:<20s} {c['target']}: static={c['staticValue']} "
                 f"animEnd={c['animEndValue']} match={c['matchesStatic']}\n")

payload = {'source': SRD, 'frame': [FRAME_W, FRAME_H], 'fonts': fonts,
           'L_Playing_music': music,
           'L_Playing_difficulty_overlapping': {'layer': 'L_Playing_difficulty',
               'note': 'only nodes whose box intersects the panel region; full anims included',
               'nodes': diff_overlap, 'anims': diff['anims'], 'restPose': diff['restPose']}}
with open(os.path.join(SCRATCH, 'chuni_musicinfo_tree.json'), 'w', encoding='utf-8') as fh:
    json.dump(payload, fh, indent=1, ensure_ascii=False, default=str)

print('wrote', os.path.join(SCRATCH, 'chuni_musicinfo_tree.txt'))
print('wrote', os.path.join(SCRATCH, 'chuni_musicinfo_tree.json'))
print('wrote', len(manifest['sprites']), 'sprites to', OUTDIR)
print('panelBox', manifest['panelBox'])

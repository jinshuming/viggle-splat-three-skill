#!/usr/bin/env python3
"""Repair one arm over a frame range of a 441-bone MetaHuman GLB motion.

Replaces upperarm / lowerarm / hand (+ relaxed fingers) with a hanging pose for frames
[0, END], then blends back to the original pose over BLEND frames. Optional swing: the arm
abducts further at one frame and eases back (cosine bump).  Rotations are written in place
(int16 normalised quaternions), so the file keeps its size and structure.

  python3 repair_arm.py clip.glb --side r --end 112 --abduct 25 \
      --swing-frame 52 --swing-extra 19 --swing-width 18 --out fixed.glb

The first run copies the input to <dir>/_backup/<name>.orig.glb; later runs read that backup,
so you can re-run with new numbers without compounding edits.
"""
import argparse, math, os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glblib import *

ap = argparse.ArgumentParser()
ap.add_argument('glb'); ap.add_argument('--out')
ap.add_argument('--side', choices=['r', 'l'], default='r')
ap.add_argument('--start', type=int, default=0, help='first frame to repair')
ap.add_argument('--end', type=int, required=True, help='last repaired frame; original pose is back in full here')
ap.add_argument('--blend', type=int, default=20, help='frames used to blend back to the original ending at --end')
ap.add_argument('--abduct', type=float, default=20, help='degrees the hanging arm sits away from the vertical')
ap.add_argument('--elbow', type=float, default=8, help='residual elbow bend in degrees (0 = straight)')
ap.add_argument('--beta', type=float, default=25, help='degrees the bind-pose arm sits above horizontal (measure in the viewer)')
ap.add_argument('--axis', default='x', choices=['x', 'y', 'z'], help='local axis of the upper arm that abducts it (axis_probe.py finds it)')
ap.add_argument('--axis-sign', type=float, default=-1, help='-1 if rotating about +axis by a negative angle lowers the arm')
ap.add_argument('--swing-frame', type=int); ap.add_argument('--swing-extra', type=float, default=0)
ap.add_argument('--swing-width', type=int, default=18)
ap.add_argument('--finger-relax', type=float, default=0.6, help='0 = straight fingers, 1 = original mean curl')
a = ap.parse_args()

src = a.glb
bak = os.path.join(os.path.dirname(src), '_backup', os.path.basename(src).replace('.glb', '.orig.glb'))
d0, j, bo, _ = load(bak if os.path.exists(bak) else src)
d = bytearray(d0)
nodes = j['nodes']; an = j['animations'][0]
N = {n.get('name'): i for i, n in enumerate(nodes)}
parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
acc = {c['target']['node']: an['samplers'][c['sampler']]['output'] for c in an['channels'] if c['target']['path'] == 'rotation'}
rot = {k: read(j, d, bo, v) for k, v in acc.items()}
bind = lambda k: tuple(nodes[k].get('rotation', (0, 0, 0, 1)))
dot = lambda p, q: sum(x * y for x, y in zip(p, q))
def axang(ax, ang):
    s = math.sin(ang / 2); return (ax[0] * s, ax[1] * s, ax[2] * s, math.cos(ang / 2))
AX = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[a.axis]

ua, la, ha = N['upperarm_' + a.side], N['lowerarm_' + a.side], N['hand_' + a.side]
sub = []
def walk(k):
    for c in nodes[k].get('children', []): sub.append(c); walk(c)
walk(ua)
twist = [k for k in sub if 'twist' in nodes[k]['name']]
fingers = [k for k in sub if any(t in nodes[k]['name'] for t in ('pinky', 'ring_', 'thumb', 'middle', 'index'))]

# elbow hinge axis = axis of the original frame-0 forearm rotation, re-used at a smaller angle
dl = qmul(qconj(bind(la)), rot[la][0]); dl = dl if dl[3] >= 0 else tuple(-c for c in dl)
sn = math.sqrt(max(1e-12, 1 - dl[3] ** 2)); hinge = tuple(c / sn for c in dl[:3])

def meanq(seq):
    acc_ = [0, 0, 0, 0]
    for q in seq:
        if dot(q, seq[0]) < 0: q = tuple(-c for c in q)
        acc_ = [x + y for x, y in zip(acc_, q)]
    return qnorm(tuple(acc_))
relaxed = {k: slerp(bind(k), meanq(rot[k][a.start:a.end]), a.finger_relax) for k in fingers}

def abduct(f):
    v = a.abduct
    if a.swing_frame is not None and abs(f - a.swing_frame) < a.swing_width:
        v += a.swing_extra * 0.5 * (1 + math.cos(math.pi * (f - a.swing_frame) / a.swing_width))
    return v
def weight(f):  # 0 = fully repaired, 1 = original
    if f < a.start or f > a.end: return 1.0
    t0 = a.end - a.blend
    if f <= t0: return 0.0
    t = (f - t0) / a.blend; return t * t * (3 - 2 * t)

NF = len(rot[ua]); new = {k: list(rot[k]) for k in [ua, la, ha] + twist + fingers}
for f in range(a.start, min(a.end + 1, NF)):
    w = weight(f)
    if w >= 1: continue
    hang_ua = qmul(bind(ua), axang(AX, a.axis_sign * math.radians(90 + a.beta - abduct(f))))
    hang_la = qmul(bind(la), axang(hinge, math.radians(a.elbow)))
    new[ua][f] = slerp(hang_ua, rot[ua][f], w)
    new[la][f] = slerp(hang_la, rot[la][f], w)
    new[ha][f] = slerp(bind(ha), rot[ha][f], w)
    for k in twist: new[k][f] = slerp(bind(k), rot[k][f], w)
    for k in fingers: new[k][f] = slerp(relaxed[k], rot[k][f], w)
for seq in new.values():  # keep quaternions on one hemisphere so interpolation never takes the long way
    for f in range(1, len(seq)):
        if dot(seq[f], seq[f - 1]) < 0: seq[f] = tuple(-c for c in seq[f])
for k, seq in new.items(): write(j, d, bo, acc[k], seq)
if not os.path.exists(bak):
    os.makedirs(os.path.dirname(bak), exist_ok=True); shutil.copy(src, bak)
out = a.out or src
open(out, 'wb').write(bytes(d))
print(f'wrote {out}: arm {a.side}, frames {a.start}-{a.end}, blend {a.blend}, abduct {a.abduct} deg'
      + (f', swing @{a.swing_frame} +{a.swing_extra}' if a.swing_frame is not None else ''))

#!/usr/bin/env python3
"""Write a calibration clip: the chosen arm is rotated about each local axis in turn, so you can
see in the viewer which axis/sign lowers it in the screen plane (see SKILL.md, step 3).

  python3 axis_probe.py clip.glb --side r --out probe.glb
Frames 20-35: +X 60 deg, 35-50: -X 60, 50-65: +Y 60, 65-80: -Y 60 (lower arm and hand at bind).
"""
import argparse, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glblib import *
ap = argparse.ArgumentParser(); ap.add_argument('glb'); ap.add_argument('--side', default='r'); ap.add_argument('--out', required=True)
a = ap.parse_args()
d0, j, bo, _ = load(a.glb); d = bytearray(d0); nodes = j['nodes']; an = j['animations'][0]
N = {n.get('name'): i for i, n in enumerate(nodes)}
acc = {c['target']['node']: an['samplers'][c['sampler']]['output'] for c in an['channels'] if c['target']['path'] == 'rotation'}
ax = lambda v, t: (v[0] * math.sin(t / 2), v[1] * math.sin(t / 2), v[2] * math.sin(t / 2), math.cos(t / 2))
V = [(20, 35, (1, 0, 0), 60), (35, 50, (1, 0, 0), -60), (50, 65, (0, 1, 0), 60), (65, 80, (0, 1, 0), -60)]
for nm in ('upperarm_', 'lowerarm_', 'hand_'):
    k = N[nm + a.side]; seq = list(read(j, d, bo, acc[k])); b = tuple(nodes[k]['rotation'])
    for f in range(len(seq)):
        for s, e, v, deg in V:
            if s <= f < e: seq[f] = qmul(b, ax(v, math.radians(deg))) if nm == 'upperarm_' else b
    write(j, d, bo, acc[k], seq)
open(a.out, 'wb').write(bytes(d)); print('wrote', a.out)

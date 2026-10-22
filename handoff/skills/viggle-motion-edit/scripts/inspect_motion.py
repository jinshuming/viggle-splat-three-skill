#!/usr/bin/env python3
"""Read-only GLB preflight for @viggle/splat-engine-three.

Accepts 441-bone motions and body-only motions (the 86 body bones, indices 0-85).
Only joints whose names match the canonical 441 rig are checked; others are ignored.
"""
import argparse
import json
import math
import struct
import sys
from pathlib import Path

MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
BODY_BONES = 86
COMPONENTS = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}


def load_glb(path):
    raw = path.read_bytes()
    if len(raw) < 20 or struct.unpack_from('<I', raw)[0] != MAGIC:
        raise ValueError('not a glTF 2.0 GLB')
    if struct.unpack_from('<I', raw, 4)[0] != 2:
        raise ValueError('GLB version is not 2')
    declared = struct.unpack_from('<I', raw, 8)[0]
    if declared != len(raw):
        raise ValueError(f'GLB declared length {declared} differs from file length {len(raw)}')
    off, doc, binary = 12, None, None
    while off + 8 <= len(raw):
        length, kind = struct.unpack_from('<II', raw, off)
        off += 8
        if off + length > len(raw):
            raise ValueError('GLB chunk overruns file')
        if kind == JSON_CHUNK:
            doc = json.loads(raw[off:off + length])
        elif kind == BIN_CHUNK:
            binary = raw[off:off + length]
        off += length
    if doc is None or binary is None:
        raise ValueError('GLB needs embedded JSON and BIN chunks')
    return doc, binary


def accessor_values(doc, binary, index, expected_type=None):
    acc = doc['accessors'][index]
    typ = acc['type']
    if expected_type and typ != expected_type:
        raise ValueError(f'accessor {index}: expected {expected_type}, got {typ}')
    comps = COMPONENTS.get(typ)
    if not comps:
        raise ValueError(f'accessor {index}: unsupported type {typ}')
    view = doc['bufferViews'][acc['bufferView']]
    if view.get('byteStride', 0):
        raise ValueError(f'accessor {index}: interleaved buffer is unsupported by target reader')
    ct = acc['componentType']
    if ct == 5126:
        fmt, width = 'f', 4
    elif ct == 5122 and acc.get('normalized'):
        fmt, width = 'h', 2
    else:
        raise ValueError(f'accessor {index}: expected FLOAT or normalized SHORT, got {ct}')
    count = acc['count'] * comps
    off = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    end = off + count * width
    if end > len(binary):
        raise ValueError(f'accessor {index}: overruns BIN chunk')
    vals = struct.unpack_from('<' + fmt * count, binary, off)
    if fmt == 'h':
        vals = tuple(max(v / 32767, -1) for v in vals)
    if not all(math.isfinite(v) for v in vals):
        raise ValueError(f'accessor {index}: non-finite value')
    return vals


def inspect(path, rig):
    doc, binary = load_glb(path)
    errors, notes = [], []
    bones = rig['bones']
    canonical = [b['name'] for b in bones]
    nameset = set(canonical)
    skins = doc.get('skins') or []
    nodes = doc.get('nodes') or []
    if not skins or not skins[0].get('joints'):
        raise ValueError('skins[0].joints is missing; canonical rig cannot be confirmed')
    joints = skins[0]['joints']
    names = [nodes[i].get('name', f'#{i}') for i in joints]
    body = {b['name'] for b in bones if b['index'] < BODY_BONES}
    duplicates = sorted({n for n in names if names.count(n) > 1})
    matched = [n for n in names if n in nameset]
    matched_set = set(matched)
    missing_body = sorted(body - matched_set)
    extra = sorted(set(names) - nameset)
    face_matched = len(matched_set - body)
    if duplicates:
        errors.append(f'duplicate joint names: {duplicates[:8]}')
    if missing_body:
        errors.append(f'missing body bones ({len(missing_body)} of {BODY_BONES}): {missing_body[:8]}')
    if extra:
        notes.append(f'{len(extra)} joints not in the canonical rig are ignored: {extra[:8]}')
    if face_matched == 0:
        profile = 'body-86'
    elif len(matched_set) == len(bones):
        profile = 'full-441'
    else:
        profile = f'body-86+{face_matched}-facial'
    notes.append(f'profile {profile}: {len(matched_set)} of {len(bones)} canonical bones matched')
    reordered = matched != [n for n in canonical if n in matched_set]
    if reordered and not duplicates:
        notes.append('joint order differs; target GLB reader resolves the canonical rig by name')
    animations = doc.get('animations') or []
    if not animations:
        errors.append('no animation clip')
        return {'file': str(path), 'ok': False, 'errors': errors, 'notes': notes}
    joint_nodes = {j for j, n in zip(joints, names) if n in nameset}
    matched_joints = [j for j in joints if j in joint_nodes]
    reports = []
    for anim in animations:
        track = {}
        ignored = 0
        for ch in anim.get('channels', []):
            target = ch.get('target', {})
            node, prop = target.get('node'), target.get('path')
            if node not in joint_nodes:
                ignored += 1
                continue
            if prop not in {'rotation', 'translation', 'scale'}:
                if prop != 'weights':
                    errors.append(f'unsupported channel path {prop}')
                continue
            key = (node, prop)
            if key in track:
                errors.append(f'duplicate {prop} channel on {nodes[node].get("name", node)}')
            track[key] = anim['samplers'][ch['sampler']]
        absent_rotation = [nodes[n].get('name', f'#{n}') for n in matched_joints if (n, 'rotation') not in track]
        if absent_rotation:
            errors.append(f'missing rotation channels ({len(absent_rotation)}): {absent_rotation[:8]}')
        timelines = {}
        face_moving = set()
        body_translation_moving = set()
        for (node, prop), sampler in track.items():
            mode = sampler.get('interpolation', 'LINEAR')
            if mode not in {'LINEAR', 'STEP', 'CUBICSPLINE'}:
                errors.append(f'unsupported interpolation {mode}')
                continue
            input_idx = sampler['input']
            if input_idx not in timelines:
                timelines[input_idx] = accessor_values(doc, binary, input_idx, 'SCALAR')
            times = timelines[input_idx]
            output_idx = sampler['output']
            vals = accessor_values(doc, binary, output_idx, {'translation':'VEC3','rotation':'VEC4','scale':'VEC3'}[prop])
            comps = 4 if prop == 'rotation' else 3
            expected = len(times) * comps * (3 if mode == 'CUBICSPLINE' else 1)
            if len(vals) != expected:
                errors.append(f'{nodes[node].get("name", node)} {prop}: {len(vals)} output floats, expected {expected}')
                continue
            if prop == 'translation' and len(times) > 1:
                stride = comps * (3 if mode == 'CUBICSPLINE' else 1)
                start = comps if mode == 'CUBICSPLINE' else 0
                base = vals[start:start+3]
                span = max(math.dist(base, vals[k*stride+start:k*stride+start+3]) for k in range(len(times)))
                name = nodes[node].get('name', '')
                if span > 1e-5:
                    (face_moving if name.startswith('FACIAL_') else body_translation_moving).add(name)
        main = max(timelines.values(), key=len, default=())
        if len(main) > 1:
            step = main[1] - main[0]
            if step <= 0 or any(abs((main[i] - main[i-1]) - step) > 1e-4 for i in range(2, len(main))):
                errors.append('main timeline is not a uniform increasing grid')
            for times in timelines.values():
                if len(times) not in (1, len(main)) or (len(times) == len(main) and any(abs(a-b)>1e-4 for a,b in zip(times,main))):
                    errors.append('channel timeline is neither one key nor the main grid')
                    break
        if len(body_translation_moving) > 2:
            notes.append(f'{len(body_translation_moving)} non-facial joints translate over time; check intended motion versus bone-length drift')
        reports.append({'name': anim.get('name', '<unnamed>'), 'frames': len(main), 'fps': round(1/(main[1]-main[0]), 4) if len(main)>1 else None,
                        'duration_seconds': round(main[-1]-main[0], 4) if main else None,
                        'facial_bones_with_varying_translation': len(face_moving),
                        'non_facial_bones_with_varying_translation': len(body_translation_moving),
                        'ignored_non_joint_channels': ignored})
    return {'file': str(path), 'ok': not errors, 'rig': rig['rig'], 'joint_count': len(joints), 'matched_bones': len(matched_set), 'profile': profile, 'canonical_order': not reordered,
            'clips': reports, 'errors': errors, 'notes': notes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('glb', type=Path)
    parser.add_argument('--json', action='store_true', help='machine-readable report')
    args = parser.parse_args()
    rig = json.loads((Path(__file__).resolve().parent.parent / 'references/rig-441.json').read_text())
    try:
        report = inspect(args.glb, rig)
    except (ValueError, KeyError, IndexError, struct.error, OSError) as exc:
        report = {'file':str(args.glb), 'ok':False, 'errors':[str(exc)], 'notes':[]}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(('PASS' if report['ok'] else 'FAIL') + ' ' + str(args.glb))
        if 'joint_count' in report:
            print(f"  joints={report['joint_count']}, matched={report['matched_bones']}, profile={report['profile']}, canonical_order={report['canonical_order']}")
        for clip in report.get('clips', []):
            print(f"  {clip['name']}: {clip['frames']} frames, {clip['fps']} fps, {clip['facial_bones_with_varying_translation']} facial translation tracks move")
        for x in report['notes']:
            print('  note:', x)
        for x in report['errors']:
            print('  error:', x)
    return 0 if report['ok'] else 1

if __name__ == '__main__':
    sys.exit(main())

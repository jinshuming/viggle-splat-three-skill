// body-shape.js - runtime body-shape control for @viggle/splat-engine-three characters.
//
// Re-proportion a PINOC-rig vsplat character at runtime (bone lengths, girth, head / hand /
// foot size, overall size, asymmetric limbs) with no new assets. Animations keep playing:
// the bind pose is untouched and clips never override bone lengths.
//
// The whole API is plain JSON in, plain JSON out:
//
//   import { applyBodyShape } from './body-shape.js';
//   const { lift } = applyBodyShape(character, {
//     spec:  { head: 2, legAlong: 0.55 },        // whole-body proportions (multipliers, 1 = unchanged)
//     bones: { upperarm_r: { along: 1.8 } },     // optional per-bone layer on top (asymmetry etc.)
//     size:  0.8,                                // optional uniform size
//   });
//
// `character` is a SplatCharacter (what VSplatLoader.loadAsync returns).

/**
 * @typedef {Object} ProportionSpec  Every value is a multiplier; 1 (or omitted) = unchanged.
 * @property {number} [head]            head (+ face bones) uniform size
 * @property {number} [neckAlong]       neck length
 * @property {number} [torsoAlong]      spine length
 * @property {number} [torsoGirthBase]  hips / belly girth
 * @property {number} [torsoGirthTop]   chest / shoulder girth (also widens shoulders)
 * @property {number} [limbAlong]       arm + leg length
 * @property {number} [limbGirth]       arm + leg thickness
 * @property {number} [armAlong]        arm length            (overrides limbAlong)
 * @property {number} [armGirth]        arm thickness         (overrides limbGirth)
 * @property {number} [legAlong]        leg length            (overrides limbAlong)
 * @property {number} [legGirth]        leg thickness         (overrides limbGirth)
 * @property {number} [hands]           hands + fingers uniform size
 * @property {number} [feet]            feet + toes uniform size
 */

/** @typedef {number | {along?: number, width?: number, thickness?: number}} BoneScale */

/**
 * @typedef {Object} BodyShape
 * @property {ProportionSpec} [spec]
 * @property {Record<string, BoneScale>} [bones]  per-bone scales by rig bone name, multiplied on top of `spec`
 * @property {number} [size]                      uniform scale of the whole character
 */

export const SPEC_KEYS = [
  'head', 'neckAlong', 'torsoAlong', 'torsoGirthBase', 'torsoGirthTop',
  'limbAlong', 'limbGirth', 'armAlong', 'armGirth', 'legAlong', 'legGirth', 'hands', 'feet',
];

/** Beyond this range flesh visibly tears / thins between stretched and unstretched bones. */
export const SAFE_RANGE = [0.3, 2.5];

// ---------------------------------------------------------------------------------------------
// Presets: the "brief -> first shape" table. Start from the closest one and tune by eye.
// ---------------------------------------------------------------------------------------------

/** @type {Record<string, {label: string, label_zh: string, shape: BodyShape}>} */
export const PRESETS = {
  default:    { label: 'Default',     label_zh: '默认',        shape: {} },
  chibi:      { label: 'Chibi',       label_zh: 'Q版/大头',    shape: { spec: { head: 2, neckAlong: 0.5, torsoAlong: 0.7, armAlong: 0.6, legAlong: 0.55, hands: 1.4, feet: 1.4 } } },
  supermodel: { label: 'Long legs',   label_zh: '长腿',        shape: { spec: { legAlong: 1.45, torsoAlong: 0.95, head: 0.9, legGirth: 0.8 } } },
  brute:      { label: 'Brute',       label_zh: '壮汉',        shape: { spec: { torsoGirthBase: 1.3, torsoGirthTop: 1.6, armGirth: 1.9, legGirth: 1.5, head: 0.85, neckAlong: 0.5 } } },
  heavy:      { label: 'Heavy',       label_zh: '胖',          shape: { spec: { torsoGirthBase: 1.7, torsoGirthTop: 1.4, limbGirth: 1.3 } } },
  skinny:     { label: 'Skinny',      label_zh: '瘦',          shape: { spec: { torsoGirthBase: 0.75, torsoGirthTop: 0.8, limbGirth: 0.7 } } },
  gibbon:     { label: 'Long arms',   label_zh: '长臂',        shape: { spec: { armAlong: 1.9, hands: 1.3 } } },
  kid:        { label: 'Kid / dwarf', label_zh: '小孩/矮人',   shape: { size: 0.6, spec: { head: 1.3, legAlong: 0.7 } } },
  giant:      { label: 'Giant',       label_zh: '巨人',        shape: { size: 1.8 } },
};

// ---------------------------------------------------------------------------------------------
// spec -> per-bone factors
// ---------------------------------------------------------------------------------------------

const FINGER = /^(thumb|index|middle|ring|pinky)_(metacarpal|\d\d)_[lr]$/;
const TOE = /^(big|index|middle|ring|little)toe_\d\d_[lr]$/;
const FACIAL = /^FACIAL_/;

const is1 = (v) => v === undefined || Math.abs(v - 1) < 1e-6;

/** Merge a BoneScale into an accumulator by multiplying each axis. */
function mul(acc, name, s) {
  const n = typeof s === 'number' ? { along: s, width: s, thickness: s } : s;
  const a = (acc[name] ??= { along: 1, width: 1, thickness: 1 });
  if (n.along !== undefined) a.along *= n.along;
  if (n.width !== undefined) a.width *= n.width;
  if (n.thickness !== undefined) a.thickness *= n.thickness;
}

/**
 * Expand a `ProportionSpec` into per-bone scale factors for `armature.setBoneStretch`.
 * Handles what a flat per-bone map cannot: the spine girth taper, left/right symmetry, and
 * the finger / toe / face bones following their parent.
 *
 * @param {readonly string[]} rigBoneNames  `character.armature.rigBoneNames`
 * @param {ProportionSpec} [spec]
 * @returns {Record<string, {along: number, width: number, thickness: number}>}
 */
export function buildStretch(rigBoneNames, spec = {}) {
  const has = new Set(rigBoneNames);
  const out = {};
  const add = (name, s) => { if (has.has(name)) mul(out, name, s); };

  const armAlong = spec.armAlong ?? spec.limbAlong ?? 1;
  const legAlong = spec.legAlong ?? spec.limbAlong ?? 1;
  const armGirth = spec.armGirth ?? spec.limbGirth ?? 1;
  const legGirth = spec.legGirth ?? spec.limbGirth ?? 1;
  const base = spec.torsoGirthBase ?? 1;
  const top = spec.torsoGirthTop ?? 1;

  // Head + every face bone: uniform, so the whole face hierarchy scales about the neck top.
  if (!is1(spec.head)) {
    add('head', spec.head);
    for (const n of rigBoneNames) if (FACIAL.test(n)) add(n, spec.head);
  }
  if (!is1(spec.neckAlong)) for (const n of ['neck_01', 'neck_02']) add(n, { along: spec.neckAlong });

  // Spine: length on spine_01..05, girth tapering from hips (base) to chest (top).
  const spine = ['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05'];
  if (!is1(spec.torsoAlong)) for (const n of spine) add(n, { along: spec.torsoAlong });
  if (!is1(base) || !is1(top)) {
    add('pelvis', { width: base, thickness: base });
    spine.forEach((n, i) => {
      const g = base + (top - base) * ((i + 1) / spine.length);
      add(n, { width: g, thickness: g });
    });
  }

  for (const s of ['l', 'r']) {
    if (!is1(top)) add(`clavicle_${s}`, { along: top }); // shoulder width follows chest girth
    for (const n of [`upperarm_${s}`, `lowerarm_${s}`]) {
      if (!is1(armAlong)) add(n, { along: armAlong });
      if (!is1(armGirth)) add(n, { width: armGirth, thickness: armGirth });
    }
    for (const n of [`thigh_${s}`, `calf_${s}`, `calf_twist_01_${s}`]) {
      if (!is1(legAlong)) add(n, { along: legAlong });
      if (!is1(legGirth)) add(n, { width: legGirth, thickness: legGirth });
    }
    if (!is1(spec.hands)) {
      add(`hand_${s}`, spec.hands);
      for (const n of rigBoneNames) if (FINGER.test(n) && n.endsWith(`_${s}`)) add(n, spec.hands);
    }
    if (!is1(spec.feet)) {
      add(`foot_${s}`, spec.feet);
      add(`ball_${s}`, spec.feet);
      for (const n of rigBoneNames) if (TOE.test(n) && n.endsWith(`_${s}`)) add(n, spec.feet);
    }
  }
  return out;
}

/**
 * The final factor map for a shape: `spec` expanded, then `bones` multiplied on top.
 * Unknown bone names in `bones` are reported in `warnings` and skipped.
 */
export function resolveFactors(rigBoneNames, shape) {
  const out = buildStretch(rigBoneNames, shape?.spec);
  const has = new Set(rigBoneNames);
  const warnings = [];
  for (const [name, s] of Object.entries(shape?.bones ?? {})) {
    if (!has.has(name)) { warnings.push(`unknown bone "${name}" skipped`); continue; }
    mul(out, name, s);
  }
  for (const k of Object.keys(shape?.spec ?? {})) if (!SPEC_KEYS.includes(k)) warnings.push(`unknown spec key "${k}" ignored`);
  const vals = [shape?.size, ...Object.values(shape?.spec ?? {})];
  for (const f of Object.values(out)) vals.push(f.along, f.width, f.thickness);
  const bad = vals.find((v) => typeof v === 'number' && (v < SAFE_RANGE[0] || v > SAFE_RANGE[1]));
  if (bad !== undefined && (shape?.size === undefined || bad !== shape.size)) {
    warnings.push(`value ${bad.toFixed(2)} is outside ${SAFE_RANGE[0]}..${SAFE_RANGE[1]}: flesh may tear or thin; check it by eye`);
  }
  return { factors: out, warnings };
}

// ---------------------------------------------------------------------------------------------
// Feet on the floor: bind-pose FK of the lowest foot bone, with and without bone lengthening
// ---------------------------------------------------------------------------------------------

const SOLE = /^(foot|ball)_[lr]$|toe_\d\d_[lr]$/;

function qrot(q, v) { // rotate v by unit quaternion q = (x,y,z,w)
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Lowest sole-bone Y (rig space, metres) in the bind pose, with per-bone lengthening `ls` (or null). */
function minSoleY(skeleton, names, ls) {
  const n = skeleton.numBones, P = skeleton.parents, T = skeleton.bindT, R = skeleton.bindR;
  const pos = new Array(n), rot = new Array(n);
  const solve = (i) => {
    if (pos[i]) return;
    const p = P[i], k = ls ? ls[i] : 1;
    const t = [T[i * 3] * k, T[i * 3 + 1] * k, T[i * 3 + 2] * k];
    const r = [R[i * 4], R[i * 4 + 1], R[i * 4 + 2], R[i * 4 + 3]];
    if (p < 0) { pos[i] = t; rot[i] = r; return; }
    solve(p);
    const o = qrot(rot[p], t);
    pos[i] = [pos[p][0] + o[0], pos[p][1] + o[1], pos[p][2] + o[2]];
    rot[i] = qmul(rot[p], r);
  };
  let min = Infinity;
  for (let i = 0; i < n; i++) if (SOLE.test(names[i])) { solve(i); min = Math.min(min, pos[i][1]); }
  return min;
}

// ---------------------------------------------------------------------------------------------
// applyBodyShape
// ---------------------------------------------------------------------------------------------

/** Per-character state: the scale and height the character had before any shape, and the lift applied. */
const state = new WeakMap();

/**
 * Apply (or, with `null`, clear) a body shape on one character instance.
 *
 * - Re-call with a new shape any time (power-ups, sliders). Cheap enough for slider speed;
 *   for tweens step it at 10-20 Hz, not every frame.
 * - A shape belongs to ONE character instance: re-apply after every load / swap / clone.
 * - Feet: changing leg length moves the feet off the floor. This function raises or lowers
 *   `character.position.y` by the correction (`lift`, metres) for you. Movement code that
 *   later sets `position.y` as an absolute value must add the returned `lift`.
 *
 * @param {import('@viggle/splat-engine-three').SplatCharacter} character
 * @param {BodyShape | null} shape
 * @returns {{lift: number, warnings: string[]}}
 */
export function applyBodyShape(character, shape) {
  const arm = character.armature;
  const names = arm.rigBoneNames;
  const sk = arm.skeleton;
  let st = state.get(character);
  if (!st) state.set(character, (st = { scale: character.scale.x, lift: 0, sole0: minSoleY(sk, names, null) }));

  const { factors, warnings } = shape ? resolveFactors(names, shape) : { factors: {}, warnings: [] };
  const any = Object.keys(factors).length > 0;
  arm.setBoneStretch(any ? factors : null);

  const size = shape?.size ?? 1;
  character.scale.setScalar(st.scale * size);

  // Where do the soles end up now? FK with the lengthening the engine just installed.
  const sole1 = any ? minSoleY(sk, names, sk.lengthScale) : st.sole0;
  const lift = st.sole0 * st.scale - sole1 * st.scale * size; // keep the soles at their original height
  character.position.y += lift - st.lift;
  st.lift = lift;
  for (const w of warnings) console.warn('[body-shape]', w);
  return { lift, warnings };
}

/** The lift currently applied to `character` (0 if no shape was ever applied). */
export const getLift = (character) => state.get(character)?.lift ?? 0;

/** Drop a prior shape's position correction without touching the shape (e.g. before teleporting). */
export function clearShape(character) { return applyBodyShape(character, null); }

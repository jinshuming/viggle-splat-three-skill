// Body Shape Lab: tune a vsplat character's proportions live, then copy the BodyShape JSON.
//
// URL params:  ?char=young-man  &motion=idle  &shape=<encodeURIComponent(JSON)>
// Agents:      window.bodyShapeLab  (see the API object at the bottom)

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VSplatLoader, SplatClipLoader } from '@viggle/splat-engine-three';
import { applyBodyShape, PRESETS, SPEC_KEYS, SAFE_RANGE } from '../../skills/body-shape/body-shape.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- three ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16161b);
scene.add(new THREE.GridHelper(10, 20, 0x444444, 0x2a2a2a));
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
const controls = new OrbitControls(camera, renderer.domElement);
const resetCamera = () => { camera.position.set(0, 1.1, 3.6); controls.target.set(0, 0.9, 0); controls.update(); };
resetCamera();
const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

// ---------- assets ----------
const vsplat = new VSplatLoader().setPath('/assets/');
const clipLoader = new SplatClipLoader().setPath('/assets/motions/');
const clips = new Map();
const getClip = (n) => { if (!clips.has(n)) clips.set(n, clipLoader.loadAsync(`${n}.glb`)); return clips.get(n); };
const [chars, motions] = await Promise.all([
  fetch('/assets/characters/index.json').then((r) => r.json()),
  fetch('/assets/motions/index.json').then((r) => r.json()),
]);

let character = null;
let shape = {};
let lift = 0;
let loadSeq = 0;

// ---------- shape state ----------
// Slider rows. Spec rows write `shape.spec[key]`; per-limb rows write `shape.bones[...]`.
// A value of 1 is removed from the JSON so the output stays minimal.
const clean = (s) => {
  for (const k of ['spec', 'bones']) if (s[k] && !Object.keys(s[k]).length) delete s[k];
  if (s.size === undefined || Math.abs(s.size - 1) < 1e-6) delete s.size;
  return s;
};
const specRow = (key, label, min, max) => ({
  id: key, label, min, max,
  get: (s) => s.spec?.[key] ?? 1,
  set: (s, v) => { s.spec ??= {}; Math.abs(v - 1) < 1e-6 ? delete s.spec[key] : (s.spec[key] = v); },
});
const sizeRow = { id: 'size', label: 'size (whole body)', min: 0.3, max: 3, get: (s) => s.size ?? 1, set: (s, v) => { s.size = v; } };

// per-limb: `bones` = the bone names the row drives together, `axis` = which axes it scales
const limbRow = (id, label, bones, axis, min, max) => ({
  id, label, min, max,
  get: (s) => {
    const b = s.bones?.[bones[0]];
    if (b === undefined) return 1;
    if (typeof b === 'number') return b;
    return axis === 'along' ? (b.along ?? 1) : (b.width ?? 1);
  },
  set: (s, v) => {
    s.bones ??= {};
    for (const n of bones) {
      const cur = s.bones[n];
      const o = typeof cur === 'number' ? { along: cur, width: cur, thickness: cur } : { ...(cur ?? {}) };
      if (axis === 'along') o.along = v; else { o.width = v; o.thickness = v; }
      if (axis === 'uniform') { o.along = v; }
      for (const k of Object.keys(o)) if (Math.abs(o[k] - 1) < 1e-6) delete o[k];
      Object.keys(o).length ? (s.bones[n] = o) : delete s.bones[n];
    }
  },
});
const L = (side) => (side === 'l' ? 'left' : 'right');
const specRows = [
  sizeRow,
  specRow('head', 'head', 0.5, 3),
  specRow('neckAlong', 'neck length', 0.3, 3),
  specRow('torsoAlong', 'torso length', 0.4, 2),
  specRow('torsoGirthBase', 'hips / belly', 0.5, 2.2),
  specRow('torsoGirthTop', 'chest / shoulders', 0.5, 2.2),
  specRow('limbAlong', 'limb length', 0.4, 2),
  specRow('limbGirth', 'limb girth', 0.4, 2.2),
  specRow('armAlong', 'arm length', 0.4, 2.5),
  specRow('armGirth', 'arm girth', 0.4, 2.2),
  specRow('legAlong', 'leg length', 0.4, 2.2),
  specRow('legGirth', 'leg girth', 0.4, 2.2),
  specRow('hands', 'hands', 0.5, 2.5),
  specRow('feet', 'feet', 0.5, 2.5),
];
const boneRows = ['l', 'r'].flatMap((s) => [
  limbRow(`arm_${s}_len`, `${L(s)} arm length`, [`upperarm_${s}`, `lowerarm_${s}`], 'along', 0.4, 2.5),
  limbRow(`arm_${s}_gir`, `${L(s)} arm girth`, [`upperarm_${s}`, `lowerarm_${s}`], 'girth', 0.4, 2.5),
  limbRow(`hand_${s}`, `${L(s)} hand`, [`hand_${s}`], 'uniform', 0.5, 3),
  limbRow(`leg_${s}_len`, `${L(s)} leg length`, [`thigh_${s}`, `calf_${s}`], 'along', 0.4, 2.2),
  limbRow(`leg_${s}_gir`, `${L(s)} leg girth`, [`thigh_${s}`, `calf_${s}`], 'girth', 0.4, 2.5),
]);

const sliders = new Map();
function buildControls(host, rows) {
  for (const r of rows) {
    const el = document.createElement('div');
    el.className = 'row';
    el.innerHTML = `<span>${r.label}</span><input type="range" min="${r.min}" max="${r.max}" step="0.01"><span class="v"></span>`;
    const input = el.querySelector('input'), v = el.querySelector('.v');
    input.oninput = () => { r.set(shape, +input.value); clean(shape); commit('slider'); };
    input.ondblclick = () => { r.set(shape, 1); clean(shape); commit('slider'); };
    sliders.set(r.id, { r, input, v, el });
    host.appendChild(el);
  }
}
buildControls($('specCtl'), specRows);
buildControls($('boneCtl'), boneRows);

function syncControls() {
  for (const { r, input, v, el } of sliders.values()) {
    const x = r.get(shape);
    input.value = x;
    v.textContent = x.toFixed(2);
    el.classList.toggle('changed', Math.abs(x - 1) > 1e-6);
  }
}

// ---------- apply ----------
let warnings = [];
function applyNow() {
  if (!character) return;
  ({ lift, warnings } = applyBodyShape(character, shape));
  $('warn').textContent = warnings.join(' · ');
}

function commit(from) {
  applyNow();
  syncControls();
  if (from !== 'json') { $('json').value = JSON.stringify(shape, null, 2); $('json').classList.remove('bad'); }
  const u = new URL(location.href);
  Object.keys(shape).length ? u.searchParams.set('shape', JSON.stringify(shape)) : u.searchParams.delete('shape');
  history.replaceState(null, '', u);
}

$('json').oninput = () => {
  try {
    const parsed = JSON.parse($('json').value || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    shape = parsed;
    commit('json');
    $('json').classList.remove('bad');
  } catch { $('json').classList.add('bad'); }
};

// ---------- pickers ----------
const fill = (id, items) => ($(id).innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join(''));
fill('charSel', chars.map((c) => [c.id, c.name]));
fill('clipSel', motions.map((m) => [m, m]));
$('charSel').value = params.get('char') ?? (chars.find((c) => c.default) ?? chars[0]).id;
$('clipSel').value = motions.includes(params.get('motion')) ? params.get('motion') : motions.includes('idle') ? 'idle' : motions[0];

for (const [id, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.textContent = `${p.label} ${p.label_zh}`;
  b.onclick = () => setShape(structuredClone(p.shape));
  $('presets').appendChild(b);
}

async function loadCharacter(id = $('charSel').value) {
  const seq = ++loadSeq;
  const meta = chars.find((c) => c.id === id) ?? chars[0];
  $('status').textContent = `Loading ${meta.name}…`;
  const next = await vsplat.loadAsync(meta.file);
  if (seq !== loadSeq) { next.dispose(); return; }
  if (character) { scene.remove(character); character.dispose(); }
  character = next;
  character.rotation.y = Math.PI; // face the camera
  scene.add(character);
  $('charSel').value = meta.id;
  await playMotion($('clipSel').value);
  commit('load'); // a shape belongs to one instance: re-apply after every swap
  $('status').textContent = `${meta.name} · ${$('clipSel').value}`;
}

async function playMotion(name) {
  if (!motions.includes(name) || !character) return;
  $('clipSel').value = name;
  const clip = await getClip(name);
  const first = !character.clip;
  first ? character.play(clip) : character.crossFadeTo(clip, 0.3);
  $('status').textContent = `${chars.find((c) => c.id === $('charSel').value)?.name} · ${name}`;
}

const setShape = (s) => { shape = clean(structuredClone(s ?? {})); commit('api'); return { shape, lift, warnings }; };

$('charSel').onchange = () => loadCharacter().catch(console.error);
$('clipSel').onchange = () => playMotion($('clipSel').value).catch(console.error);
$('reset').onclick = () => { setShape({}); resetCamera(); };
const flash = (el, t) => { const o = el.textContent; el.textContent = t; setTimeout(() => (el.textContent = o), 1200); };
$('copy').onclick = () => navigator.clipboard?.writeText(JSON.stringify(shape, null, 2)).then(() => flash($('copy'), 'Copied!'));
$('link').onclick = () => navigator.clipboard?.writeText(location.href).then(() => flash($('link'), 'Copied!'));
const screenshot = () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); };
$('snap').onclick = () => { const a = document.createElement('a'); a.href = screenshot(); a.download = 'body-shape.png'; a.click(); };

// ---------- loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  character?.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
});

// ---------- agent API ----------
// Everything an agent needs, with plain-JSON in and out. All setters return { shape, lift, warnings }.
const api = {
  /** Replace the whole shape. `{}` or null = original body. */
  setShape,
  getShape: () => structuredClone(shape),
  /** Merge into the current shape: patch({spec:{head:1.5}}) keeps everything else. `null` deletes a key. */
  patch(p) {
    const next = structuredClone(shape);
    for (const k of ['spec', 'bones']) {
      for (const [n, v] of Object.entries(p?.[k] ?? {})) {
        next[k] ??= {};
        v === null ? delete next[k][n] : (next[k][n] = v);
      }
    }
    if (p && 'size' in p) p.size === null ? delete next.size : (next.size = p.size);
    return setShape(next);
  },
  reset: () => setShape({}),
  applyPreset: (name) => (PRESETS[name] ? setShape(PRESETS[name].shape) : { error: `unknown preset ${name}`, presets: Object.keys(PRESETS) }),
  listPresets: () => Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.shape])),
  listCharacters: () => chars.map((c) => ({ id: c.id, name: c.name })),
  listMotions: () => [...motions],
  listBones: () => [...(character?.armature.rigBoneNames ?? [])].filter((n) => !n.startsWith('FACIAL_')),
  specKeys: () => [...SPEC_KEYS],
  safeRange: SAFE_RANGE,
  async loadCharacter(id) { await loadCharacter(id); return { shape, lift, warnings }; },
  async playMotion(name) { await playMotion(name); return { motion: $('clipSel').value }; },
  /** PNG data URL of the current view. */
  screenshot,
  /** Camera presets: 'front' | 'side' | 'head' | 'full'. */
  view(name = 'full') {
    const v = { full: [0, 1.1, 3.6, 0, 0.9, 0], front: [0, 1.0, 2.6, 0, 0.9, 0], side: [2.8, 1.0, 0, 0, 0.9, 0], head: [0, 1.7, 1.2, 0, 1.55, 0] }[name];
    if (!v) return { error: 'unknown view', views: ['full', 'front', 'side', 'head'] };
    camera.position.set(v[0], v[1], v[2]); controls.target.set(v[3], v[4], v[5]); controls.update();
    return { view: name };
  },
  get lift() { return lift; },
  get ready() { return !!character; },
};
window.bodyShapeLab = api;

// ---------- boot ----------
try { const s = params.get('shape'); if (s) shape = clean(JSON.parse(s)); } catch (e) { console.warn('bad ?shape=', e); }
$('json').value = JSON.stringify(shape, null, 2);
syncControls();
await loadCharacter();

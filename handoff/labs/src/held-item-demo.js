// Held Item Lab: attach items to a vsplat character's sockets and tune each item's fit by eye,
// then copy the item JSON (Fight3D manifest shape).
//
// URL params:  ?char=young-man  &motion=idle  &hand_r=swordI  &hand_l=shield  &head=..  &body=..
// Agents:      window.heldItemLab  (see the API object at the bottom)

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VSplatLoader, SplatClipLoader } from '@viggle/splat-engine-three';
import { ItemRig, SOCKETS, socketBone, identityTransform, loadItem } from '../../skills/held-item/held-item.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- three ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16161b);
scene.add(new THREE.GridHelper(10, 20, 0x444444, 0x2a2a2a));
const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 100);
const controls = new OrbitControls(camera, renderer.domElement);
const setView = (pos, target) => { camera.position.set(...pos); controls.target.set(...target); controls.update(); };
setView([0, 1.1, 3.2], [0, 0.95, 0]);
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize);
resize();

// ---------- assets ----------
const vsplat = new VSplatLoader().setPath('/assets/');
const clipLoader = new SplatClipLoader().setPath('/assets/motions/');
const clips = new Map();
const getClip = (n) => { if (!clips.has(n)) clips.set(n, clipLoader.loadAsync(`${n}.glb`)); return clips.get(n); };
const [chars, motions, catalog] = await Promise.all([
  fetch('/assets/characters/index.json').then((r) => r.json()),
  fetch('/assets/motions/index.json').then((r) => r.json()),
  fetch('/assets/items/catalog.json').then((r) => r.json()),
]);
const items = new Map(catalog.map((d) => [d.name, structuredClone(d)]));
const pristine = new Map(catalog.map((d) => [d.name, structuredClone(d)]));

let character = null;
let loadSeq = 0;
let selected = 'hand_r';
const rig = new ItemRig(scene);
const equipSeq = {}; // socket -> latest equip request (async guard)
const loadout = {};  // socket -> item name

// ---------- item / fit state ----------
const note = (s = '') => ($('note').textContent = s);

async function equip(socket, name) {
  const seq = (equipSeq[socket] = (equipSeq[socket] ?? 0) + 1);
  if (!name) { rig.unequip(socket); delete loadout[socket]; refreshUI(); return { socket, item: null }; }
  const def = items.get(name);
  if (!def) return { error: `unknown item ${name}`, items: [...items.keys()] };
  const obj = await loadItem(def);
  if (seq !== equipSeq[socket]) { return { socket, superseded: true }; }
  let created = false;
  if (!def.sockets?.[socket]) { // no authored fit: start one at identity so it can be authored
    (def.sockets ??= {})[socket] = { bone: socketBone(socket), transform: identityTransform() };
    created = true;
  }
  rig.equip(socket, def, obj);
  loadout[socket] = name;
  refreshUI();
  if (created) note(`"${name}" had no fit for ${socket}: started at identity. Move it into place.`);
  return { socket, item: name, createdFit: created, fit: def.sockets[socket].transform };
}

const fitOf = (socket = selected) => items.get(loadout[socket])?.sockets?.[socket]?.transform ?? null;
const clean = (t) => {
  if (t.mirror && !Object.values(t.mirror).some(Boolean)) delete t.mirror;
  return t;
};

function setFit(socket, partial) {
  const fit = fitOf(socket);
  if (!fit) return { error: `nothing equipped on ${socket}` };
  for (const k of ['pos', 'rot']) if (partial[k]) Object.assign(fit[k], partial[k]);
  if (partial.scale !== undefined) fit.scale = partial.scale;
  if (partial.mirror) fit.mirror = { ...(fit.mirror ?? {}), ...partial.mirror };
  clean(fit);
  rig.refit(socket);
  if (socket === selected) refreshUI();
  return { socket, fit };
}

// ---------- UI ----------
const fill = (id, list) => ($(id).innerHTML = list.map(([v, t]) => `<option value="${v}">${t}</option>`).join(''));
fill('charSel', chars.map((c) => [c.id, c.name]));
fill('clipSel', motions.map((m) => [m, m]));
$('charSel').value = params.get('char') ?? (chars.find((c) => c.default) ?? chars[0]).id;
$('clipSel').value = motions.includes(params.get('motion')) ? params.get('motion') : motions.includes('idle') ? 'idle' : motions[0];

for (const s of SOCKETS) {
  const el = document.createElement('div');
  el.className = 'slot'; el.dataset.socket = s.name;
  el.innerHTML = `<span>${s.label}</span><select></select>`;
  const sel = el.querySelector('select');
  sel.innerHTML = '<option value="">- none -</option>' + [...items.keys()].map((n) => `<option>${n}</option>`).join('');
  sel.onchange = () => { selected = s.name; equip(s.name, sel.value).catch(console.error); };
  el.onclick = () => { selected = s.name; refreshUI(); };
  $('slots').appendChild(el);
}

const ROWS = [
  ['pos.x', 'pos x', -0.7, 0.7, 0.001], ['pos.y', 'pos y', -0.7, 0.7, 0.001], ['pos.z', 'pos z', -0.7, 0.7, 0.001],
  ['rot.x', 'rot x', -180, 180, 0.1], ['rot.y', 'rot y', -180, 180, 0.1], ['rot.z', 'rot z', -180, 180, 0.1],
  ['scale', 'scale', 0.05, 4, 0.01],
];
const rowEls = new Map();
for (const [key, label, min, max, step] of ROWS) {
  const el = document.createElement('div');
  el.className = 'row';
  el.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><span class="v"></span>`;
  const input = el.querySelector('input');
  input.oninput = () => {
    const [a, b] = key.split('.');
    setFit(selected, b ? { [a]: { [b]: +input.value } } : { [a]: +input.value });
  };
  rowEls.set(key, { input, v: el.querySelector('.v') });
  $('fitCtl').appendChild(el);
}
document.querySelectorAll('[data-m]').forEach((cb) => (cb.onchange = () => setFit(selected, { mirror: { [cb.dataset.m]: cb.checked } })));

function refreshUI() {
  for (const el of document.querySelectorAll('.slot')) {
    el.classList.toggle('sel', el.dataset.socket === selected);
    el.querySelector('select').value = loadout[el.dataset.socket] ?? '';
  }
  const fit = fitOf();
  $('fitName').textContent = fit ? `${loadout[selected]} @ ${selected}` : `${selected} (empty)`;
  for (const [key, { input, v }] of rowEls) {
    const [a, b] = key.split('.');
    const x = fit ? (b ? fit[a][b] : fit[a]) : 0;
    input.value = x; input.disabled = !fit;
    v.textContent = fit ? (+x).toFixed(key === 'scale' ? 2 : key.startsWith('rot') ? 1 : 3) : '';
  }
  document.querySelectorAll('[data-m]').forEach((cb) => { cb.checked = !!fit?.mirror?.[cb.dataset.m]; cb.disabled = !fit; });
  if (document.activeElement !== $('json')) $('json').value = fit ? JSON.stringify(items.get(loadout[selected]), null, 2) : '';
  $('json').classList.remove('bad');
}

$('json').oninput = () => {
  try {
    const def = JSON.parse($('json').value);
    const name = loadout[selected];
    if (!def || def.name !== name) throw new Error('keep "name"');
    items.set(name, def);
    rig.slots.get(selected).def = def;
    for (const [sock, n] of Object.entries(loadout)) if (n === name) { rig.slots.get(sock).def = def; rig.refit(sock); }
    refreshUI();
    $('json').classList.remove('bad');
  } catch { $('json').classList.add('bad'); }
};
$('json').onblur = refreshUI;

const flash = (el, t) => { const o = el.textContent; el.textContent = t; setTimeout(() => (el.textContent = o), 1200); };
$('copy').onclick = () => { const d = items.get(loadout[selected]); if (d) navigator.clipboard?.writeText(JSON.stringify(d, null, 2)).then(() => flash($('copy'), 'Copied!')); };
$('copyAll').onclick = () => navigator.clipboard?.writeText(JSON.stringify([...items.values()], null, 2)).then(() => flash($('copyAll'), 'Copied!'));
$('resetFit').onclick = () => {
  const name = loadout[selected]; if (!name) return;
  const orig = pristine.get(name)?.sockets?.[selected];
  items.get(name).sockets[selected] = orig ? structuredClone(orig) : { bone: socketBone(selected), transform: identityTransform() };
  rig.refit(selected); refreshUI();
};
const screenshot = () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); };
$('snap').onclick = () => { const a = document.createElement('a'); a.href = screenshot(); a.download = 'held-item.png'; a.click(); };

// ---------- camera presets ----------
const VIEWS = ['full', 'hand_r', 'hand_l', 'head', 'body'];
function view(name = 'full') {
  if (name === 'full') { setView([0, 1.1, 3.2], [0, 0.95, 0]); return { view: name }; }
  const bone = socketBone(name);
  const m = rig.boneWorld(bone);
  if (!m) return { error: `no bone for ${name}`, views: VIEWS };
  const p = new THREE.Vector3().setFromMatrixPosition(m);
  setView([p.x, p.y + 0.1, p.z + (name === 'head' ? 0.9 : 1.1)], [p.x, p.y, p.z]);
  return { view: name };
}
for (const n of VIEWS) {
  const b = document.createElement('button');
  b.textContent = n; b.onclick = () => view(n);
  $('views').appendChild(b);
}

// ---------- character / motion ----------
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
  rig.setCharacter(character); // items stay equipped and re-bind to the new rig
  await playMotion($('clipSel').value);
}
async function playMotion(name) {
  if (!motions.includes(name) || !character) return;
  $('clipSel').value = name;
  const clip = await getClip(name);
  character.clip ? character.crossFadeTo(clip, 0.3) : character.play(clip);
  $('status').textContent = `${chars.find((c) => c.id === $('charSel').value)?.name} · ${name}`;
}
$('charSel').onchange = () => loadCharacter().catch(console.error);
$('clipSel').onchange = () => playMotion($('clipSel').value).catch(console.error);

// ---------- loop: character FIRST, then items, then render ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  character?.update(clock.getDelta());
  rig.update();
  controls.update();
  renderer.render(scene, camera);
});

// ---------- agent API ----------
// Plain JSON in and out. Fits are in the bone's local space: metres, degrees (Euler ZYX).
const api = {
  listItems: () => [...items.keys()],
  getItem: (name) => structuredClone(items.get(name) ?? null),
  /** Add an item: { name, url, asset_type?, local_transform?, sockets? }. url may be any GLB / PLY the page can fetch. */
  registerItem(def) {
    items.set(def.name, structuredClone(def)); pristine.set(def.name, structuredClone(def));
    for (const sel of document.querySelectorAll('.slot select')) if (![...sel.options].some((o) => o.value === def.name)) sel.add(new Option(def.name));
    return { items: [...items.keys()] };
  },
  listSockets: () => SOCKETS.map((s) => ({ socket: s.name, bone: s.bone })),
  /** Put an item in a socket; null removes it. If the item has no fit for that socket one is created at identity. */
  equip: (socket, name) => equip(socket, name),
  unequip: (socket) => equip(socket, null),
  getLoadout: () => ({ ...loadout }),
  /** Merge into a fit: setFit('hand_r', { pos:{y:0.3}, rot:{x:90}, scale:1.2, mirror:{z:true} }) */
  setFit: (socket, partial) => setFit(socket, partial),
  getFit: (socket) => structuredClone(fitOf(socket)),
  /** Full item JSON (all sockets) for the item currently in `socket`: the thing to hand back. */
  getItemJson: (socket) => structuredClone(items.get(loadout[socket]) ?? null),
  listCharacters: () => chars.map((c) => ({ id: c.id, name: c.name })),
  listMotions: () => [...motions],
  loadCharacter: async (id) => { await loadCharacter(id); return { loadout: { ...loadout } }; },
  playMotion: async (name) => { await playMotion(name); return { motion: $('clipSel').value }; },
  view,
  screenshot,
  /** Column-major 16 numbers: world matrix of a bone (or null). For verification. */
  boneWorld: (name) => rig.boneWorld(name)?.toArray() ?? null,
  /** Column-major 16 numbers: where an equipped item is right now. */
  itemWorld: (socket) => rig.slots.get(socket)?.object.matrix.toArray() ?? null,
  get ready() { return !!character; },
};
window.heldItemLab = api;

// ---------- boot ----------
await loadCharacter();
const boot = params.get('hand_r') || params.get('hand_l') || params.get('head') || params.get('body');
if (boot) { for (const s of SOCKETS) if (params.get(s.name)) await equip(s.name, params.get(s.name)); }
else { await equip('hand_r', 'swordI'); await equip('hand_l', 'shield'); }
refreshUI();

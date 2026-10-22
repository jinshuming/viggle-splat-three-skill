// Held Item Lab: attach items to a vsplat character's sockets and tune each item's fit by eye,
// then copy the item JSON (Fight3D manifest shape).
//
// URL params:  ?char=young-man  &motion=idle  &hand_r=swordI  &hand_l=shield  &head=..  &body=..
// Agents:      window.heldItemLab  (see the API object at the bottom)

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VSplatLoader, SplatClipLoader } from '@viggle/splat-engine-three';
import { ItemRig, SOCKETS, socketBone, identityTransform, loadItem, normalizationFromGrip, transformToMatrix4 } from '../../skills/held-item/held-item.js';

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
let editTarget = 'fit';
let motionSeq = 0;
const rig = new ItemRig(scene);
const equipSeq = {}; // socket -> latest equip request (async guard)
const loadout = {};  // socket -> item name

// Debug frames: bone (0.22m), normalized grip/fit (0.13m), raw asset root (0.08m).
const frames = [0.22, 0.13, 0.08].map((size) => {
  const a = new THREE.AxesHelper(size);
  a.matrixAutoUpdate = false;
  a.material.depthTest = false; a.material.transparent = true;
  a.material.opacity = size === 0.08 ? 0.4 : 0.9;
  a.renderOrder = 10;
  scene.add(a); return a;
});
function updateFrames() {
  const slot = rig.slots.get(selected);
  const entry = slot?.def.sockets?.[selected];
  const bone = entry && rig.boneWorld(entry.bone ?? socketBone(selected));
  for (const f of frames) f.visible = !!bone && $('axes').checked;
  if (!bone) return;
  frames[0].matrix.copy(bone);
  frames[1].matrix.multiplyMatrices(bone, transformToMatrix4(entry.transform));
  frames[2].matrix.copy(slot.object.matrix);
  for (const f of frames) f.matrixWorldNeedsUpdate = true;
}

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
const defOf = (socket = selected) => items.get(loadout[socket]);
const editingTransform = () => editTarget === 'fit' ? fitOf() : defOf()?.local_transform ?? identityTransform();
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

function setLocalTransform(socket, partial) {
  const def = defOf(socket);
  if (!def) return { error: `nothing equipped on ${socket}` };
  const t = (def.local_transform ??= identityTransform());
  for (const k of ['pos', 'rot']) if (partial[k]) Object.assign(t[k], partial[k]);
  if (partial.scale !== undefined) t.scale = partial.scale;
  if (partial.mirror) t.mirror = { ...(t.mirror ?? {}), ...partial.mirror };
  clean(t);
  for (const [sock, name] of Object.entries(loadout)) if (name === def.name) rig.refit(sock);
  refreshUI(); return { local_transform: structuredClone(t) };
}
function setGrip(socket, frame) {
  const def = defOf(socket);
  if (!def) return { error: `nothing equipped on ${socket}` };
  const t = normalizationFromGrip(frame); // validate before mutation; replaces previous mirror too
  def.local_transform = t;
  for (const [sock, name] of Object.entries(loadout)) if (name === def.name) rig.refit(sock);
  refreshUI(); return { local_transform: structuredClone(t) };
}

// ---------- UI ----------
const fill = (id, list) => ($(id).innerHTML = list.map(([v, t]) => `<option value="${v}">${t}</option>`).join(''));
fill('charSel', chars.map((c) => [c.id, c.name]));
fill('clipSel', [['rest', 'Rest pose / 静止校准'], ...motions.map((m) => [m, m])]);
$('charSel').value = params.get('char') ?? (chars.find((c) => c.default) ?? chars[0]).id;
$('clipSel').value = motions.includes(params.get('motion')) ? params.get('motion') : 'rest';

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
    (editTarget === 'fit' ? setFit : setLocalTransform)(selected, b ? { [a]: { [b]: +input.value } } : { [a]: +input.value });
  };
  rowEls.set(key, { input, v: el.querySelector('.v') });
  $('fitCtl').appendChild(el);
}
document.querySelectorAll('[data-m]').forEach((cb) => (cb.onchange = () => (editTarget === 'fit' ? setFit : setLocalTransform)(selected, { mirror: { [cb.dataset.m]: cb.checked } })));

$('editTarget').onchange = () => { editTarget = $('editTarget').value; refreshUI(); };
const gripInputs = {};
for (const [key, label, values] of [['position', 'Grip xyz', [0,0,0]], ['forward', 'Forward', [0,0,1]], ['up', 'Up', [0,1,0]]]) {
  const row = document.createElement('div'); row.className = 'grip-row';
  const title = document.createElement('span'); title.textContent = label; row.append(title);
  gripInputs[key] = {};
  ['x','y','z'].forEach((axis, i) => {
    const input = document.createElement('input'); input.type = 'number'; input.step = '0.01'; input.value = values[i];
    input.setAttribute('aria-label', `${key} ${axis}`); row.append(input); gripInputs[key][axis] = input;
  });
  $('gripCtl').append(row);
}
$('applyGrip').onclick = () => {
  try {
    const frame = Object.fromEntries(Object.entries(gripInputs).map(([k, v]) => [k,
      Object.fromEntries(Object.entries(v).map(([axis, el]) => [axis, el.value === '' ? NaN : Number(el.value)]))]));
    frame.scale = $('gripScale').value === '' ? NaN : Number($('gripScale').value);
    const result = setGrip(selected, frame);
    if (result.error) throw new Error(result.error);
    editTarget = 'asset'; $('editTarget').value = 'asset'; refreshUI();
    note('Grip normalized. Re-check fits on every socket using this item.');
  } catch (e) { note(e.message); }
};

function refreshUI() {
  for (const el of document.querySelectorAll('.slot')) {
    el.classList.toggle('sel', el.dataset.socket === selected);
    el.querySelector('select').value = loadout[el.dataset.socket] ?? '';
  }
  const fit = defOf() ? editingTransform() : null;
  $('editHint').textContent = editTarget === 'fit'
    ? 'Bone-local grip placement. Calibrate in rest pose; verify in motion.'
    : 'Asset → grip coordinates. Shared by every socket using this item. Changing it affects existing fits.';
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
  if (editTarget === 'asset') {
    items.get(name).local_transform = structuredClone(pristine.get(name)?.local_transform ?? identityTransform());
    for (const [sock, n] of Object.entries(loadout)) if (n === name) rig.refit(sock);
    refreshUI(); return;
  }
  const orig = pristine.get(name)?.sockets?.[selected];
  items.get(name).sockets[selected] = orig ? structuredClone(orig) : { bone: socketBone(selected), transform: identityTransform() };
  rig.refit(selected); refreshUI();
};
const screenshot = () => { rig.update(); updateFrames(); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); };
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
function poseState() {
  return { motion: $('clipSel').value, paused: character?.paused ?? true,
    time: character?.time ?? 0, duration: character?.duration ?? 0 };
}
function updatePlaybackUI() {
  const state = poseState();
  $('pause').disabled = state.motion === 'rest';
  $('pause').textContent = state.paused ? 'Resume' : 'Pause';
  $('time').disabled = state.motion === 'rest';
  $('time').max = Math.max(state.duration, 0.001);
  $('time').value = state.time;
  $('timeLabel').textContent = state.motion === 'rest' ? 'Rest pose · fixed' : `${state.time.toFixed(2)} / ${state.duration.toFixed(2)} s`;
}
function restPose() {
  ++motionSeq; // cancel pending motion loads
  if (!character) return;
  character.stop(0); // actual bind/rest pose; pausing idle would retain its animated pose
  character.paused = true;
  character.update(0); rig.update();
  $('clipSel').value = 'rest';
  $('status').textContent = `${$('charSel').value} · Rest pose`;
  updatePlaybackUI(); return poseState();
}
async function playMotion(name) {
  if (name === 'rest') return restPose();
  if (!motions.includes(name)) throw new Error(`Unknown motion: ${name}`);
  if (!character) return;
  const seq = ++motionSeq, target = character;
  const clip = await getClip(name);
  if (seq !== motionSeq || target !== character) return;
  $('clipSel').value = name;
  character.paused = false;
  character.play(clip); // cut: reproducible time 0, no crossfade during calibration
  character.time = 0;
  character.update(0); rig.update();
  $('status').textContent = `${$('charSel').value} · ${name}`;
  updatePlaybackUI(); return poseState();
}
function pause(value = true) {
  if (character && character.clip) character.paused = !!value;
  updatePlaybackUI(); return poseState();
}
function seek(seconds) {
  if (!Number.isFinite(seconds)) throw new Error('time must be finite seconds');
  if (character?.clip) {
    character.paused = true;
    character.time = Math.min(Math.max(seconds, 0), Math.max(0, character.duration - 1e-6));
    character.update(0); rig.update();
  }
  updatePlaybackUI(); return poseState();
}
$('charSel').onchange = () => loadCharacter().catch(console.error);
$('clipSel').onchange = () => playMotion($('clipSel').value).catch(console.error);
$('rest').onclick = restPose;
$('pause').onclick = () => pause(!character?.paused);
$('time').oninput = () => seek(Number($('time').value));

// ---------- loop: character FIRST, then items, then render ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  character?.update(clock.getDelta());
  rig.update();
  updateFrames();
  updatePlaybackUI();
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
  setLocalTransform,
  setGrip,
  restPose, pause, seek, poseState,
  selectSocket(socket) {
    if (!SOCKETS.some((s) => s.name === socket)) throw new Error(`Unknown socket: ${socket}`);
    selected = socket; refreshUI(); return { socket };
  },
  showAxes(value = true) { $('axes').checked = !!value; return { axes: !!value }; },
  getFit: (socket) => structuredClone(fitOf(socket)),
  /** Full item JSON (all sockets) for the item currently in `socket`: the thing to hand back. */
  getItemJson: (socket) => structuredClone(items.get(loadout[socket]) ?? null),
  listCharacters: () => chars.map((c) => ({ id: c.id, name: c.name })),
  listMotions: () => [...motions],
  loadCharacter: async (id) => { await loadCharacter(id); return { loadout: { ...loadout } }; },
  playMotion,
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

// held-item.js - attach rigid items (weapons, shields, hats, backpacks) to a vsplat character's
// bones in three.js, from the same item JSON the Fight3D items manifest uses.
//
//   itemWorld = boneWorld · fit · local_transform
//
// An item is NOT skinned: it rides one bone rigidly. Each item stores one `fit` per socket
// (position / rotation / scale in that bone's local space), so the same item can sit in the
// right hand, the left hand, on the head...
//
//   import { ItemRig, loadItem } from './held-item.js';
//   const rig = new ItemRig(scene);
//   rig.setCharacter(character);                       // SplatCharacter from VSplatLoader
//   rig.equip('hand_r', def, await loadItem(def));     // def = item JSON (see ItemDefinition)
//   // each frame, AFTER character.update(dt) and BEFORE renderer.render():
//   rig.update();

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SplatPLYLoader } from '@viggle/splat-engine-three';

/**
 * @typedef {{x:number,y:number,z:number}} Vec3Like
 * @typedef {Object} ItemTransform  Rotation is Euler in DEGREES (order ZYX), scale is uniform.
 * @property {Vec3Like} pos         metres, in the bone's local space
 * @property {Vec3Like} rot         degrees
 * @property {number} scale
 * @property {{x?:boolean,y?:boolean,z?:boolean}} [mirror]  flip individual local axes
 *
 * @typedef {Object} ItemDefinition  Same shape as the Fight3D `GET /items` manifest entries.
 * @property {string} name                       unique handle, e.g. "swordI"
 * @property {string} url                        GLB / GLTF (asset_type "model") or PLY (asset_type "splat")
 * @property {'model'|'splat'} [asset_type]      inferred from the extension when omitted
 * @property {ItemTransform} [local_transform]   item normalisation pose, usually ~identity
 * @property {Record<string,{bone:string,transform:ItemTransform}>} [sockets]
 *           a key present = the item can go on that socket; absent = it cannot (it is hidden)
 */

/** Socket -> bone. These four are all the live Fight3D data uses. */
export const SOCKETS = [
  { name: 'hand_r', bone: 'hand_r', label: 'Right hand' },
  { name: 'hand_l', bone: 'hand_l', label: 'Left hand' },
  { name: 'head', bone: 'head', label: 'Head' },
  { name: 'body', bone: 'spine_02', label: 'Body' },
];
export const socketBone = (socket) => SOCKETS.find((s) => s.name === socket)?.bone ?? socket;

export const identityTransform = () => ({ pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 });

// ---------------------------------------------------------------------------------------------
// Math. Must match the Fight3D runtime exactly, or items land elsewhere than in the game.
// ---------------------------------------------------------------------------------------------

const D = Math.PI / 180;

/**
 * TRS matrix of an ItemTransform. NOTE the Euler order is 'ZYX': three.js defaults to 'XYZ',
 * and using the default puts every item in the wrong orientation.
 * @param {ItemTransform} t
 * @param {THREE.Matrix4} [out]
 */
export function transformToMatrix4(t, out = new THREE.Matrix4()) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rot.x * D, t.rot.y * D, t.rot.z * D, 'ZYX'));
  const s = new THREE.Vector3(
    t.scale * (t.mirror?.x ? -1 : 1),
    t.scale * (t.mirror?.y ? -1 : 1),
    t.scale * (t.mirror?.z ? -1 : 1),
  );
  return out.compose(new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z), q, s);
}

/** Bone-local matrix of an item: fit · local_transform (that order). */
export function itemLocalMatrix(fit, localTransform, out = new THREE.Matrix4()) {
  transformToMatrix4(fit, out);
  if (localTransform) out.multiply(transformToMatrix4(localTransform));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

const gltfLoader = new GLTFLoader();
const plyLoader = new SplatPLYLoader();
/** url -> Promise<{kind, root}>: the shared, never-disposed prototype of each asset. */
const cache = new Map();

const kindOf = (def) => def.asset_type ?? (/\.(ply|spz)(\?|$)/i.test(def.url) ? 'splat' : 'model');

function toBasic(mat) {
  // Texture as colour, unlit: reads clearly inside a splat scene (Fight3D does emissive = 1).
  // No texture: the material colour, or mid-grey when it is almost black.
  const color = mat.color ? mat.color.clone() : new THREE.Color(0.6, 0.6, 0.6);
  if (!mat.map && color.r + color.g + color.b < 0.15) color.setScalar(0.6);
  return new THREE.MeshBasicMaterial({
    map: mat.map ?? null, color: mat.map ? 0xffffff : color,
    transparent: mat.transparent, opacity: mat.opacity, alphaTest: mat.alphaTest,
    side: THREE.DoubleSide, // mirrored fits flip the triangle winding
  });
}

/**
 * Load an item's asset. The result is a ready-to-equip object for `ItemRig.equip`.
 * Assets are cached per URL; a GLB's geometry and materials are shared by every instance,
 * so never dispose them yourself (disposing a shared mesh blanks every other copy).
 * @param {ItemDefinition} def
 * @returns {Promise<THREE.Object3D>}
 */
export async function loadItem(def) {
  const kind = kindOf(def);
  if (!cache.has(def.url)) {
    cache.set(def.url, (async () => {
      if (kind === 'splat') return plyLoader.loadAsync(def.url);
      const gltf = await gltfLoader.loadAsync(def.url);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.material = Array.isArray(o.material) ? o.material.map(toBasic) : toBasic(o.material);
        o.frustumCulled = false; // the root matrix is rewritten every frame
      });
      return gltf.scene; // the item origin is the glTF scene origin; no extra transform
    })());
  }
  const proto = await cache.get(def.url);
  // Splats: one object per instance (a splat object holds its own transform + state).
  const obj = kind === 'splat' ? await plyLoader.loadAsync(def.url) : proto.clone(true);
  obj.userData.itemKind = kind;
  // Splats do not write depth, so two splat objects are layered by draw order only, and the PLY
  // loader draws static splats first (renderOrder -1): the character would paint over the item.
  // Hand-held items are mostly in front of the body, so draw them after it. (Trade-off: an
  // item that is behind the body, e.g. on the back, is then drawn over it. Use a mesh for those.)
  if (kind === 'splat') obj.renderOrder = 1;
  return obj;
}

// ---------------------------------------------------------------------------------------------
// ItemRig: one character, up to one item per socket
// ---------------------------------------------------------------------------------------------

export class ItemRig {
  /** @param {THREE.Object3D} scene  items are added here (as roots, not under the character) */
  constructor(scene) {
    this.scene = scene;
    this.character = null;
    /** @type {Map<string, {def: ItemDefinition, object: THREE.Object3D, local: THREE.Matrix4|null, placed: boolean}>} */
    this.slots = new Map();
    this._boneNames = new Map();
    this._boneWorld = new THREE.Matrix4();
    this._world = new THREE.Matrix4();
  }

  /** Bind to a character. Equipped items keep their slots and re-bind to the new rig, so a
   *  character swap keeps the items in hand. Pass null to detach (items hide). */
  setCharacter(character) {
    this.character = character;
    this._boneNames.clear();
    for (const n of character?.armature.rigBoneNames ?? []) this._boneNames.set(n.toLowerCase(), n);
    for (const s of this.slots.values()) s.placed = false; // hidden until placed on the new rig
  }

  /**
   * Put an item in a socket (replacing whatever was there). If the definition has no fit for
   * `socket` the item stays hidden; that is the data's way of saying it does not go there.
   * @param {string} socket  'hand_r' | 'hand_l' | 'head' | 'body'
   * @param {ItemDefinition} def
   * @param {THREE.Object3D} object  from loadItem()
   */
  equip(socket, def, object) {
    this.unequip(socket);
    object.visible = false; // no flash at the origin before the first placement
    object.matrixAutoUpdate = false; // the matrix is written directly; negative determinants are fine
    this.scene.add(object);
    this.slots.set(socket, { def, object, local: null, placed: false });
    this.refit(socket);
    return this;
  }

  /** Recompute a slot's bone-local matrix after its fit / local_transform was edited. */
  refit(socket) {
    const s = this.slots.get(socket);
    if (!s) return;
    const fit = s.def.sockets?.[socket];
    s.local = fit ? itemLocalMatrix(fit.transform, s.def.local_transform) : null;
  }

  unequip(socket) {
    const s = this.slots.get(socket);
    if (!s) return this;
    this.scene.remove(s.object);
    // Splat objects own GPU state; mesh clones share geometry/material with the cache, so
    // they are only detached, never disposed.
    if (s.object.userData.itemKind === 'splat') s.object.dispose?.();
    this.slots.delete(socket);
    return this;
  }

  clear() { for (const k of [...this.slots.keys()]) this.unequip(k); }

  /** World matrix of a bone by name (case-insensitive), or null. Valid after character.update(). */
  boneWorld(name, out = this._boneWorld) {
    const real = this._boneNames.get(name.toLowerCase());
    return real && this.character ? this.character.getBoneWorldMatrix(real, out) : null;
  }

  /** Call once per frame, AFTER character.update(dt) and BEFORE renderer.render(). */
  update() {
    for (const [socket, s] of this.slots) {
      const fit = s.def.sockets?.[socket];
      const bw = s.local && this.character ? this.boneWorld(fit.bone ?? socketBone(socket)) : null;
      if (!bw) { s.object.visible = false; continue; }
      s.object.matrix.multiplyMatrices(bw, s.local);
      s.object.matrixWorldNeedsUpdate = true;
      s.object.visible = true;
      s.placed = true;
    }
  }

  dispose() { this.clear(); this.character = null; }
}

// ---------------------------------------------------------------------------------------------
// Game-layer helpers (optional; Fight3D uses them)
// ---------------------------------------------------------------------------------------------

/** Which hand an item goes to by default: the right, the left for archers / left-only items,
 *  else the first socket the item has a fit for. */
export function pickSocket(def, { archer = false } = {}) {
  const has = (k) => !!def.sockets?.[k];
  if (archer && has('hand_l')) return 'hand_l';
  if (has('hand_r')) return 'hand_r';
  if (has('hand_l')) return 'hand_l';
  return Object.keys(def.sockets ?? {})[0] ?? null;
}

/** Resting loadout `{socket: itemName}` overlaid with one clip's `socketItems`
 *  (`{socket, item}` swaps, `{socket, hide:true}` or `{socket, item:null}` removes).
 *  The clip wins; sockets it does not mention keep the resting item. */
export function mergeSocketLoadout(base = {}, clipSocketItems = []) {
  const out = { ...base };
  for (const o of clipSocketItems) {
    if (o.hide || o.item == null) delete out[o.socket]; else out[o.socket] = o.item;
  }
  return out;
}

---
name: held-item
description: Attach held and worn items (swords, shields, bows, guns, hats, backpacks - GLB meshes or PLY splats) to a Viggle splat character's bones in a three.js app (@viggle/splat-engine-three), and author or tune where each item sits. Use it whenever someone wants a vsplat character to hold, wield, carry or wear something, put an item in the left or right hand, on the head or on the back, fix an item that sits wrong, floats, points the wrong way or is the wrong size, mirror an item for the other hand, or swap items per animation. Also for Chinese requests like 手持物 / 拿着武器 / 持剑 / 拿盾 / 戴帽子 / 挂载物品 / 武器位置不对 / 调整握持 / 左右手 / 插槽, even if they never say "socket" or "bone". Covers the item JSON format, the matrix math, the per-frame update order, tuning a fit live in the Held Item Lab (drivable by an agent via window.heldItemLab), and wiring ItemRig into an app.
---

# Hold items on a splat character

An item is **not skinned**: it rides one bone rigidly. Every item stores one **fit** per
**socket** (a named mount point = one bone), meaning its position, rotation and scale in that
bone's local space. Each frame:

```
itemWorld = boneWorld × fit × local_transform
```

The same item JSON works in Fight3D and in this three.js engine: same fields, same math, same
bones. The whole workflow is that one JSON value moving from a description to the lab to the app.

```js
import { ItemRig, loadItem } from './held-item.js';   // copy skills/held-item/held-item.js into your app

const rig = new ItemRig(scene);
rig.setCharacter(character);                                  // SplatCharacter from VSplatLoader
const def = items.find((i) => i.name === 'swordI');           // item JSON (below)
rig.equip('hand_r', def, await loadItem(def));

renderer.setAnimationLoop(() => {
  character.update(clock.getDelta());   // 1. pose the bones
  rig.update();                         // 2. THEN place the items
  renderer.render(scene, camera);       // 3. THEN render
});
```

Files:

| File | What |
| --- | --- |
| `skills/held-item/held-item.js` | The module: `ItemRig`, `loadItem`, `transformToMatrix4`, `itemLocalMatrix`, `SOCKETS`, `pickSocket`, `mergeSocketLoadout`. Copy it into any app (needs `three` and `@viggle/splat-engine-three`). |
| `labs/held-item.html` + `labs/src/held-item-demo.js` | Held Item Lab: pick items per socket, tune fits with sliders, copy the JSON; `window.heldItemLab` agent API. |
| `labs/public/assets/items/` | Sample items (5 GLB + 1 PLY splat) and `catalog.json` with their authored fits. Placeholders for testing: swap in your own. |

## 1. The item JSON (do not rename fields)

```jsonc
{
  "name": "swordI",                       // unique handle
  "url": "/assets/items/swordI.glb",      // GLB / GLTF ("model") or PLY ("splat")
  "asset_type": "model",                  // inferred from the extension if omitted
  "local_transform": { "pos": {"x":0,"y":0,"z":0}, "rot": {"x":0,"y":0,"z":0}, "scale": 1 },  // optional, ~identity
  "sockets": {                            // a key present = the item can go on that socket
    "hand_r": {
      "bone": "hand_r",
      "transform": {
        "pos":    { "x": -0.036, "y": 0.27, "z": 0.209 },     // metres, bone-local
        "rot":    { "x": 47.504, "y": 64.141, "z": 158.392 }, // Euler DEGREES, order ZYX
        "scale":  1,                                           // uniform
        "mirror": { "x": false, "y": false, "z": true }        // optional: flip local axes
      }
    },
    "hand_l": { "bone": "hand_l", "transform": { /* its own, independent fit */ } }
  }
}
```

| Socket | Bone | Use |
| --- | --- | --- |
| `hand_r` | `hand_r` | right hand |
| `hand_l` | `hand_l` | left hand |
| `head` | `head` | hats, helmets |
| `body` | `spine_02` | shields on the back, backpacks |

- **Left and right are two independent fits.** Never derive one hand from the other (the live
  data is close to a mirror, not exactly one).
- An item with no key for a socket **cannot** go there: it stays hidden, no error. That is the data
  saying "not supported", not a bug.
- `transform.bone` wins over the socket table's default bone.
- The item's origin is the glTF scene's origin (or the PLY's origin). There is no auto-centering,
  so `pos` includes whatever offset the asset's own origin has from the grip.

## 2. Turn the brief into a first fit

You cannot guess a fit from words: it depends on the asset's own origin and axes. Start from a
known fit and nudge it by eye in the lab:

| Brief | Start from |
| --- | --- |
| Hold a sword / axe / gun in a hand | the catalog fit for that item on `hand_r` / `hand_l` (`labs/public/assets/items/catalog.json`) |
| New item, no fit yet | `equip` it on the socket (a fit is created at identity), then tune: first `rot` until it points the right way, then `pos` until the grip is in the palm, then `scale` |
| Same item in the other hand | tune the other socket separately; try `mirror: { z: true }` if it looks flipped |
| Hat / helmet | socket `head`, identity fit, then raise `pos` along the head's local up |
| Shield / backpack | socket `body` (bone `spine_02`) |
| Item too big / small | `scale` (uniform, 0.05 to 4) |

Bone-local axes are not world axes: they change with the bone's orientation. The reliable way is
to change one number at a time and look.

## 3. Tune it where it can be seen

```bash
cd labs && npm install && npm run dev
# http://localhost:5173/held-item.html
```

Open it with items already equipped: `http://localhost:5173/held-item.html?char=young-man&motion=idle&hand_r=swordI&hand_l=shield`.

The lab has character and motion pickers, one item picker per socket, sliders for the selected
socket's fit (position, rotation, scale, mirror), camera presets that frame the hand / head / body,
and a two-way JSON box holding the item's full definition: edit it and it applies live. Copy it
when done.

### Driving the lab as an agent

The page exposes `window.heldItemLab`. From a browser tool (JS-eval / page-script, Playwright,
Claude in Chrome, the in-app browser...) call it directly. Everything is plain JSON:

```js
const lab = window.heldItemLab;
lab.listItems();  lab.listSockets();  lab.listCharacters();  lab.listMotions();
await lab.loadCharacter('young-man');
await lab.playMotion('idle');

lab.registerItem({ name: 'mySword', url: '/assets/items/mySword.glb' });   // new asset, no fits yet
await lab.equip('hand_r', 'swordI');         // null removes. Missing fit => created at identity
lab.setFit('hand_r', { pos: { y: 0.3 }, rot: { x: 90 }, scale: 1.2, mirror: { z: true } });  // MERGES
lab.getFit('hand_r');
lab.view('hand_r');                          // 'full' | 'hand_r' | 'hand_l' | 'head' | 'body'
lab.screenshot();                            // PNG data URL
lab.getItemJson('hand_r');                   // the finished item JSON to hand back
```

A good loop: `equip` -> `view('hand_r')` + `screenshot()` and look -> `setFit` -> repeat until the
grip sits in the palm and the item points the right way -> check the **other** hand and **at
least one moving motion** (a fit that looks right in `idle` can detach in a run or a swing) ->
`getItemJson`. `lab.boneWorld(name)` and `lab.itemWorld(socket)` return column-major 16-number
matrices if you need numbers.

## 4. Wire it into the app

```js
rig.setCharacter(character);                 // also after every character swap (items follow)
rig.equip('hand_r', defSword, await loadItem(defSword));
rig.equip('hand_l', defShield, await loadItem(defShield));   // both hands at once is fine
rig.unequip('hand_l');                       // one item per socket; equip() replaces
rig.refit('hand_r');                         // after you edit a fit / local_transform at runtime
```

Rules that are easy to get wrong:

- **Update order**: `character.update(dt)` -> `rig.update()` -> `renderer.render`. Placing items
  before the bones update makes them lag one frame behind the hand in fast motions.
- **Euler order is `'ZYX'`.** three.js defaults to `'XYZ'`; using the default puts every item in
  the wrong orientation. `transformToMatrix4` does it right, so use it rather than rolling your own.
- **Matrix order is `boneWorld · fit · local_transform`**, left to right. Not reversible.
- **Items are scene roots**, not children of the character. The rig writes `object.matrix` directly
  (`matrixAutoUpdate = false`), which is also what makes mirrored (negative-determinant) fits work.
- **Mirrored fits flip triangle winding**, so mesh materials must be `DoubleSide`. `loadItem` does
  this. Mirror is only handled for mesh items, not splats.
- **Shared resources.** Copies of one GLB share geometry and materials. `unequip` only detaches;
  never dispose a shared mesh or every other copy goes blank. `loadItem` caches per URL.
- **No flash at the origin**: an item stays hidden until its first placement, and stays hidden if the
  bone or the socket's fit is missing.
- **Character swap**: call `rig.setCharacter(newCharacter)`. Items keep their slots and re-bind. The
  fit is bone-local, so it works on any PINOC character (86 or 441 bones; body bones share names and axes).
- **Rendering and occlusion**: meshes use unlit `MeshBasicMaterial` (texture as colour; Fight3D does
  the same via emissive) so they read clearly next to splats. Meshes are opaque and write depth, and
  the splat character depth-tests against them, so a mesh shield in front of the chest covers it and
  one behind the back is hidden. Checked in this engine.
- **Splat (PLY) items are layered by draw order, not depth.** Splats do not write depth, and the PLY
  loader draws static splats first (`renderOrder = -1`), which would put the character on top of the
  item. `loadItem` sets `renderOrder = 1` on splat items so they draw after the character: right for
  things held in front of the body, **wrong for anything that should be hidden by the body** (a
  splat on the back always shows through). Use a GLB for those. Splat items cannot be mirrored.
- **Body shape.** Bone world matrices follow `body-shape` changes in position, but a stretched hand
  does not scale the item. After a big hand / arm change, re-check the fit, and scale the item if needed.

Game-layer helpers (optional, from Fight3D): `pickSocket(def, { archer })` chooses a default hand
(right; left for archers or left-only items; else the first socket with a fit).
`mergeSocketLoadout(base, clip.socketItems)` overlays a clip's per-animation item swaps
(`{socket, item}`) or removals (`{socket, hide: true}`) on the resting loadout: the clip wins,
other sockets keep their resting item.

## 5. Verify

Look at it. Beyond the visual check, three numeric checks are cheap and decisive (reference values
are from the Fight3D `sample.vsplat`; all three pass in this engine):

1. **Matrix math**: with `hand_r = [-0.23206,0.22431,-0.94611,0, 0.29484,0.94413,0.15147,0,
   0.92713,-0.24357,-0.28491,0, 0.40662,0.95958,0.1702,1]` and swordI's `hand_r` fit above,
   `boneWorld × itemLocalMatrix(fit)` must equal `[-0.69282,0.27977,0.66443,0, 0.38581,-0.63459,0.66949,0,
   0.60943,0.72076,0.33199,0, 0.68835,1.15551,0.18561,1]` within 1e-3.
2. **Bone axes**: in the rest pose (nothing playing) the world matrices of `root`, `pelvis`,
   `spine_02`, `head`, `hand_r`, `hand_l` must match the engine reference. If they do not, every
   fit lands wrong and no amount of tuning fixes it.
3. **Occlusion** (mesh items): shield on `body`, pushed 0.3 m in front of the chest -> it covers the
   chest; 0.3 m behind -> the body hides it.

Also check: a splat item in a hand (it should be visible, not buried in the body), both hands at once, swapping an item, equipping and unequipping the same item
repeatedly, swapping the character with items equipped, one mirrored fit, and a fast motion.

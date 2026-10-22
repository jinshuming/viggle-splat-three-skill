# Runtime and regression checks

## Wire it into the app

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
  fit is bone-local. Re-check bone axes, palm offsets and size on a new character; matching
  bone names alone does not guarantee a matching grip.
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

## Verify

Look at it. Beyond the visual check, three numeric checks are cheap and decisive (reference values
are from the Fight3D `sample.vsplat`; all three pass in this engine):

1. **Matrix math**: with `hand_r = [-0.23206,0.22431,-0.94611,0, 0.29484,0.94413,0.15147,0,
   0.92713,-0.24357,-0.28491,0, 0.40662,0.95958,0.1702,1]` and swordI's `hand_r` fit in `labs/public/assets/items/catalog.json`,
   `boneWorld × itemLocalMatrix(fit)` must equal `[-0.69282,0.27977,0.66443,0, 0.38581,-0.63459,0.66949,0,
   0.60943,0.72076,0.33199,0, 0.68835,1.15551,0.18561,1]` within 1e-3.
2. **Bone axes**: in the rest pose (nothing playing) the world matrices of `root`, `pelvis`,
   `spine_02`, `head`, `hand_r`, `hand_l` must match the engine reference. If they do not, every
   fit lands wrong and no amount of tuning fixes it.
3. **Occlusion** (mesh items): shield on `body`, pushed 0.3 m in front of the chest -> it covers the
   chest; 0.3 m behind -> the body hides it.

Also check: a splat item in a hand (it should be visible, not buried in the body), both hands at once, swapping an item, equipping and unequipping the same item
repeatedly, swapping the character with items equipped, one mirrored fit, and a fast motion.

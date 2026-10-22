---
name: held-item
description: Attach and calibrate rigid GLB or PLY items on Viggle splat characters in three.js. Use for 手持物, weapons, shields, hats, backpacks, left/right hand fits, wrong item direction or grip position, and per-animation equipment. Includes rest-pose calibration, asset grip/orientation normalization, Held Item Lab, and ItemRig integration.
---

# Hold items on a splat character

Deliver an item JSON with a verified grip and direction, plus app integration when requested.
Read [references/runtime.md](references/runtime.md) when wiring the rig, debugging rendering,
or checking engine-specific limitations and regression values.

## Coordinates: decide what each transform means

An item is rigidly attached to one bone. Its source asset already has an origin, axes, unit
scale and internal GLB node transforms. Loading it does not discover the handle or its meaning.
The character's rest pose provides a repeatable calibration frame; it does not automatically
align an arbitrary source model with the palm.

```
itemWorld = boneWorld(currentPose) × socketFit × local_transform
```

- `local_transform`: source asset → item grip frame. Shared by all sockets of this item.
  For newly normalized assets, grip is at origin, +Z points along the tip/barrel/front and
  +Y establishes up/roll. This is an authoring convention, not a property guaranteed by GLB/PLY.
- `sockets[socket].transform` (fit): grip frame → that bone's local frame. Positions are in
  metres, rotations are Euler DEGREES in `ZYX` order, scale is uniform. The bone origin may
  be at the wrist, so the palm usually needs an offset. Bone axes are not world axes.
- Existing catalog fits may include source-origin/direction corrections inside the fit.
  Keep them as authored when reusing them. Renormalizing the asset changes every existing
  fit; re-calibrate all affected sockets. Do not apply the same correction in both transforms.

`boneWorld` is the current bone transform, not a skinning matrix or inverse-bind matrix.
Rest pose is the default place to author a fit. A deliberately frozen gripping pose is also
valid: a bone-local fit can be calibrated in any fixed pose. Neither a paused `idle` nor
animation time zero is necessarily the rest pose. Rest pose also does not close the fingers;
this skill does not add finger posing or two-hand IK.

## 1. Establish a stable calibration pose

```bash
cd labs && npm install && npm run dev
# http://localhost:5173/held-item.html  (starts in rest pose)
```

Use `?char=young-man&motion=rest&hand_r=swordI` for a repeatable initial setup.
Explicit `motion=idle` or another clip starts that animation for preview.

```js
const lab = window.heldItemLab;
await lab.loadCharacter('young-man');
lab.restPose();                      // stop(0), restore actual rest pose, update bones
await lab.equip('hand_r', 'swordI');
lab.selectSocket('hand_r');
lab.view('hand_r');
lab.showAxes(true);
```

The large axis marker is the bone frame, the small marker is the grip frame after the fit,
and the faint marker is the source asset root. RGB means XYZ. Hide axes for final screenshots.
Use screenshots from more than one angle when aligning the grip; a front view can hide depth errors.
The current camera preset is a front close-up, not a semantic bone-axis view.

## 2. Inspect the source item before adjusting the hand

For a known catalog item, start with its existing fit and `local_transform`.
For a new item, inspect its own axes, grip point, and size first. Do not guess semantic
forward/up from a bounding box, the filename, or the generated model's appearance alone.
When generating or authoring an asset, request a grip origin and explicit forward/up axes;
verify the exported file still follows them. If the grip cannot be identified, request its
location/direction or use an explicitly provisional visual fit.

The lab can convert a known source grip frame into the existing `local_transform` format:

```js
lab.registerItem({ name: 'mySword', url: '/assets/items/mySword.glb' });
await lab.equip('hand_r', 'mySword'); // creates an identity fit for authoring only
lab.setGrip('hand_r', {
  position: { x: 0, y: -0.2, z: 0 },  // EXAMPLE: actual handle centre in source-root space
  forward:  { x: 0, y: 1, z: 0 },     // source direction towards blade tip
  up:       { x: 0, y: 0, z: 1 },     // source reference to fix roll
  scale: 1                           // source units → metres
});
```

These numbers are illustrative, not a reusable sword fit. `position`, `forward` and `up`
are measured in the loaded asset ROOT space, including its internal GLB node transforms,
before `local_transform` or the socket fit. Directions are vectors, not target positions.
`forward` and `up` must be nonzero and nonparallel; up is orthogonalized against forward.
For a shield choose outward normal as forward and its top as up. A sword needs a roll
reference as well as its tip direction. `setGrip` replaces `local_transform`, including
any old mirror, and refits all equipped instances of the same definition.

The UI exposes the same fields under “Set source grip”. The “Asset local_transform” editor
also allows direct correction if the source grip frame is unavailable. There is no automatic
handle detector or click-to-pick grip in this lab.

Outside the lab:

```js
import { normalizationFromGrip } from './held-item.js';
def.local_transform = normalizationFromGrip({ position, forward, up, scale: 1 });
// output is ordinary TRS JSON; no new runtime schema is required
```

## 3. Place that grip in the palm

Switch the lab editor to “Socket fit”. With the character fixed, adjust rotation so the grip
frame points correctly relative to the hand; move the grip into the palm, then verify size.
After a normalized asset is established, use its `local_transform.scale` for unit conversion
and the fit's scale for socket-specific artistic adjustment.

```js
lab.setFit('hand_r', { rot: { x: 90 }, pos: { y: 0.03 }, scale: 1 }); // MERGES, example only
lab.getFit('hand_r');
lab.getItemJson('hand_r');
```

Right and left hand fits are independent. Calibrate each requested socket separately;
mirroring one fit is only a starting point. Each socket supports one item:

| Socket | Default bone | Typical use |
| --- | --- | --- |
| `hand_r` | `hand_r` | Right hand |
| `hand_l` | `hand_l` | Left hand |
| `head` | `head` | Hat / helmet |
| `body` | `spine_02` | Backpack / back-mounted shield |

The socket entry's `bone` overrides the default. Missing socket entries hide the item in
`ItemRig`; only the lab creates a missing fit at identity to enable authoring.

## 4. Validate animation, then export

```js
await lab.playMotion('walk-in-place');
lab.pause(true);                       // fixed animated pose
lab.seek(0.4);                         // seconds; pauses and evaluates immediately
lab.pause(false);                      // moving preview
lab.restPose();                        // return to calibration reference
const def = lab.getItemJson('hand_r');
```

Check grip contact and roll in rest pose, a moving motion and several frozen frames of a
relevant fast motion. Verify left/right fits, size and occlusion for the requested loadout.
Changing character proportions or skeletons warrants another fit check; matching bone
names alone does not guarantee matching palm placement. One-hand attachment cannot make
a second hand follow a weapon; that requires an appropriate animation or IK.

Export JSON preserving these field names (same runtime format as Fight3D):

```json
{
  "name": "mySword",
  "url": "/assets/items/mySword.glb",
  "asset_type": "model",
  "local_transform": {
    "pos": { "x": 0, "y": 0, "z": 0 },
    "rot": { "x": 0, "y": 0, "z": 0 },
    "scale": 1
  },
  "sockets": {
    "hand_r": {
      "bone": "hand_r",
      "transform": {
        "pos": { "x": 0, "y": 0, "z": 0 },
        "rot": { "x": 0, "y": 0, "z": 0 },
        "scale": 1
      }
    }
  }
}
```

The identity example documents the schema; replace it with the calibrated values. Optional
`mirror: { "x": false, "y": false, "z": true }` belongs inside a transform. Mesh items support
mirrors; PLY splats do not. PLY items draw after characters and can show through the body;
use GLB for a back-mounted item requiring occlusion.

## 5. Integrate and report what was checked

Copy `held-item.js` into the app (requires `three` and `@viggle/splat-engine-three`):

```js
import { ItemRig, loadItem } from './held-item.js';
const rig = new ItemRig(scene);
rig.setCharacter(character);
rig.equip('hand_r', def, await loadItem(def));
renderer.setAnimationLoop(() => {
  character.update(clock.getDelta());
  rig.update();
  renderer.render(scene, camera);
});
```

Call `rig.setCharacter(newCharacter)` after character swaps and `rig.refit(socket)` after
editing fit or `local_transform` (for every affected equipped socket). The lab does this for
you. Preserve `ZYX`, multiplication order and shared mesh resource ownership; see
[references/runtime.md](references/runtime.md) for those rules and numeric checks.

Return the item JSON and any app changes, name the calibration pose and motions inspected,
and distinguish visually checked fits from provisional ones. Numeric matrix tests verify
attachment math; they cannot establish whether a handle actually sits inside the palm.

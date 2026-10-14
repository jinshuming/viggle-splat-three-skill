---
name: body-shape
description: Change a Viggle splat character's body at runtime in a three.js app (@viggle/splat-engine-three) - bone lengths, girth, head/hand/foot size, overall size, asymmetric limbs - from a plain-language description, with no new assets. Use it whenever someone wants a vsplat character taller, shorter, fatter, thinner, cartoonish, deformed or re-proportioned, or asks (in English or Chinese) for things like "big head", "long legs", "chibi", "a tiny kid", "a hulking brute", "stretch the arms as a power-up", 体型 / 骨骼长度 / 大头 / 长腿 / 胖一点 / 瘦一点 / Q版 / 变形 / 比例 / 调角色身材, even if they never say "bone". Covers turning a brief into a BodyShape JSON, tuning it live in the Body Shape Lab page (drivable by an agent via window.bodyShapeLab), and wiring it into an app with applyBodyShape (feet on the floor, character swaps, mid-run changes).
---

# Change a splat character's body shape

`@viggle/splat-engine-three` can scale bones at runtime: longer or shorter segments,
thicker or thinner flesh, on any character on the PINOC rig (all `.vsplat` characters
shipped with the engine, 86- and 441-bone rigs). Animations keep playing, because the
bind pose is untouched and clips never override bone lengths. No new assets, no
regeneration, no engine changes.

The whole workflow is one plain-JSON value, a **`BodyShape`**, that moves from a
description to the lab to the app:

```js
import { applyBodyShape } from './body-shape.js';   // copy skills/body-shape/body-shape.js into your app

const CHIBI = {
  spec:  { head: 2, neckAlong: 0.5, torsoAlong: 0.7, armAlong: 0.6, legAlong: 0.55 },
  bones: { upperarm_r: { along: 1.8 } },   // optional per-bone layer on top
  size:  0.8,                               // optional uniform size
};
const { lift } = applyBodyShape(character, CHIBI);   // character = await new VSplatLoader().loadAsync(url)
```

Files:

| File | What |
| --- | --- |
| `skills/body-shape/body-shape.js` | The module: `applyBodyShape`, `getLift`, `buildStretch`, `PRESETS`, `SPEC_KEYS`. No dependencies beyond a `SplatCharacter`; copy it into any app. |
| `labs/body-shape.html` + `labs/src/body-shape-demo.js` | Body Shape Lab: sliders, presets, character + motion pickers, JSON box, `window.bodyShapeLab` agent API. |

## 1. Turn the brief into a first shape

People describe feelings ("cuter", "more menacing"), not numbers. Start from the
closest row, then adjust. Every value is a multiplier: `1` means unchanged. These rows
are also in `PRESETS` (`applyPreset('chibi')` etc.).

| Brief | Starting shape |
| --- | --- |
| Chibi, Q版, 大头娃娃 | `spec: { head: 2, neckAlong: 0.5, torsoAlong: 0.7, armAlong: 0.6, legAlong: 0.55, hands: 1.4, feet: 1.4 }` |
| Supermodel, long legs, 长腿 | `spec: { legAlong: 1.45, torsoAlong: 0.95, head: 0.9, legGirth: 0.8 }` |
| Brute, strongman, 壮汉 | `spec: { torsoGirthBase: 1.3, torsoGirthTop: 1.6, armGirth: 1.9, legGirth: 1.5, head: 0.85, neckAlong: 0.5 }` |
| Heavy, round, 胖 | `spec: { torsoGirthBase: 1.7, torsoGirthTop: 1.4, limbGirth: 1.3 }` |
| Skinny, 瘦 | `spec: { torsoGirthBase: 0.75, torsoGirthTop: 0.8, limbGirth: 0.7 }` |
| Long arms, gibbon, 长臂 | `spec: { armAlong: 1.9, hands: 1.3 }` |
| Kid, dwarf, 小矮人 | `size: 0.6, spec: { head: 1.3, legAlong: 0.7 }` |
| Giant, 巨人 | `size: 1.8` (plain size, proportions kept) |

Pick the layer by what the brief touches:

- **`spec`** covers whole-body proportions and does the fiddly parts for you: the spine
  girth tapers from hips to chest, left and right stay symmetric, and finger, toe and
  face bones follow. Keys: `head`, `neckAlong`, `torsoAlong`, `torsoGirthBase` (hips),
  `torsoGirthTop` (chest; also widens shoulders), `limbAlong`, `limbGirth`, `armAlong`,
  `armGirth`, `legAlong`, `legGirth`, `hands`, `feet`. `arm*` / `leg*` override `limb*`.
- **`bones`**: per-bone scales by rig name, multiplied on top of `spec`. Use it for
  asymmetry and anything `spec` has no key for. A value is `{ along, width, thickness }`
  (each optional) or a bare number for uniform scale. `along` lengthens the bone's
  segment; `width` / `thickness` fatten its flesh. Each bone scales in its own frame and
  the effect never carries down the chain: to lengthen a whole arm, stretch **both**
  `upperarm_*` and `lowerarm_*`.
- **`size`**: uniform scale of the whole character ("bigger or smaller, same build").

Body bone names (`_l` / `_r` pairs): `pelvis`, `spine_01`..`spine_05`, `neck_01`,
`neck_02`, `head`, `clavicle_*`, `upperarm_*`, `lowerarm_*`, `hand_*`, fingers
(`thumb_01_l`, `index_01_l`, ...), `thigh_*`, `calf_*`, `foot_*`, `ball_*`, toes. The
441-bone rig adds `FACIAL_*` bones. Never hardcode indices: names are resolved through
`character.armature.rigBoneNames`. A misspelt name is skipped and reported in
`warnings` (and the console). `window.bodyShapeLab.listBones()` lists them.

**Keep values inside about 0.3 to 2.5.** Beyond that the flesh tears or thins between
stretched and unstretched bones. `applyBodyShape` warns when a value leaves that range.

## 2. Tune it where it can be seen

A shape is judged by eye, in motion. Numbers that read well in text can look broken on a
dancing body. Before putting anything in an app, open the lab:

```bash
cd labs && npm install && npm run dev
# http://localhost:5173/body-shape.html
```

Open it with a draft already applied (and optionally a character and motion):

```
http://localhost:5173/body-shape.html?char=young-man&motion=idle&shape=<encodeURIComponent(JSON.stringify(shape))>
```

The lab has presets, sliders for every `spec` key, per-limb sliders (left / right arm,
hand, leg), character and motion pickers, and a two-way JSON box: edit it and it applies
live. The URL always carries the current shape, so it doubles as a share link. Double-click
a slider to reset it.

### Driving the lab as an agent

The page exposes `window.bodyShapeLab`. From a browser tool (a page-script / JS-eval
call, in Playwright, Claude in Chrome, the in-app browser...) call it directly. Every
setter returns `{ shape, lift, warnings }`, all plain JSON:

```js
const lab = window.bodyShapeLab;
await lab.loadCharacter('dj-neko');          // ids: lab.listCharacters()
await lab.playMotion('idle');                // names: lab.listMotions()
lab.applyPreset('chibi');                    // names: Object.keys(lab.listPresets())
lab.setShape({ spec: { head: 1.6, legAlong: 0.8 } });   // replace everything
lab.patch({ spec: { head: 1.9 }, size: 0.9 });          // merge; null deletes a key
lab.patch({ bones: { upperarm_r: { along: 1.8 } } });
lab.getShape();                              // the final BodyShape JSON
lab.view('side');                            // 'full' | 'front' | 'side' | 'head'
lab.screenshot();                            // PNG data URL of the canvas
lab.reset();
```

A good agent loop: pick a preset from the brief -> `setShape` -> `view('full')` +
`screenshot()` and look at it -> `view('side')` / `view('head')` -> adjust with `patch`
-> repeat until it matches the brief -> hand back `getShape()`. Check at least two
characters and one moving motion (not only `idle`), because one multiplier reads
differently on different builds. Look for:

- flesh tearing or thinning between stretched and unstretched bones (back off the value);
- a big head sinking into the shoulders: raise `neckAlong` above 1;
- hands passing through a fat belly: trim `torsoGirthBase`, or pick a wider-armed motion.

When the result is right, the JSON from `getShape()` is the final `BodyShape`.

## 3. Wire it into the app

Copy `skills/body-shape/body-shape.js` next to your code (it only needs a `SplatCharacter`).
The first `applyBodyShape` call on a character remembers its scale and height, so apply shapes
after the character is placed in the scene but do not set `scale` yourself afterwards.

```js
import { VSplatLoader } from '@viggle/splat-engine-three';
import { applyBodyShape, getLift } from './body-shape.js';

const SHAPE = { spec: { head: 1.6, legAlong: 0.8 } };   // game data: keep it as a const

async function spawn(url) {
  const c = await new VSplatLoader().loadAsync(url);
  scene.add(c);
  c.play(idleClip);
  c.userData.lift = applyBodyShape(c, SHAPE).lift;
  return c;
}
```

Rules that are easy to get wrong:

- **A shape belongs to one character instance.** `clone()` and every new load start
  with the original body. Re-apply after every load, swap and clone: put the call inside
  the one function that spawns characters.
- **Feet.** Changing leg length or size moves the soles off the floor. `applyBodyShape`
  measures the correction (`lift`, metres) and moves `character.position.y` by it. Any code
  that later **sets** `position.y` as an absolute value (jumps, tweens, spawn points) must
  add `lift`, or it cancels the correction: `c.position.y = groundY + getLift(c)`. Code
  that only adds deltas (`position.y += dy`) is safe. `getLift(c)` returns the current
  value.
- **Change shape mid-run** (power-up, shrink curse, a hit that swells a limb) by calling
  `applyBodyShape` again with the new shape, or with `null` to restore the original
  body. Re-read `lift` each time. Each call runs a small bind-pose FK, fine at slider
  speed; for a tween step it at 10 to 20 Hz, not every frame.
- **`size` and `character.scale`.** `applyBodyShape` owns `character.scale` once a shape is
  applied (it multiplies the scale the character had on first apply by `size`). Don't set
  `scale` yourself afterwards; fold it into `shape.size`.
- **Gameplay geometry.** Anything reading bone world matrices
  (`character.getBoneWorldMatrix('head')`) follows the new shape automatically. Anything
  hardcoded for the default body does not: hitbox heights, a camera framing the head,
  "is the hand above the bar" thresholds. Grep for magic heights and derive them from
  bones, or scale them.
- **Contact clips.** There is no foot or hand IK. `lift` fixes standing height, but clips
  where hands touch the floor, the character sits, or two characters touch will be off by
  the change in limb length. Check those clips specifically.

## 4. Verify

Look at it, don't trust the numbers: render the shaped character with its feet on the
floor, in the framing the app really uses, playing the app's real clips. If the app swaps
characters, swap once and confirm the shape survives.

## Under the hood

`applyBodyShape` = `buildStretch(rigBoneNames, spec)` -> multiply `bones` in ->
`armature.setBoneStretch(factors)` -> `character.scale = base * size` -> FK over the bind
pose (`armature.skeleton.bindT/bindR`) with and without the lengthening
(`skeleton.lengthScale`) to find how far the lowest sole bone moved -> `position.y += lift`.
Lengthening is a per-bone multiplier on the local rest translation. Girth is a per-bone
matrix folded into the skinning palette, so the Gaussians' covariances scale with the
flesh. Neither touches the bind pose, which is why every clip keeps working. If you need
something the helper does not expose, `armature.setBoneStretch(factors)` is public: read its
JSDoc in `node_modules/@viggle/splat-engine-three/dist/types/armature.d.ts` and
`skeletal/bone-stretch.d.ts` before reaching past it.

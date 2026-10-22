# @viggle/splat-engine-three

Gaussian-splat characters for three.js. Load `.vsplat` characters as `Object3D`s, play MetaHuman GLB skeletal animations with crossfade blending, load `.ply` splat scenes, and render them in your own three.js scene under `WebGLRenderer` or `WebGPURenderer`.

A port of [`@viggle/splat-engine`](https://www.npmjs.com/package/@viggle/splat-engine) with no PlayCanvas dependency. The rig, animation and bundle-decoding code is shared with that package; the renderer is new.

## Install

```bash
npm install @viggle/splat-engine-three three
```

Built and tested against three.js r186.

## Quick start

Characters and splat scenes are ordinary three.js objects: load them with a loader, add them to your scene, move them with `position` / `rotation` / `scale`. Call `character.update(delta)` once per frame - the job `AnimationMixer.update` does for a skinned mesh.

```typescript
import * as THREE from 'three';
import { VSplatLoader, SplatClipLoader, SplatPLYLoader } from '@viggle/splat-engine-three';

const renderer = new THREE.WebGLRenderer({ canvas });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);

// A splat scene (optional). Many captures are authored Y-down.
const room = await new SplatPLYLoader().loadAsync('/assets/room.ply');
room.rotation.x = Math.PI;
scene.add(room);

// A character
const character = await new VSplatLoader().loadAsync('/assets/character.vsplat');
character.position.set(0, 0, 1);
scene.add(character);

// Clips
const clips = new SplatClipLoader();
const [idle, run] = await Promise.all([
  clips.loadAsync('/assets/idle.glb'),
  clips.loadAsync('/assets/run.glb'),
]);
character.play(idle);
character.crossFadeTo(run, 0.3);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  character.update(clock.getDelta());
  renderer.render(scene, camera);
});
```

Get character `.vsplat` files and animation `.glb` files from https://viggle.ai/pinoc/app/.

## API

### Loaders

All three extend `THREE.Loader`, so `load` / `loadAsync`, `setPath`, `setRequestHeader`, `setWithCredentials` and a `LoadingManager` work as usual. Each also has `parseAsync(arrayBuffer)` for bytes you already hold.

| Loader | Reads | Gives you |
|---|---|---|
| `VSplatLoader` | `.vsplat` character bundles | `SplatCharacter` |
| `SplatClipLoader` | MetaHuman-rig `.glb` animations | `SplatClip` |
| `SplatPLYLoader` | uncompressed 3D Gaussian Splatting `.ply` | `SplatMesh` |

### `SplatCharacter`

An `Object3D`. Its `position` is the model origin: a character in its rest pose stands on it.

```typescript
character.play(clip, { loop: false });        // cut to a clip
character.crossFadeTo(clip, 0.3);             // blend to a clip over 0.3 s
character.stop(0.2);                          // back to the rest pose

character.timeScale = 1.5;                    // playback speed
character.paused = true;
character.time;                               // seconds into the clip (settable)
character.duration;                           // length of the clip in seconds
character.clip;                               // what is playing, or null

character.addEventListener('finished', (e) => {});   // a non-looping clip ended
character.addEventListener('loop', (e) => {});       // a looping clip wrapped

// Optional for grounded clips such as a dance; pins the lowest splats to y=0.
// Leave unset for jumps or other intentional airborne motion.
character.groundLockY = 0;

// A second clip on part of the body, over the base clip
character.playLayer('wave', waveClip, { region: 'upperBody', weight: 0.8 });
character.stopLayer('wave', 0.2);

// Root motion: 'off' plays in place, 'apply' moves the body with the clip,
// 'extract' plays in place and hands you the travel
character.rootMotion = 'extract';
const step = character.consumeRootMotion();   // Vector3, local space, per frame

character.setTint('#ff4040', 0.6);            // blend toward a colour; 0 clears it
character.getBoneWorldMatrix('hand_r');       // Matrix4, to attach a prop

const twin = character.clone();               // shares the decoded data, not the pose
character.dispose();                          // free GPU resources
```

Expression `.vsplat` bundles with 119 bones use their 86 body bones and
per-character body rest lengths. Their remaining 33 facial influences follow
the head as a rigid group, keeping the face connected during animation. This
does not reproduce independent facial expressions; use a 441-bone character
for those.

Animation goes through this class, not `AnimationMixer`: a splat character has no `Bone` hierarchy for a mixer to drive. A `SplatClip` is not tied to a character - play one clip on any number of them, and call `clip.dispose()` when you are done with it.

For several copies of one character, load it once and `clone()` it; loading the same file twice decodes it twice.

### `SplatMesh`

A `Mesh`, so `visible`, `renderOrder`, `layers` and parent transforms behave as they do for any mesh. `SplatPLYLoader` gives it `renderOrder = -1` so it draws before characters; see [Depth and draw order](#depth-and-draw-order). `mesh.splat` holds its render options (`antiAlias`, `minPixelSize`, `setTint`, `setGrade`); `mesh.dispose()` frees it.

Splats are not pickable: `Raycaster` reports no hits on them.

### Lights

Splats carry baked colour and ignore the lights in your scene. To relight them, use the engine's own lights, which multiply that colour: ambient plus sun plus range-attenuated point lights, with no shading by surface direction.

```typescript
import { SplatEngine, SunLight, SkyLight, PointLight } from '@viggle/splat-engine-three';

SkyLight.create(SplatEngine.shared, { color: '#8ea8ff', intensity: 0.4 });
SunLight.create(SplatEngine.shared, { color: '#ffd9a0', intensity: 0.9 });
PointLight.create(SplatEngine.shared, { position: { x: 1, y: 1.5, z: 1 }, color: '#ff4020', intensity: 2, range: 2.5 });
```

`SplatEngine.shared` is the state loaders use by default - the skeleton library and these lights. With no lights set, splats render as authored.

## WebGL or WebGPU

The package draws under both `THREE.WebGLRenderer` and `WebGPURenderer`, and picks its implementation from whichever renderer draws a splat. The only thing you choose is the import: applications on `WebGPURenderer` import from `@viggle/splat-engine-three/webgpu`, the same way they import three.js itself from `three/webgpu`.

```typescript
import { WebGPURenderer } from 'three/webgpu';
import { VSplatLoader, SplatClipLoader, SplatPLYLoader } from '@viggle/splat-engine-three/webgpu';

const renderer = new WebGPURenderer({ canvas });
await renderer.init();
// ...everything else is identical
```

| | `THREE.WebGLRenderer` | `WebGPURenderer` |
|---|---|---|
| Import from | `@viggle/splat-engine-three` | `@viggle/splat-engine-three/webgpu` |
| Runs on | WebGL2 | WebGPU |
| Skinning | GPU, vertex stage | GPU, compute |
| Depth sort | CPU - main thread for characters, a worker for static meshes | GPU, compute |
| Per-character CPU cost | re-skins every splat centre each frame to feed the sort | a pose evaluation and a palette upload |

**Use WebGPU when you can.** Its cost per animated character is about a third of WebGL's, because nothing per-splat happens on the CPU. See [Performance](#performance).

`WebGPURenderer` must actually be running on WebGPU. Its WebGL2 fallback (`forceWebGL`, or a browser without WebGPU) has no compute shaders and cannot draw splats; the package logs an error saying so. Check before you build the scene, and use `THREE.WebGLRenderer` on those devices:

```typescript
if (renderer.backend.isWebGPUBackend !== true) { /* use THREE.WebGLRenderer instead */ }
```

### Colour and `WebGPURenderer`

Splat colours are display-referred (sRGB), and splats are trained to be alpha-blended in that space. `THREE.WebGLRenderer` draws straight to an sRGB canvas, so that is what happens.

`WebGPURenderer` with its default `outputColorSpace` renders into a linear buffer first and converts at the end, so splats blend in linear space instead. Soft edges - hair, fabric edges, anything semi-transparent - come out slightly different from the reference look. To get the reference look, have the renderer write its working space straight to the canvas:

```typescript
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
```

That setting applies to the whole renderer: other materials in the scene are then no longer converted to sRGB for you. If your scene depends on three.js colour management, leave the default and accept the difference on soft edges. Measured against the PlayCanvas build on a face close-up, the default leaves about 10% of pixels off by more than 8/255 (PSNR 33 dB); writing the working space directly leaves 0.02% (PSNR 48 dB).

## What is and is not ported

Ported, and checked against the PlayCanvas build by the A/B suite (see [Verification](#verification)):

- Characters - loading `.vsplat` bundles, position / rotation / scale, tint, colour grade
- Animation - GLB clips, crossfade, layers with bone masks, root motion
- Rig - pose evaluation, bone-length scaling (`setBoneStretch`)
- Splat scenes - uncompressed `.ply`, with position / rotation / scale
- `SunLight`, `SkyLight`, `PointLight`
- Render options - anti-aliasing, sub-pixel culling, per-group visibility (`setSplatGroups` / `setVariantMask`)
- Quality settings - `SplatQuality`, ported from the Unity build of the same engine rather than from the PlayCanvas one. Everything that applies to a renderer with no offscreen splat target; see [Tuning](#tuning) for which of its knobs did not come across and why.

Ported from the same source, but not exercised by the suite for want of test assets:

- Legacy `.bin` character bundles, and clips embedded in them
- `.anim` clips and animation events
- Multi-level character LOD (`Character.load([...])`, `addLodLevel`, `setRenderLod`) and variant splats (`addVariantSplat`)
- Animation LOD and sort LOD

Not ported:

- Shadows (`ShadowSystem`)
- Post effects (`PostFX`, pixel-art, CRT, outline, stained glass) and the VFX system
- Ragdoll and the physics joints
- `.spz`, compressed `.ply`, SOG and streamed LOD bundles for environments; environment clip bounds and camera cutaway
- Presets: `DamageVariant`, `BodyShapeVariant`, `CharacterMotor`, `WasdController`, camera controls, `TileGrid`, grid / sky dome / gizmos. The camera controls and helpers have direct three.js equivalents (`OrbitControls`, `GridHelper`, …).

## The engine-level API

Underneath the three.js-style API sits a second one, shaped like the PlayCanvas build's: `SplatEngine`, `Character`, `Animation`, `Environment`. It is what the A/B suite compares against that build, and it is how you reach the features the three.js-style API does not surface yet - multi-level character LOD, variant splats, animation and sort LOD, bone-length scaling.

`splatCharacter.character` is the engine-level `Character` behind a `SplatCharacter`, and `.armature` its rig, so the two can be mixed:

```typescript
character.armature.setBoneStretch({ thigh_l: { along: 1.3 }, calf_l: { along: 1.3 } });
await character.character.addLodLevel('/assets/character.l1.vsplat');
```

Used on its own it looks like this. Clips are registered and played by name, time is counted in frames, rotations are in degrees, and `engine.update(dt)` advances every character at once:

```typescript
import { SplatEngine, Character, Animation, Environment } from '@viggle/splat-engine-three';

const engine = new SplatEngine({ scene, camera });   // everything it loads is added under `scene`
await Environment.load(engine, '/assets/room.ply', { rotation: { x: 180, y: 0, z: 0 } });
const character = await Character.load(engine, '/assets/character.vsplat');
await Animation.loadGlb(engine, '/assets/run.glb', 'run');
character.playAnimation('run', { loop: true });

renderer.setAnimationLoop(() => {
  engine.update(clock.getDelta());
  renderer.render(scene, camera);
});
```

One difference to know when mixing the two: `Character.setPosition` lowers the model by a per-character ground offset carried over from the PlayCanvas build (about 8 cm on the test characters), to match how characters in that build's older bundle format sit. `SplatCharacter.position` applies no offset.

## Differences from the PlayCanvas build

- **No `Scene`.** `Scene.create(canvas)` + `scene.start()` become your own renderer, scene and render loop.
- **Environments always respond to lights.** In the PlayCanvas build an environment only follows `SunLight` / `SkyLight` once a `ShadowSystem` is bound; without one it stays unlit whatever lights exist. Here it follows them from the start.
- **Character bundles decode on the main thread.** There is no worker file to keep track of, so the bundler notes in that build's README do not apply. A bundle decodes in a few milliseconds.
- **Under WebGPU, at most 16 point lights and 64 variant groups** are evaluated.

### Depth and draw order

Splats test against the depth buffer and do not write it. Opaque meshes therefore occlude them correctly with no extra setup, but two splat objects are layered by draw order alone, not by depth. Static meshes from `SplatPLYLoader` draw first (`renderOrder = -1`), so characters always composite on top of the scene they stand in - the same layering the PlayCanvas build uses. A character that walks behind a wall of the splat scene is still drawn over it.

## Performance

For what to change when these numbers are not good enough on a given device, see [Tuning](#tuning).

Mean time per frame, 1920×1080, NVIDIA RTX 3090, Chromium (headless, vsync off), median of five runs. Lower is better. The first two columns are the original PlayCanvas engine on the same scenes, for reference.

<!-- BENCH_TABLE -->
| Scenario | Splats | PlayCanvas, WebGL | PlayCanvas, WebGPU | this package, WebGL | this package, WebGPU |
|---|--:|--:|--:|--:|--:|
| 1 character | 46,983 | 1.48 ms | 13.66 ms | 1.42 ms | **0.96 ms** |
| 8 characters | 356,960 | 11.37 ms | 12.76 ms | 13.44 ms | **4.18 ms** |
| 32 characters | 1,427,840 | 40.78 ms | 39.58 ms | 45.78 ms | **15.13 ms** |
| room, still camera | 1,048,576 | 2.73 ms | 15.54 ms | **1.70 ms** | 2.07 ms |
| room, orbiting camera | 1,048,576 | 3.39 ms | 15.54 ms | **1.86 ms** | 5.28 ms |
| room + 4 characters, orbiting | 1,227,056 | **6.64 ms** | 22.31 ms | 9.76 ms | 7.23 ms |
<!-- /BENCH_TABLE -->

Reading the table:

- The two WebGL columns do the same work per character - both re-skin every splat centre on the CPU to feed the depth sort - and are equal to within the run-to-run noise of the shared machine these were measured on (roughly ±20% on the character rows).
- The WebGPU backend moves that work to the GPU, which is where the 3x on the character rows comes from. What remains on the CPU is pose evaluation.
- With a moving camera and nothing animated, the WebGL backend is ahead: it re-sorts the environment in a worker and keeps drawing the previous order meanwhile, while the WebGPU backend re-sorts on the GPU inside the frame. The WebGPU result is never a frame behind; the WebGL one can be.
- The PlayCanvas WebGPU column sat on a ~13 ms floor in this harness, which drives that engine one `app.tick()` at a time. That was not investigated and may not reflect how it behaves under its own frame loop.

Regenerate with `npm run bench -- --backend <webgl|webgpu|webgpu-managed|pc-webgl|pc-webgpu>`, then `node scripts/readme-tables.mjs`.

## Tuning

A splat frame is bound by one of two things, and that decides which knobs do anything:

| Bound by | When | What moves it |
|---|---|---|
| **Fragments** (GPU) | WebGPU; anything static; a character filling the screen | `quadAlphaCutoff` |
| **Splats** (main thread) | WebGL with animated characters - every centre is re-skinned each frame to feed the CPU sort | `minOpacity`, `pruneRatio`, the distance throttles |

Measured on 32 animated characters under WebGL: 26.5 ms of main thread per frame, of which 23.7 ms is skinning and 2.8 ms the sort. `node ab/profile-stages.mjs` prints this split for any scene.

Settings are module-level, on `SplatQuality`, read per frame (or per decode, where stated). Two ship non-zero.

### `quadAlphaCutoff` — default `8 / 255`

Sizes each splat's quad to the radius its own opacity reaches, instead of the worst case. Fewer blended fragments; harder splat edges, visible first on hair, fabric and faces. **Takes effect next frame**, reversible, safe to drive from a frame-rate governor. Clamped to `[0, 1]`.

| Value | |
|---|---|
| `1 / 255` | Identical to the behaviour before this knob existed. A reference, not a setting. |
| `8 / 255` | **Default.** Also what the Unity build ships. |
| `12 / 255` | One step down. |
| `16 / 255` | **Low-end, and the floor.** |
| above `16 / 255` | Don't. More performance is there, but every silhouette hardens; spend it on `pruneRatio`, pixel ratio or a distance LOD instead. |

Cost on a face filling a 760px frame, against `1 / 255`: `8/255` 40.7 dB / 3.1% of pixels off by >8; `12/255` 36.8 dB / 7.8%; `16/255` 34.3 dB / 11.2%. Frame time where fragments bind, against `1 / 255`: `8/255` -29%, `16/255` -42%.

### `minOpacity` — default `0.05`, hard cap `0.1`

Drops splats whose peak opacity is below the threshold. Saves memory, skinning, sorting and rasterisation together, where `quadAlphaCutoff` saves rasterisation alone.

- **Applied during the decode of a character bundle.** Set it before `load()`; changing it later needs a reload.
- **Does not touch `.ply` scenes** - same scope as the Unity build. `0.05` removes 8.7% of the test character but 41.8% of the 1M-splat test room. `pruneSplats` is exported for scenes.
- **Changes `Splat.numSplats`.** A `setSplatGroups` array must be built from the loaded splats, not from the file. An array authored offline against the file cannot be truncated to fit - its indices no longer line up.
- **Values above `0.1` are clamped**, with one console warning. Enforced because every increment buys frame time while the cost arrives gradually and everywhere, so nothing tells a tuning pass to stop.

| Value | Cost on a face filling the frame | Splats kept |
|---|---|---|
| `0` | none | 100% |
| `1 / 255` | pixel-identical | 98% |
| `0.05` | max 20/255, 0.94% of pixels off by >8 | 91% |
| `0.1` (cap) | max 45/255, 9.3% of pixels off by >8 | 83% |

### The rest

```ts
SplatQuality.pruneRatio = 0.3;      // 0..1, decode-time, characters only: drop the weakest
                                    // share of every pruneVoxelSize cell by opacity x footprint
SplatQuality.pruneVoxelSize = 0.04; // metres; the cell that quota is per
SplatQuality.screenSizeCull = 0;    // pixels; drop splats smaller than this. For distant crowds
SplatQuality.depthOcclusion = true; // scene geometry hides splats. Correctness, not performance:
                                    // this renderer gets the hardware depth test for free
SplatQuality.passTimings = false;   // then read SplatQuality.timings after each render
```

`pruneRatio` ranks inside each cell, not globally: a face is many faint splats where a jacket is few strong ones, so a global rank deletes the face first.

### Distance throttles, per character

```ts
SplatEngine.shared.camera = camera;   // all three measure distance from it; without it they no-op

character.setSplatCountLod({ nearDist: 4, farDist: 16, farFraction: 0.25 });
character.armature.setSortLod({ nearDist: 5, farDist: 15, nearStride: 2, farStride: 4 });
character.armature.setAnimationLod({ nearDist: 12, farDist: 24, nearStride: 2, farStride: 4 });
```

All off until called. `nearStride` applies between `nearDist` and `farDist`, `farStride` beyond `farDist` - **set both**, or the band most of a crowd is standing in keeps its previous value.

`setSplatCountLod` is `pruneRatio` made dynamic: nothing is discarded, and the fraction skinned, sorted and drawn follows camera distance, by the same per-cell importance. WebGL backend only - that is the one paying per splat on the CPU.

### Per device

Pixel ratio first; it is not in this package and it is larger than everything below it. A phone reports `devicePixelRatio` 3, which is nine times the fragments.

```ts
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
```

| Tier | `quadAlphaCutoff` | `minOpacity` | `pruneRatio` | Pixel ratio | Also |
|---|---|---|---|---|---|
| Desktop / flagship | `8 / 255` | `0.05` | `0` | ≤ 2 | — |
| Mid-range phone | `12 / 255` | `0.05` | `0` | ≤ 1.5 | — |
| Low-end phone | `16 / 255` | `0.05` | `0.3` | ≤ 1.5 | `setSplatCountLod({ nearDist: 3, farDist: 12, farFraction: 0.25 })` |
| Very low-end, or a crowd | `16 / 255` | `0.05` | `0.5` | 1 | plus `setSortLod` / `setAnimationLod` |

On WebGL with several animated characters the cutoff column does nothing; spend the budget to its right.

### Measured

1920×1080, Apple M5 Pro, headless Chromium, vsync off. Baseline is **every knob off**, including the two that ship on, so the `DEFAULT` rows are what the defaults themselves cost and buy. `~` is inside that column's noise floor.

<!-- QUALITY_TABLE -->
| Setting | Splats | PSNR | Worst pixel | WebGL, 2 close | WebGL, 2 close, GPU only |
|---|--:|--:|--:|--:|--:|
| `DEFAULT cutoff 8/255` | - | 53.4 dB | 31/255 | ~ | -22% |
| `DEFAULT 8/255 + minOp 0.05` | 78,004 | 53.0 dB | 31/255 | -10% | -22% |
| `cutoff 12/255` | - | 48.5 dB | 47/255 | ~ | -24% |
| `cutoff 16/255` | - | 45.3 dB | 63/255 | ~ | -29% |
| `cutoff 16 + minOp 0.05` | 78,004 | 45.3 dB | 63/255 | -12% | -30% |
| `cutoff 24/255` | - | 40.8 dB | 98/255 | ~ | -34% |
| `cutoff 32/255` | - | 37.5 dB | 144/255 | ~ | -36% |
| `minOpacity 1/255` | 87,262 | ∞ | 0/255 | ~ | ~ |
| `minOpacity 0.05` | 78,004 | 61.7 dB | 14/255 | -11% | ~ |
| `prune 0.3` | 64,755 | 43.9 dB | 174/255 | -23% | -8% |
| `prune 0.5` | 45,952 | 37.8 dB | 187/255 | -42% | -20% |
| `screenSizeCull 1px` | - | ∞ | 0/255 | ~ | +10% |
| `screenSizeCull 2px` | - | 100.8 dB | 4/255 | ~ | ~ |
| `cutoff 16 + prune 0.3` | 64,755 | 40.3 dB | 179/255 | -22% | -36% |
| `cutoff 16 + prune 0.3 + minOp 0.05` | 56,824 | 40.2 dB | 179/255 | -31% | -36% |
| `countLod 0.5` | - | 35.2 dB | 190/255 | -43% | -17% |
| `countLod 0.3` | - | 31.1 dB | 196/255 | -41% | -35% |
| `countLod 0.3 + cutoff 16` | - | 30.4 dB | 201/255 | -57% | -47% |
| `sortLod stride 2` | - | 48.2 dB | 56/255 | -24% | ~ |
| `sortLod stride 4` | - | 48.2 dB | 56/255 | -24% | ~ |
| `animLod stride 2` | - | ∞ | 0/255 | -38% | ~ |

Noise floor per column: WebGL, 2 close ±9%, WebGL, 2 close, GPU only ±6%. `~` is a result inside it. Splats are per scene where a setting changes the count, `-` where it does not.
<!-- /QUALITY_TABLE -->

`screenSizeCull` culls nothing in these scenes (frames are bit-identical) yet reads +10% in one column: a single run can still mislead. The throttles read the same because two characters cannot separate skipping half the frames from skipping three quarters; on 32 characters, per-frame main-thread ms:

| | frame | update | skin | sort |
|---|--:|--:|--:|--:|
| baseline | 29.9 | 26.5 | 23.7 | 2.8 |
| `sortLod` stride 2 | 16.5 | 14.6 | 11.9 | 1.4 |
| `sortLod` stride 4 | 9.9 | 8.8 | 6.1 | 0.7 |
| `countLod 0.3` | 12.2 | 10.1 | 7.3 | 1.7 |
| `prune 0.5` | 16.7 | 14.7 | 11.9 | 1.4 |

With skinning throttled away the floor is pose evaluation, a couple of ms per 32 characters.

```bash
npm run build
node ab/run-quality-ab.mjs --backend webgl --scenario fill-2   # [--animate 0] for GPU alone
node ab/profile-stages.mjs --scenario crowd-32                 # which stage a setting cut
node ab/quality-shots.mjs                                      # contact sheets to judge by eye
node scripts/readme-tables.mjs                                 # rewrite the table above
```

Scenarios: `fill-2`, `crowd-16`, `crowd-32`, `room`, `room-4`.

### Not ported

`RenderScale`, `LdrRenderTarget`, `FitTargetToCharacters`, `FitCompositeOnly` act on an offscreen splat target. This package draws straight into the camera's target - the mode the Unity build measured as its fastest - so they have nothing to act on. For a lower splat resolution, render the whole frame smaller.

`SplitComputeAndDraw` (batching every splat's compute ahead of all draws, worth 11.6% on a Mali-G57) was ported and removed: `WebGPURenderer` already submits each compute call in its own command buffer ahead of the render pass, so there is no interleaving to undo, and it measured 6-18% slower.

## Verification

`ab/` holds an A/B suite that drives the PlayCanvas build and this package through the same cases - both characters, every supplied clip, crossfades, layers, root motion, transforms, tint, grade, lights, bone stretch, variant masks, and the splat scene - and compares:

- **Bone matrices**, numerically. They are bit-identical to the PlayCanvas build in every case.
- **Rendered frames**, per pixel. See the table below; the PlayCanvas build's own WebGL and WebGPU renderers differ from each other by about as much as this package differs from either.

The suite runs this package through the three.js-style API by default, and can run it through the engine-level API instead (`--api engine`); both pass. What has no counterpart in the PlayCanvas build - loaders and the `LoadingManager`, events, time in seconds, `clone`, `dispose` - is covered by `ab/check-api.mjs`.

<!-- AB_TABLE -->
| Compared with the PlayCanvas build (WebGL) | Cases | Bone matrices, max difference | PSNR, median | PSNR, worst | Pixels off by more than 8/255, worst case |
|---|--:|--:|--:|--:|--:|
| WebGL backend, characters | 66 | 0 | 55.5 dB | 45.7 dB | 0.050% |
| WebGL backend, environment | 10 | 0 | 44.1 dB | 42.6 dB | 0.040% |
| WebGPU backend, characters | 66 | 0 | 55.6 dB | 45.7 dB | 0.048% |
| WebGPU backend, environment | 10 | 0 | 44.1 dB | 42.6 dB | 0.041% |
<!-- /AB_TABLE -->

```bash
npm run build
npm run ab                       # WebGL vs PlayCanvas (WebGL), three.js-style API
npm run ab -- --port webgpu      # WebGPU
npm run ab -- --api engine       # the engine-level API instead
node ab/check-api.mjs            # the three.js-style API's own contract
node ab/check-stability.mjs      # still frames must be bit-stable
node ab/check-prune.mjs          # the load-time prune keeps every column in lockstep
node ab/check-animation.mjs      # a playing clip must actually reach the screen
```

The suite needs a GPU-backed headless Chromium (`npx playwright install chromium`).

## Licence

MIT. See [LICENSE](./LICENSE).

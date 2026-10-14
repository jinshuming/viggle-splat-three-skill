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

**Use WebGPU when you can.** With animated characters on screen a frame costs about 40% of what it does under WebGL, because nothing per-splat happens on the CPU. See [Performance](#performance).

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

Mean time per frame, 1920×1080, NVIDIA RTX 3090, Chromium (headless, vsync off), median of five runs. Lower is better. The first two columns are the original PlayCanvas engine on the same scenes, for reference.

<!-- BENCH_TABLE -->
| Scenario | Splats | PlayCanvas, WebGL | PlayCanvas, WebGPU | this package, WebGL | this package, WebGPU |
|---|--:|--:|--:|--:|--:|
| 1 character | 46,983 | 1.22 ms | 11.13 ms | 1.17 ms | **0.76 ms** |
| 8 characters | 356,960 | 14.13 ms | 11.08 ms | 10.29 ms | **3.91 ms** |
| 32 characters | 1,427,840 | 40.94 ms | 31.48 ms | 37.60 ms | **14.84 ms** |
| room, still camera | 1,048,576 | 2.77 ms | 14.47 ms | **1.71 ms** | 1.71 ms |
| room, orbiting camera | 1,048,576 | 3.40 ms | 14.67 ms | **1.85 ms** | 5.10 ms |
| room + 4 characters, orbiting | 1,227,056 | **5.44 ms** | 20.71 ms | 6.43 ms | 7.09 ms |
<!-- /BENCH_TABLE -->

Reading the table:

- The two WebGL columns do the same work per character - both re-skin every splat centre on the CPU to feed the depth sort - and are equal to within run-to-run noise. The machine was shared while these were measured; the character rows, which are CPU-bound, moved by about ±20% between runs.
- Under WebGPU that work moves to the GPU, which is where the 2.5x on the character rows comes from (3x in a run where the CPU was busier). What remains on the CPU is pose evaluation.
- With a turning camera and nothing animated, WebGL is ahead: it re-sorts a static mesh in a worker and keeps drawing the previous order meanwhile, while WebGPU re-sorts on the GPU inside the frame. The WebGPU order is never a frame behind; the WebGL one can be.
- The PlayCanvas WebGPU column sat on an ~11 ms floor in this harness, which drives that engine one `app.tick()` at a time. That was not investigated and may not reflect how it behaves under its own frame loop.

Regenerate with `npm run bench -- --backend <webgl|webgpu|webgpu-managed|pc-webgl|pc-webgpu>`, then `node scripts/readme-tables.mjs`.

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
node ab/check-consumer.mjs <dir> # pack, install into a Vite + TypeScript project, build, run
```

`check-consumer.mjs` takes a scratch project that depends on `three`, `vite` and `typescript` and has the README's quick start as its source; it verifies the published `exports`, the type declarations under `strict`, and that a minified production build still runs under both renderers.

The suite needs a GPU-backed headless Chromium (`npx playwright install chromium`).

## Licence

MIT. See [LICENSE](./LICENSE).

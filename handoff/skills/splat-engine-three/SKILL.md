---
name: splat-engine-three
description: Build with @viggle/splat-engine-three, the three.js plugin that renders Viggle Gaussian-splat characters (.vsplat) with skeletal animation, plus .ply splat scenes. Use it whenever someone wants to load, show, animate, move, light, clone or dispose a vsplat character in three.js; play or crossfade GLB motion clips; use root motion, animation layers, tint or colour grade; render a splat scene; choose WebGL vs WebGPU; or debug a character that is invisible, upside down, floating, sinking, or drawn in the wrong order. Also for Chinese requests like 高斯泼溅角色 / vsplat 加载 / 播放动作 / 切换动画 / 角色不显示 / 场景 ply / three.js 里放角色. This is the base skill: for re-proportioning a body use body-shape, for putting items in hands use held-item.
---

# @viggle/splat-engine-three

A three.js plugin. A `.vsplat` character is an ordinary `Object3D`; clips are separate objects;
you call `character.update(dt)` once per frame (the job `AnimationMixer.update` does for a skinned
mesh). Built and tested against three.js r186. Full reference: `engine/README.md`; exact types:
`node_modules/@viggle/splat-engine-three/dist/types/` (read the JSDoc before guessing an option).

## Install and minimal app

```bash
npm install three ./engine/viggle-splat-engine-three-0.1.0.tgz   # or the path your project uses
```

```js
import * as THREE from 'three';
import { VSplatLoader, SplatClipLoader, SplatPLYLoader } from '@viggle/splat-engine-three';

const renderer = new THREE.WebGLRenderer({ canvas });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);

const character = await new VSplatLoader().loadAsync('/assets/characters/young-man.vsplat');
scene.add(character);                                   // position = model origin; it stands on it
const idle = await new SplatClipLoader().loadAsync('/assets/motions/idle.glb');
character.play(idle, { loop: true });

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  character.update(clock.getDelta());                   // REQUIRED every frame, before render
  renderer.render(scene, camera);
});
```

The working versions of this are `demo-game/src/main.ts` and `labs/src/*.js`.

## Loaders (all `THREE.Loader`s: `loadAsync`, `setPath`, `parseAsync(arrayBuffer)`)

| Loader | Reads | Gives |
| --- | --- | --- |
| `VSplatLoader` | `.vsplat` character | `SplatCharacter` (an `Object3D`) |
| `SplatClipLoader` | MetaHuman-rig `.glb` (or `.anim`) motion | `SplatClip` (not tied to a character; one clip can play on many) |
| `SplatPLYLoader` | uncompressed 3DGS `.ply` | `SplatMesh` (a `Mesh`: a scene, prop or scanned object) |

## Character API (the 90%)

```js
character.play(clip, { loop: false });         // cut
character.crossFadeTo(clip, 0.3);              // blend over 0.3 s
character.stop(0.2);                           // back to rest pose
character.timeScale = 1.5;  character.paused = true;
character.time;  character.duration;  character.clip;
character.addEventListener('finished', e => {});   // non-looping clip ended
character.playLayer('wave', waveClip, { region: 'upperBody', weight: 0.8 });  // clip on part of the body
character.rootMotion = 'extract';              // 'off' (in place) | 'apply' | 'extract'
const step = character.consumeRootMotion();    // per-frame travel, feed a controller / physics
character.setTint('#ff4040', 0.6);  character.setGrade(contrast, saturation);
character.getBoneWorldMatrix('hand_r');        // Matrix4, to attach things (see held-item)
const twin = character.clone();                // shares decoded data; load once, clone for crowds
character.dispose();  clip.dispose();          // free GPU resources
```

Animation does NOT go through `AnimationMixer`: a splat character has no `Bone` hierarchy.
To drive the skeleton from something else (physics, IK), set `character.armature.poseProvider`
(see `demo-game/src/ragdoll.ts`; set it back to `null` to return to clips).

## Scenes, lights, renderer

- **Splat scene**: `const room = await new SplatPLYLoader().loadAsync(url); room.rotation.x = Math.PI;`
  (many captures are Y-down), scale to metres, and move it so the floor is at `y = 0`.
- **Lights**: splats carry baked colour and ignore three.js lights. To relight them use the engine's
  `SkyLight` / `SunLight` / `PointLight` (`.create(SplatEngine.shared, {...})`). No lights = as authored.
- **WebGL or WebGPU**: import from `@viggle/splat-engine-three` with `WebGLRenderer`, or from
  `@viggle/splat-engine-three/webgpu` with `three/webgpu`'s `WebGPURenderer` (`await renderer.init()`).
  WebGPU is faster for many animated characters, but its WebGL2 fallback cannot draw splats: check
  `renderer.backend.isWebGPUBackend === true` and otherwise use `WebGLRenderer`.
- **Draw order**: splats depth-test but do not write depth. Opaque meshes occlude splats correctly;
  two splat objects are layered by `renderOrder` only. `SplatPLYLoader` sets `renderOrder = -1`, so
  characters always draw over a splat scene (a character behind a scene wall still shows).
- Splats are not pickable by `Raycaster`.

## The rig and assets

- Characters use the PINOC 441-bone UE-style rig (`pelvis`, `spine_01..05`, `head`, `clavicle_*`,
  `upperarm_*`, `hand_*`, `thigh_*`, `foot_*`, `FACIAL_*`...). Always look bones up **by name**, via
  `character.armature.rigBoneNames` (`armature.boneNames` is always the 86-bone list and misindexes the 441-bone rig).
- Rest pose: the character faces **+X** with its right hand toward **+Z**; Y is up, units are metres.
  Rotate the object (`rotation.y = Math.PI`) to face a camera on +Z. The demos do this.
- Sample characters (`labs/public/assets/characters/`, listed in `index.json`) and motions
  (`labs/public/assets/motions/`, listed in `index.json`) were made with PINOC and are **CC BY-NC 4.0**:
  non-commercial, with credit. See `LICENSE` beside them.

## Pitfalls

- **Nothing visible**: forgot `scene.add(character)`, or `character.update(dt)` is not called, or the
  clip has not loaded yet (`await` the loader), or the camera is looking at the wrong side.
- **Loading the same file N times** decodes it N times. Load once, `clone()`.
- **Feet through the floor / floating**: `character.position.y` is the model origin; a rest-pose
  character stands on it. After changing bone lengths use the body-shape skill's `lift`.
- **Set `position` yourself**: with `rootMotion = 'apply'` the body moves under `position`; with
  `'extract'` you must apply `consumeRootMotion()` yourself or the character runs in place.
- **A second three.js copy** (two `node_modules/three`) breaks `instanceof` checks. Keep one version
  (the labs' `vite.config.js` shows `resolve.dedupe`).

## Related skills

- `body-shape`: change a character's proportions (head, legs, girth, size, one arm...).
- `held-item`: put weapons, shields, hats on sockets and tune where they sit.

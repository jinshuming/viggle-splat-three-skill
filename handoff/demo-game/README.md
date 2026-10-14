# Buddy Box (three.js)

A small physics sandbox built on [`@viggle/splat-engine-three`](https://www.npmjs.com/package/@viggle/splat-engine-three).
A Gaussian-splat character stands in a room. Grab any body part, drag it, and flick to throw. The character
turns into a ragdoll, lands, then stands back up and wanders. Rewritten from the PlayCanvas game; it has no
PlayCanvas dependency. Physics is [Rapier](https://rapier.rs).

```sh
npm install      # the engine is installed from ../engine/*.tgz
npm run dev      # http://localhost:5173
npm run build
```

## What to read

The whole game is five short files. The engine parts are marked below.

| File | What it shows |
|---|---|
| `src/main.ts` | Loading a character and clips (`VSplatLoader`, `SplatClipLoader`), the render loop, calling `character.update(dt)` |
| `src/buddy.ts` | Playing and crossfading clips (`character.play`, `crossFadeTo`); a custom pose provider that blends a ragdoll pose back to the idle pose |
| `src/ragdoll.ts` | **A `PoseProvider`**: hands the skeleton to physics. Start here if you want to drive a character from something other than a clip |
| `src/room.ts` | A plain three.js room with Rapier colliders |

### The engine API in about ten lines

```ts
import { VSplatLoader, SplatClipLoader } from '@viggle/splat-engine-three';

const character = await new VSplatLoader().loadAsync('/assets/characters/young-man.vsplat');
const idle = await new SplatClipLoader().loadAsync('/assets/motions/idle.glb');
scene.add(character);                       // an ordinary three.js Object3D
character.play(idle, { loop: true });       // clips are not tied to a character
renderer.setAnimationLoop(() => {
  character.update(clock.getDelta());       // advances the clip and skins the splats
  renderer.render(scene, camera);
});
```

### Driving a skeleton from physics (or anything else)

`character.armature.poseProvider = provider` replaces the animation. While one is attached the clip does not
advance; the provider fills a local pose (position, rotation, scale per bone) every frame and the engine still
does the skinning. `provider.writePose(pose)` is the only required method. `Ragdoll` in `src/ragdoll.ts` builds
one capsule body per bone, reads the bodies back each frame, and writes the result into `pose`.
Set `armature.poseProvider = null` to get animation back.

## Notes

- The engine in this repo does not ship a ragdoll. `src/ragdoll.ts` is a port of the PlayCanvas engine's, on
  Rapier: Rapier has no cone-twist joint, so joint limits are enforced with torques in `Ragdoll.preStep`.
- Physics runs at a fixed 120 Hz with at most 8 substeps per frame.
- Characters need the 441-bone UE-style rig (`pelvis`, `spine_03`, `thigh_l`, ...).
- WebGL2 renderer. To use `WebGPURenderer`, import from `@viggle/splat-engine-three/webgpu` and `three/webgpu`.

## Assets and license

`public/assets/` holds characters and motions made with PINOC, licensed
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/): non-commercial use, with credit.
See `public/assets/LICENSE`. Commercial use needs separate permission. The source code here is yours to adapt.

# Viggle Splat × three.js: handoff package

Gaussian-splat characters (`.vsplat`) in three.js: the engine plugin, a playable demo game, and agent
skills that let an AI agent change a character's body and put items in its hands.
这是 Viggle 高斯泼溅角色的 three.js 交付包：引擎插件、可玩的 demo 游戏、以及让 agent 调用的 skill。

## Find what you need / 你需要什么

| I want to... / 我想... | Go to |
| --- | --- |
| Use the engine in my own three.js app / 在自己的项目里用引擎 | [`engine/`](engine/): `viggle-splat-engine-three-0.1.0.tgz` + its [README](engine/README.md) |
| See a complete game built on it / 看完整的游戏示例 | [`demo-game/`](demo-game/) (Buddy Box: grab a character, throw it, it ragdolls) |
| Try body shape and held items interactively / 交互体验体型与手持物 | [`labs/`](labs/) (two lab pages, each with an agent API) |
| Give my AI agent the ability to operate characters / 让我的 agent 能操作角色 | [`skills/`](skills/): copy the folders you need into your agent's skills directory |

```
engine/        the three.js plugin (.tgz, README, LICENSE)
demo-game/     Buddy Box game, TypeScript + Rapier physics
labs/          Body Shape Lab + Held Item Lab, plus the sample characters, motions and items
skills/
  splat-engine-three/   base skill: load, animate, light, render, debug a character
  body-shape/           change proportions: head, legs, girth, size, asymmetric limbs
  held-item/            attach weapons, shields, hats to hands / head / back, tune each fit
```

## Quick start / 快速开始

Needs Node 20.19+ (or 22.12+, required by Vite 8) and a browser with WebGL2. Each folder is its own project:

```bash
cd demo-game && npm install && npm run dev     # the game, http://localhost:5173
cd labs      && npm install && npm run dev     # the labs,  http://localhost:5173
```

(`npm install` resolves the engine from `../engine/*.tgz`, so keep the folders side by side.)

## The skills / skill 怎么用

Each skill is a folder with a `SKILL.md` (what an agent reads) and, for the two feature skills, a
small dependency-free module (`body-shape.js`, `held-item.js`) that you copy into your app.

1. Copy `skills/<name>/` into your agent's skills directory (for Claude Code: `.claude/skills/`).
2. Ask the agent in plain language ("make this character chibi", "put a sword in the right hand").
   It reads `SKILL.md`, then either edits your app using the module or tunes the shape / fit in a lab
   page through `window.bodyShapeLab` / `window.heldItemLab` and hands you back a JSON value.
3. The JSON it returns (`BodyShape`, item definition) is plain data: keep it in your game's source.

| Skill | Output the agent produces | Lab it uses |
| --- | --- | --- |
| `body-shape` | a `BodyShape` JSON, applied with `applyBodyShape(character, shape)` | `labs/body-shape.html` |
| `held-item` | an item JSON (Fight3D items-manifest shape), equipped with `ItemRig` | `labs/held-item.html` |

## Verified in this package / 已验证

- `engine/`: the tarball is the exact build (same sha1) the original demos ran on, and its contents match the unpacked `package/` folder.
- `demo-game/` and `labs/`: fresh `npm install` + `npm run build` pass; dev servers run with no console errors.
- `body-shape`: feet stay on the floor (`lift`) within 1e-6 m across extreme shapes; all 8 sample characters accept a shape.
- `held-item`: the bone matrices match the Fight3D reference numbers exactly (rest pose), the item matrix math matches to 4e-4 (the reference's own rounding), mesh items occlude correctly, both hands, swaps and character swaps work.

## Known limits / 已知限制

- **Licenses.** The sample characters and motions were made with PINOC and are **CC BY-NC 4.0** (non-commercial, with credit): see `labs/public/assets/LICENSE`. The sample **items** (`labs/public/assets/items/`) come from the Fight3D project; confirm you may redistribute them before shipping them to a third party, or replace them with your own. The code is yours to adapt.
- **Splat (PLY) items**: drawn after the character, so they cannot be hidden by the body (use a GLB for items worn on the back), and they cannot be mirrored. Only coarsely checked visually.
- **No hand/foot IK.** Body shape changes limb lengths; clips where hands touch the floor or two characters touch will be off.
- `.anim` clips (Fight3D format) were not tested here; the demos use `.glb` motions.
- WebGPU was not exercised by the labs or the skills (the engine supports it; see its README).
- The engine's own `package.json` still lists maintainer-only `scripts` / `devDependencies` (`ab`, `bench`, `playwright`, `playcanvas`...) whose sources are not in the tarball. They are inert for consumers.

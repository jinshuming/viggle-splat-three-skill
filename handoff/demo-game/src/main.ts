import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SplatClipLoader, VSplatLoader, type SplatClip } from '@viggle/splat-engine-three';
import { Buddy } from './buddy';
import { ROOM, buildRoom, frameCamera } from './room';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const STEP = 1 / 120, MAX_SUBSTEPS = 8;
/** Forces and torques are separate accumulators in Rapier: an off-centre force adds a torque, and `resetForces` alone leaves it behind. */
const clearForces = (b: RAPIER.RigidBody) => { b.resetForces(true); b.resetTorques(true); };

async function main() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;

  // ---- three.js ----
  const canvas = $<HTMLCanvasElement>('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc7ccd1);
  const camera = new THREE.PerspectiveCamera();
  buildRoom(RAPIER, world, scene);

  const resize = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    frameCamera(camera, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---- assets: load a character and two clips, play clips with `character.play` ----
  const vsplat = new VSplatLoader().setPath('/assets/characters/');
  const clipLoader = new SplatClipLoader().setPath('/assets/motions/');
  const [idle, walk]: SplatClip[] = await Promise.all([clipLoader.loadAsync('idle.glb'), clipLoader.loadAsync('walk-in-place.glb')]);
  const clips = { idle, walk };

  let buddy: Buddy;
  const spawn = async (file: string) => {
    const character = await vsplat.loadAsync(file);
    scene.add(character);
    const next = new Buddy(RAPIER, world, character, clips);
    if (buddy) { scene.remove(buddy.character); buddy.destroy(); }
    buddy = next;
  };
  await spawn($<HTMLSelectElement>('character').value);

  // ---- input: grab a body part with the pointer, drag, flick to throw ----
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const pointer = new THREE.Vector3();
  const toWorld = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    ray.ray.intersectPlane(plane, pointer);
    pointer.x = THREE.MathUtils.clamp(pointer.x, -ROOM.halfWidth + 0.1, ROOM.halfWidth - 0.1);
    pointer.y = THREE.MathUtils.clamp(pointer.y, 0.12, ROOM.height - 0.15);
    pointer.z = 0;
  };
  let grab: { bone: string; local: THREE.Vector3; pointerId: number } | null = null;
  let samples: { x: number; y: number; t: number }[] = [];

  canvas.addEventListener('pointerdown', (e) => {
    toWorld(e);
    const hit = buddy.hitTest(pointer);
    if (!hit) return;
    buddy.activate();
    buddy.state = 'grabbed';
    // Remember where on the bone we grabbed, in the body's local frame.
    const body = buddy.ragdoll.bodyOf(hit.bone)!;
    const t = body.translation(), r = body.rotation();
    const local = hit.point.clone().sub(new THREE.Vector3(t.x, t.y, t.z)).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w).invert());
    grab = { bone: hit.bone, local, pointerId: e.pointerId };
    samples = [{ x: pointer.x, y: pointer.y, t: performance.now() }];
    canvas.setPointerCapture(e.pointerId);
    canvas.dataset.grabbing = '';
  });
  canvas.addEventListener('pointermove', (e) => {
    toWorld(e);
    if (grab) { samples.push({ x: pointer.x, y: pointer.y, t: performance.now() }); if (samples.length > 12) samples.shift(); }
    else canvas.dataset.hover = buddy.hitTest(pointer) ? '' : undefined as never;
  });
  const release = (e: PointerEvent) => {
    if (!grab || e.pointerId !== grab.pointerId) return;
    // Throw velocity from the last 100 ms of pointer movement.
    const now = performance.now(), recent = samples.filter((s) => now - s.t < 100);
    if (recent.length > 1) {
      const a = recent[0], b = recent[recent.length - 1], dt = Math.max(0.016, (b.t - a.t) / 1000);
      const vx = THREE.MathUtils.clamp((b.x - a.x) / dt, -25, 25), vy = THREE.MathUtils.clamp((b.y - a.y) / dt, -25, 25);
      for (const { body } of buddy.ragdoll.bodies) body.setLinvel({ x: vx * 0.8, y: vy * 0.8, z: 0 }, true);
    }
    grab = null;
    if (buddy.state === 'grabbed') buddy.state = 'ragdoll';
    delete canvas.dataset.grabbing;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // ---- UI ----
  $('reset').onclick = () => { grab = null; buddy.reset(); };
  $<HTMLSelectElement>('character').onchange = async (e) => {
    grab = null;
    try { await spawn((e.target as HTMLSelectElement).value); } catch (err) { console.error(err); }
  };
  const stateLabel: Record<string, string> = {
    idle: 'Ready for anything', walking: 'Just stretching my legs', grabbed: 'We have lift-off',
    ragdoll: 'Taking it in stride', recovering: 'Back on my feet',
  };

  // ---- loop: fixed physics steps, then the engine poses the character ----
  const clock = new THREE.Clock();
  let acc = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    acc += dt;
    for (let i = 0; acc >= STEP && i < MAX_SUBSTEPS; i++, acc -= STEP) {
      buddy.preStep(STEP);
      if (grab) buddy.pull(grab.bone, grab.local, pointer);
      world.step();
      world.forEachRigidBody(clearForces);
    }
    if (acc > STEP * MAX_SUBSTEPS) acc = 0;
    buddy.update(dt);
    // `update` advances the animation, or calls the pose provider while the ragdoll is active, then skins the splats.
    buddy.character.update(dt);
    renderer.render(scene, camera);
    $('state').textContent = stateLabel[buddy.state];
  });
  $('loading').remove();
}

main().catch((e) => { console.error(e); $('loading').textContent = 'Could not start: ' + e.message; });

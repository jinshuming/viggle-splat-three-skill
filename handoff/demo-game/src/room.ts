import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

export const ROOM = { halfWidth: 3.5, height: 4.1, halfDepth: 0.75 };
/** Rapier collision groups: (membership << 16) | filter. */
export const GROUP_ROOM = (0b01 << 16) | 0b10;
export const GROUP_RAGDOLL = (0b10 << 16) | 0b01; // hits the room, not other ragdoll bodies

/** A plain three.js room (visible meshes) with matching static Rapier colliders. */
export function buildRoom(R: typeof RAPIER, world: RAPIER.World, scene: THREE.Scene): () => void {
  const root = new THREE.Group();
  scene.add(root);
  const w = ROOM.halfWidth, h = ROOM.height, d = ROOM.halfDepth;
  const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  const wall = mat(0xe8eaec), floor = mat(0xcfd2d6), trim = mat(0xa9adb3);
  const bodies: RAPIER.RigidBody[] = [];

  const box = (p: [number, number, number], s: [number, number, number], m: THREE.Material | null) => {
    if (m) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...s), m);
      mesh.position.set(...p);
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(...p));
    world.createCollider(
      R.ColliderDesc.cuboid(s[0] / 2, s[1] / 2, s[2] / 2).setFriction(0.7).setRestitution(0.25).setCollisionGroups(GROUP_ROOM),
      body,
    );
    bodies.push(body);
  };
  box([0, -0.14, 0], [w * 2 + 0.4, 0.28, d * 2 + 0.6], floor);
  box([0, h + 0.12, 0], [w * 2 + 0.4, 0.24, d * 2 + 0.6], trim);
  box([-w - 0.12, h / 2, 0], [0.24, h, d * 2 + 0.6], wall);
  box([w + 0.12, h / 2, 0], [0.24, h, d * 2 + 0.6], wall);
  box([0, h / 2, -d - 0.1], [w * 2, h, 0.2], wall);
  box([0, h / 2, d + 0.1], [w * 2, h, 0.2], null); // invisible glass in front of the camera

  // Wall panel seams and a skirting board, so the flat wall reads as a room.
  const seam = mat(0xc4c8cd);
  const cols = Math.ceil((w * 2) / 1.15);
  for (let i = 1; i < cols; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.014, h, 0.004), seam);
    m.position.set(-w + (i * w * 2) / cols, h / 2, -d + 0.002);
    root.add(m);
  }
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.14, 0.03), trim);
  skirt.position.set(0, 0.07, -d + 0.015);
  root.add(skirt);

  // Lights for the room meshes. Splats ignore these; they carry their own baked colour.
  root.add(new THREE.HemisphereLight(0xffffff, 0xbfc4cc, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(-3, 6, 5);
  root.add(sun);

  return () => {
    scene.remove(root);
    root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    [wall, floor, trim, seam].forEach((m) => m.dispose());
    bodies.forEach((b) => world.removeRigidBody(b));
  };
}

/** Frame the whole room in a side view (same framing as the original game). */
export function frameCamera(camera: THREE.PerspectiveCamera, aspect: number): void {
  camera.fov = 35;
  camera.aspect = aspect;
  const halfHeight = Math.max(ROOM.height / 2 + 0.45, (ROOM.halfWidth + 0.3) / aspect);
  const distance = halfHeight / Math.tan((35 * Math.PI) / 360);
  camera.position.set(0, ROOM.height / 2, distance);
  camera.lookAt(0, ROOM.height / 2, 0);
  camera.far = distance + 10;
  camera.updateProjectionMatrix();
}

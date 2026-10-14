import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PoseProvider, SplatCharacter, SplatClip } from '@viggle/splat-engine-three';
import { Ragdoll, HUMANOID, type BoneDesc } from './ragdoll';
import { GROUP_RAGDOLL, ROOM } from './room';

type Pose = Parameters<PoseProvider['writePose']>[0];
export type BuddyState = 'idle' | 'walking' | 'grabbed' | 'ragdoll' | 'recovering';
export interface Clips { idle: SplatClip; walk: SplatClip }
export interface Hit { bone: string; point: THREE.Vector3 }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A plain-data stand-in for the engine's Pose, used to snapshot poses for blending. */
class PoseData {
  readonly pos: number[][]; readonly rot: number[][]; readonly scl: number[][];
  constructor(n: number) {
    this.pos = Array.from({ length: n }, () => [0, 0, 0]);
    this.rot = Array.from({ length: n }, () => [0, 0, 0, 1]);
    this.scl = Array.from({ length: n }, () => [1, 1, 1]);
  }
  /** The same method names the engine's Pose has, so `Ragdoll.writePose` can fill this too. */
  asPose(): Pose {
    const slot = (arr: number[][]) => arr.map((a) => ({ get x() { return a[0]; }, get y() { return a[1]; }, get z() { return a[2]; }, get w() { return a[3]; },
      set: (...v: number[]) => { v.forEach((x, i) => (a[i] = x)); } }));
    const self = this;
    return { positions: slot(this.pos), rotations: slot(this.rot), scales: slot(this.scl), get numBones() { return self.pos.length; },
      setToBind: (bindT: Float32Array, bindR: Float32Array) => {
        for (let i = 0; i < self.pos.length; i++) {
          // Write in place: the slots handed out above hold references to these arrays.
          self.pos[i].splice(0, 3, bindT[i * 3], bindT[i * 3 + 1], bindT[i * 3 + 2]);
          self.rot[i].splice(0, 4, bindR[i * 4], bindR[i * 4 + 1], bindR[i * 4 + 2], bindR[i * 4 + 3]);
          self.scl[i].splice(0, 3, 1, 1, 1);
        }
      } } as unknown as Pose;
  }
}

export class Buddy {
  state: BuddyState = 'idle';
  readonly ragdoll: Ragdoll;
  readonly height: number;
  private readonly descs: BoneDesc[];
  private readonly idlePose: PoseData;
  private readonly index = new Map<string, number>();
  private settled = 0; private activeTime = 0; private wait = 5; private walkTime = 0; private direction = 1; private recoverTime = 0;

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    readonly character: SplatCharacter,
    private readonly clips: Clips,
  ) {
    character.position.set(0, 0, 0);
    character.rotation.set(0, Math.PI, 0); // face the camera
    const arm = character.armature;
    arm.setAnimationLod({ nearStride: 1, farStride: 1 }); // always pose at full rate
    character.play(clips.idle, { loop: true });
    character.update(0);                                   // pose once so bone matrices exist
    arm.rigBoneNames.forEach((n, i) => this.index.set(n, i));
    for (const required of ['pelvis', 'spine_03', 'head', 'thigh_l', 'thigh_r']) {
      if (!this.index.has(required)) throw new Error(`Unsupported character rig: missing ${required}`);
    }
    // Scale the capsule radii to the character's height (the default humanoid is built for 1.75 m).
    this.height = clamp(this.bonePosition('head').y - this.bonePosition('foot_l').y + 0.22, 1, 2.6);
    const k = this.height / 1.75;
    this.descs = HUMANOID.map((d) => ({ ...d, radius: d.radius * k, length: d.length ? d.length * k : undefined }));
    this.ragdoll = new Ragdoll(R, world, character, this.descs, GROUP_RAGDOLL);
    this.idlePose = this.capturePose();
  }

  bonePosition(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const m = this.character.armature.boneWorldMatrices[this.index.get(name) ?? 0];
    return out.set(m.data[12], m.data[13], m.data[14]);
  }

  /** Snapshot the current animated pose as local TRS per bone. */
  private capturePose(): PoseData {
    const arm = this.character.armature, n = arm.numBones;
    const out = new PoseData(n);
    const parents = arm.skeleton.parents;
    const world = new THREE.Matrix4(), inv = new THREE.Matrix4(), local = new THREE.Matrix4();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      world.fromArray(arm.boneWorldMatrices[i].data);
      if (parents[i] < 0) inv.copy(this.character.matrixWorld); else inv.fromArray(arm.boneWorldMatrices[parents[i]].data);
      local.multiplyMatrices(inv.invert(), world).decompose(p, q, s);
      out.pos[i] = [p.x, p.y, p.z]; out.rot[i] = [q.x, q.y, q.z, q.w]; out.scl[i] = [s.x, s.y, s.z];
    }
    return out;
  }

  /** Closest ragdoll capsule to a world point, measured in the side-view plane. */
  hitTest(point: THREE.Vector3, padding = 0.075): Hit | null {
    let best: Hit | null = null, bestD = Infinity;
    const a = new THREE.Vector3(), e = new THREE.Vector3();
    for (const d of this.descs) {
      if (!this.index.has(d.bone)) continue;
      this.bonePosition(d.bone, a);
      if (d.endBone) this.bonePosition(d.endBone, e); else e.copy(a).add(new THREE.Vector3(0, d.length ?? 0.1, 0));
      const dx = e.x - a.x, dy = e.y - a.y;
      const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(1e-4, dx * dx + dy * dy), 0, 1);
      const dist = Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
      if (dist < d.radius + padding && dist < bestD) {
        bestD = dist;
        best = { bone: d.bone, point: new THREE.Vector3(point.x, point.y, a.z + (e.z - a.z) * t) };
      }
    }
    return best;
  }

  /** Hand the skeleton to physics. */
  activate(): void {
    this.settled = 0; this.activeTime = 0;
    if (this.ragdoll.isActive) return;
    this.ragdoll.enable();
    this.state = 'ragdoll';
  }

  /** Called every physics step, before the world steps. */
  preStep(dt: number): void {
    if (!this.ragdoll.isActive) return;
    this.ragdoll.preStep(dt);
    for (const { body } of this.ragdoll.bodies) {
      const v = body.linvel(), speed = Math.hypot(v.x, v.y, v.z);
      if (speed > 18) { const f = 18 / speed; body.setLinvel({ x: v.x * f, y: v.y * f, z: v.z * f }, true); }
      const w = body.angvel(), spin = Math.hypot(w.x, w.y, w.z);
      if (spin > 18) { const f = 18 / spin; body.setAngvel({ x: w.x * f, y: w.y * f, z: w.z * f }, true); }
      // Soft depth spring: the room is a shallow slab and the limbs should stay in it.
      const p = body.translation();
      const fz = clamp((-p.z * 80 - v.z * 12) * body.mass(), -1200, 1200);
      body.addForce({ x: 0, y: 0, z: fz }, true);
    }
  }

  /** Apply a spring force pulling a point on a bone toward `target` (used while grabbed). */
  pull(bone: string, localPoint: THREE.Vector3, target: THREE.Vector3): void {
    const body = this.ragdoll.bodyOf(bone);
    if (!body) return;
    const t = body.translation(), r = body.rotation();
    const point = localPoint.clone().applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).add(new THREE.Vector3(t.x, t.y, t.z));
    const v = body.linvel();
    const f = target.clone().sub(point).multiplyScalar(650).sub(new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(65));
    f.y += 190;
    if (f.length() > 1600) f.normalize().multiplyScalar(1600);
    body.addForceAtPoint(f, point, true);
  }

  reset(): void {
    this.ragdoll.disable();
    this.character.position.set(0, 0, 0);
    this.character.rotation.set(0, Math.PI, 0);
    this.character.play(this.clips.idle, { loop: true });
    this.character.update(0);
    this.state = 'idle'; this.wait = 5; this.settled = this.activeTime = 0;
  }

  /** Stand back up: blend from the ragdoll's last pose to the idle pose over 0.9 s. */
  private recover(): void {
    const x = clamp(this.bonePosition('pelvis').x, -ROOM.halfWidth + 0.8, ROOM.halfWidth - 0.8);
    const from = new PoseData(this.character.armature.numBones);
    this.character.position.set(x, 0, 0);
    this.character.rotation.set(0, Math.PI, 0);
    this.character.updateMatrixWorld(true);
    this.ragdoll.writePose(from.asPose());
    this.ragdoll.disable();
    this.recoverTime = 0;
    this.state = 'recovering';
    const idle = this.idlePose;
    // Any object with `writePose` can be a pose provider. While it is attached the clip does not advance.
    this.character.armature.poseProvider = {
      writePose: (pose) => {
        const t = clamp(this.recoverTime / 0.9, 0, 1), e = t * t * (3 - 2 * t);
        const q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
        for (let i = 0; i < from.pos.length; i++) {
          const a = from.pos[i], b = idle.pos[i];
          pose.positions[i].set(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e);
          const sa = from.scl[i], sb = idle.scl[i];
          pose.scales[i].set(sa[0] + (sb[0] - sa[0]) * e, sa[1] + (sb[1] - sa[1]) * e, sa[2] + (sb[2] - sa[2]) * e);
          qa.fromArray(from.rot[i]); qb.fromArray(idle.rot[i]);
          q.slerpQuaternions(qa, qb, e);
          pose.rotations[i].set(q.x, q.y, q.z, q.w);
        }
      },
    };
  }

  /** Once per frame, after the physics steps. */
  update(dt: number): void {
    const ch = this.character;
    if (this.state === 'recovering') {
      this.recoverTime += dt;
      if (this.recoverTime >= 0.9) {
        ch.armature.poseProvider = null;
        ch.crossFadeTo(this.clips.idle, 0.2, { loop: true });
        this.state = 'idle'; this.wait = 5;
      }
      return;
    }
    if (this.ragdoll.isActive) {
      this.activeTime += dt;
      let speed = 0;
      for (const { body } of this.ragdoll.bodies) {
        const v = body.linvel(), p = body.translation();
        speed = Math.max(speed, Math.hypot(v.x, v.y, v.z));
        if (!Number.isFinite(p.x + p.y + p.z) || Math.abs(p.x) > ROOM.halfWidth + 2 || p.y < -2 || p.y > ROOM.height + 3) { this.reset(); return; }
      }
      this.settled = speed < 0.8 ? this.settled + dt : 0;
      if (this.state !== 'grabbed' && (this.settled > 1.1 || this.activeTime > 16)) this.recover();
      return;
    }
    if (this.state === 'walking') {
      this.walkTime -= dt;
      ch.position.x = clamp(ch.position.x + this.direction * dt * 0.32, -ROOM.halfWidth + 0.8, ROOM.halfWidth - 0.8);
      if (this.walkTime <= 0) {
        this.state = 'idle';
        ch.rotation.y = Math.PI;
        ch.crossFadeTo(this.clips.idle, 0.3, { loop: true });
        this.wait = 5 + Math.random() * 5;
      }
    } else if ((this.wait -= dt) <= 0) {
      const x = ch.position.x;
      this.direction = x > 1 ? -1 : x < -1 ? 1 : Math.random() < 0.5 ? -1 : 1;
      this.state = 'walking'; this.walkTime = 1.3;
      ch.rotation.y = Math.PI + this.direction * 1.22; // ~70 degrees toward the walking direction
      ch.crossFadeTo(this.clips.walk, 0.25, { loop: true });
    }
  }

  destroy(): void {
    this.ragdoll.destroy();
    this.character.dispose();
  }
}

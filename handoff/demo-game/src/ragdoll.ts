// A ragdoll for a splat character, built on Rapier.
//
// splat-engine-three drives a character's skeleton from an animation clip. To hand the skeleton to
// something else (physics, IK, a network stream) you set `armature.poseProvider`. While one is
// attached the clip stops advancing and the provider fills in a local pose each frame; the engine
// still does the skinning. This file is such a provider:
//
//   enable()   build one capsule body per ragdoll bone at the character's current animated pose
//   writePose  read the bodies back and turn their world transforms into per-bone local TRS
//   disable()  remove the bodies and detach, so animation resumes
//
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Armature, PoseProvider, SplatCharacter } from '@viggle/splat-engine-three';

type Rapier = typeof RAPIER;
type Pose = Parameters<PoseProvider['writePose']>[0];

/** Allowed rotation of a child body relative to its parent, in radians about the child's local axes. */
export type Limits = { x: [number, number]; y: [number, number]; z: [number, number] };

export interface BoneDesc {
  bone: string;
  endBone?: string;      // capsule runs from `bone` to this bone's bind position
  length?: number;       // used when there is no end bone
  radius: number;
  mass: number;
  parent: string | null;
  /** Joint to the parent: free ball joint plus angular limits. `null` for the root. */
  limits: Limits | null;
}

const PI = Math.PI;
const cone = (swing: number, twist: number): Limits => ({ x: [-swing, swing], y: [-twist, twist], z: [-swing, swing] });
const hinge = (low: number, high: number): Limits => ({ x: [low, high], y: [-0.12, 0.12], z: [-0.12, 0.12] });

/** UE-style humanoid: 12 capsules (torso collapsed to two bodies, no fingers or toes). */
export const HUMANOID: BoneDesc[] = [
  { bone: 'pelvis', endBone: 'spine_03', radius: 0.13, mass: 8, parent: null, limits: null },
  { bone: 'spine_03', endBone: 'neck_01', radius: 0.12, mass: 10, parent: 'pelvis', limits: cone(PI / 6, PI / 8) },
  { bone: 'neck_01', endBone: 'head', radius: 0.08, mass: 4, parent: 'spine_03', limits: cone(PI / 4, PI / 6) },
  { bone: 'upperarm_l', endBone: 'lowerarm_l', radius: 0.05, mass: 2, parent: 'spine_03', limits: cone(PI / 2, PI / 3) },
  { bone: 'lowerarm_l', endBone: 'hand_l', radius: 0.045, mass: 1.2, parent: 'upperarm_l', limits: hinge(0, PI * 0.75) },
  { bone: 'upperarm_r', endBone: 'lowerarm_r', radius: 0.05, mass: 2, parent: 'spine_03', limits: cone(PI / 2, PI / 3) },
  { bone: 'lowerarm_r', endBone: 'hand_r', radius: 0.045, mass: 1.2, parent: 'upperarm_r', limits: hinge(0, PI * 0.75) },
  { bone: 'thigh_l', endBone: 'calf_l', radius: 0.07, mass: 5, parent: 'pelvis', limits: cone(PI / 3, PI / 8) },
  { bone: 'calf_l', endBone: 'foot_l', radius: 0.05, mass: 3, parent: 'thigh_l', limits: hinge(-PI * 0.75, 0) },
  { bone: 'thigh_r', endBone: 'calf_r', radius: 0.07, mass: 5, parent: 'pelvis', limits: cone(PI / 3, PI / 8) },
  { bone: 'calf_r', endBone: 'foot_r', radius: 0.05, mass: 3, parent: 'thigh_r', limits: hinge(-PI * 0.75, 0) },
  { bone: 'head', length: 0.08, radius: 0.12, mass: 3, parent: 'neck_01', limits: cone(0.4, 0.3) },
];

interface Rec {
  desc: BoneDesc;
  idx: number;
  length: number;
  radius: number;
  inertia: number;
  boneToBody: THREE.Matrix4;
  bodyToBone: THREE.Matrix4;
  parent: Rec | null;
  body: RAPIER.RigidBody | null;
  restRel: THREE.Quaternion;
}

/** Joint limits are enforced with torques instead of Rapier joint limits, because Rapier has no cone-twist joint. */
const LIMIT_STIFFNESS = 500;  // 1/s^2
const LIMIT_DAMPING = 14;     // 1/s
/** Joint friction: every joint bleeds off its relative spin, so limbs do not whip or keep twisting on their own. */
const JOINT_FRICTION = 4;      // 1/s
const BODY_ANGULAR_DAMPING = 0.6;
/** A joint's relative spin is capped, and a limit correction is capped, so a fast-spinning limb cannot pump itself up. */
const MAX_RELATIVE_SPIN = 12;  // rad/s
const MAX_EXCESS = 0.5;       // rad

const m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4(), m3 = new THREE.Matrix4();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), s1 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

export class Ragdoll implements PoseProvider {
  readonly bones: Rec[] = [];
  private readonly byName = new Map<string, Rec>();
  private readonly arm: Armature;
  private readonly bindWorld: THREE.Matrix4[];
  private joints: RAPIER.ImpulseJoint[] = [];
  private cache: THREE.Matrix4[] = [];
  private has: boolean[] = [];
  active = false;

  constructor(
    private readonly R: Rapier,
    private readonly world: RAPIER.World,
    private readonly character: SplatCharacter,
    descs: BoneDesc[],
    /** Rapier collision groups for the bodies: they collide with the room, not with each other. */
    private readonly groups: number,
  ) {
    this.arm = character.armature;
    const sk = this.arm.skeleton;
    this.bindWorld = bindWorldMatrices(sk.numBones, sk.bindT, sk.bindR, sk.parents);

    const nameToIdx = new Map<string, number>();
    this.arm.rigBoneNames.forEach((n, i) => n && nameToIdx.set(n, i));
    for (const desc of descs) {
      const rec = this.build(desc, nameToIdx);
      if (rec) { this.bones.push(rec); this.byName.set(desc.bone, rec); }
    }
    for (const b of this.bones) b.parent = b.desc.parent ? this.byName.get(b.desc.parent) ?? null : null;
  }

  private build(desc: BoneDesc, nameToIdx: Map<string, number>): Rec | null {
    const idx = nameToIdx.get(desc.bone);
    if (idx === undefined) return null;
    const bonePos = v1.setFromMatrixPosition(this.bindWorld[idx]).clone();
    const dir = new THREE.Vector3();
    let length = desc.length ?? 0;
    const endIdx = desc.endBone ? nameToIdx.get(desc.endBone) : undefined;
    if (endIdx !== undefined) {
      dir.setFromMatrixPosition(this.bindWorld[endIdx]).sub(bonePos);
      length = dir.length();
      dir.normalize();
    } else {
      dir.copy(Y).transformDirection(this.bindWorld[idx]);
    }
    if (length < 1e-4) return null;

    // Body frame: origin at the capsule centre, local +Y along the bone.
    const bodyRot = new THREE.Quaternion().setFromUnitVectors(Y, dir);
    const bodyBind = new THREE.Matrix4().compose(bonePos.clone().addScaledVector(dir, length / 2), bodyRot, new THREE.Vector3(1, 1, 1));
    const boneToBody = this.bindWorld[idx].clone().invert().multiply(bodyBind);
    return {
      desc, idx, length, radius: desc.radius,
      inertia: desc.mass * (length / 2 + desc.radius) ** 2 * 0.3,
      boneToBody, bodyToBone: boneToBody.clone().invert(),
      parent: null, body: null, restRel: new THREE.Quaternion(),
    };
  }

  get isActive(): boolean { return this.active; }
  bodyOf(bone: string): RAPIER.RigidBody | null { return this.byName.get(bone)?.body ?? null; }
  get bodies(): { name: string; body: RAPIER.RigidBody; rec: Rec }[] {
    return this.bones.filter((b) => b.body).map((b) => ({ name: b.desc.bone, body: b.body!, rec: b }));
  }

  /** Build the bodies at the character's current animated pose and take over the skeleton. */
  enable(): void {
    if (this.active) return;
    this.arm.poseProvider = null;
    const R = this.R;
    for (const b of this.bones) {
      const boneWorld = m1.fromArray(this.arm.boneWorldMatrices[b.idx].data);
      m2.multiplyMatrices(boneWorld, b.boneToBody).decompose(v1, q1, s1);
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(v1.x, v1.y, v1.z)
          .setRotation({ x: q1.x, y: q1.y, z: q1.z, w: q1.w })
          .setLinearDamping(0.24).setAngularDamping(BODY_ANGULAR_DAMPING).setCcdEnabled(true),
      );
      this.world.createCollider(
        R.ColliderDesc.capsule(b.length / 2, b.radius)
          .setMass(b.desc.mass).setFriction(0.65).setRestitution(0.27)
          .setCollisionGroups(this.groups)
          .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      b.body = body;
    }
    // Ball joints at the proximal end of each child capsule; the angular limits are enforced in `preStep`.
    for (const b of this.bones) {
      if (!b.parent || !b.desc.limits || !b.body || !b.parent.body) continue;
      const pivotInChild = new THREE.Vector3(0, -b.length / 2, 0);
      const anchorWorld = pivotInChild.clone().applyMatrix4(bodyMatrix(b.body, m1));
      const pivotInParent = anchorWorld.applyMatrix4(bodyMatrix(b.parent.body, m2).invert());
      const data = R.JointData.spherical(pivotInParent, pivotInChild);
      this.joints.push(this.world.createImpulseJoint(data, b.parent.body, b.body, true));
      b.restRel.copy(rot(b.parent.body, q1).invert().multiply(rot(b.body, q2)));
    }
    this.active = true;
    this.arm.poseProvider = this;
  }

  disable(): void {
    if (!this.active) return;
    this.teardown();
    if (this.arm.poseProvider === this) this.arm.poseProvider = null;
  }

  /** Called by the armature when another provider replaces this one. */
  onDetach(): void { this.teardown(); }

  private teardown(): void {
    for (const j of this.joints) this.world.removeImpulseJoint(j, true);
    this.joints = [];
    for (const b of this.bones) if (b.body) { this.world.removeRigidBody(b.body); b.body = null; }
    this.active = false;
  }

  destroy(): void { this.disable(); }

  /** Run once per physics step: keep each joint inside its angular limits. */
  preStep(dt: number): void {
    for (const b of this.bones) {
      const p = b.parent;
      const lim = b.desc.limits;
      if (!p?.body || !b.body || !lim) continue;
      // Joint friction on the relative spin (all axes), shared by inertia so momentum is kept.
      {
        const ic = meanInertia(b.body), ip = meanInertia(p.body), f = Math.min(1, JOINT_FRICTION * dt);
        const a = b.body.angvel(), c = p.body.angvel();
        let rx = a.x - c.x, ry = a.y - c.y, rz = a.z - c.z;
        const rel = Math.hypot(rx, ry, rz);
        const keep = rel > MAX_RELATIVE_SPIN ? MAX_RELATIVE_SPIN / rel : 1 - f; // fraction of relative spin that survives
        rx *= 1 - keep; ry *= 1 - keep; rz *= 1 - keep;
        const kc = ip / (ic + ip), kp = ic / (ic + ip);
        b.body.setAngvel({ x: a.x - rx * kc, y: a.y - ry * kc, z: a.z - rz * kc }, true);
        p.body.setAngvel({ x: c.x + rx * kp, y: c.y + ry * kp, z: c.z + rz * kp }, true);
      }
      const cq = rot(b.body, q2);
      // Child rotation relative to its rest orientation, in the child's local frame.
      const d = rot(p.body, q1).invert().multiply(cq);
      d.premultiply(b.restRel.clone().invert());
      if (d.w < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; d.w = -d.w; }
      const half = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
      const angle = 2 * Math.atan2(half, d.w);
      if (half < 1e-6) continue;
      const k = angle / half;
      const rv = [d.x * k, d.y * k, d.z * k];
      const ranges = [lim.x, lim.y, lim.z];
      const wc = b.body.angvel(), wp = p.body.angvel();
      const local = new THREE.Vector3();
      for (let i = 0; i < 3; i++) {
        const [lo, hi] = ranges[i];
        const raw = rv[i] < lo ? rv[i] - lo : rv[i] > hi ? rv[i] - hi : 0;
        const excess = Math.max(-MAX_EXCESS, Math.min(MAX_EXCESS, raw));
        if (excess === 0) continue;
        local.set(0, 0, 0).setComponent(i, 1);
        const axis = local.applyQuaternion(cq);
        const along = (wc.x - wp.x) * axis.x + (wc.y - wp.y) * axis.y + (wc.z - wp.z) * axis.z;
        // Pull the child back toward the limit, damp the relative spin, and push the parent the other way.
        const accel = -(LIMIT_STIFFNESS * excess + LIMIT_DAMPING * (Math.sign(excess) === Math.sign(along) ? along : 0));
        // Change the *relative* spin by accel*dt, shared between the two bodies by inertia (momentum is kept).
        // Using Rapier's real inertia matters: a guessed one overshoots and pumps energy into the ragdoll.
        const ic = meanInertia(b.body), ip = meanInertia(p.body);
        const dw = accel * dt;
        const kc = ip / (ic + ip), kp = -ic / (ic + ip);
        const wc2 = b.body.angvel(), wp2 = p.body.angvel();
        b.body.setAngvel({ x: wc2.x + axis.x * dw * kc, y: wc2.y + axis.y * dw * kc, z: wc2.z + axis.z * dw * kc }, true);
        p.body.setAngvel({ x: wp2.x + axis.x * dw * kp, y: wp2.y + axis.y * dw * kp, z: wp2.z + axis.z * dw * kp }, true);
      }
    }
  }

  /** PoseProvider: write the local pose of every ragdoll bone from its body. */
  writePose(pose: Pose): void {
    if (!this.active) return;
    const sk = this.arm.skeleton;
    const parents = sk.parents, n = sk.numBones;
    pose.setToBind(sk.bindT, sk.bindR);
    const entity = this.character.matrixWorld;
    while (this.cache.length < n) this.cache.push(new THREE.Matrix4());
    this.has.length = n; this.has.fill(false);

    const put = (i: number, m: THREE.Matrix4) => {
      m.decompose(v1, q1, s1);
      pose.positions[i].set(v1.x, v1.y, v1.z);
      pose.rotations[i].set(q1.x, q1.y, q1.z, q1.w);
      pose.scales[i].set(s1.x, s1.y, s1.z);
    };
    const boneWorld = (i: number): THREE.Matrix4 => {
      if (this.has[i]) return this.cache[i];
      const pi = parents[i];
      const local = m3.compose(
        v2.set(pose.positions[i].x, pose.positions[i].y, pose.positions[i].z),
        q2.set(pose.rotations[i].x, pose.rotations[i].y, pose.rotations[i].z, pose.rotations[i].w),
        s1.set(pose.scales[i].x, pose.scales[i].y, pose.scales[i].z),
      );
      this.cache[i].multiplyMatrices(pi < 0 || pi >= n ? entity : boneWorld(pi), local);
      this.has[i] = true;
      return this.cache[i];
    };

    // Anchor the rig's root bone to the pelvis body, so splats weighted to it follow the ragdoll.
    const pelvis = this.bones[0];
    if (pelvis?.body) {
      const rootIdx = parents[pelvis.idx];
      if (rootIdx >= 0 && rootIdx < n) {
        const desired = m1.multiplyMatrices(bodyMatrix(pelvis.body, m2), pelvis.bodyToBone);
        put(rootIdx, m2.copy(entity).invert().multiply(desired));
      }
    }
    // Each ragdoll bone: local = inverse(parent world) * (body world * bodyToBone).
    for (const b of this.bones) {
      if (!b.body) continue;
      const desired = m1.multiplyMatrices(bodyMatrix(b.body, m2), b.bodyToBone).clone();
      const pi = parents[b.idx];
      const parentW = pi < 0 || pi >= n ? entity : boneWorld(pi);
      put(b.idx, m2.copy(parentW).invert().multiply(desired));
      this.cache[b.idx].copy(desired);
      this.has[b.idx] = true;
    }
  }
}

function meanInertia(body: RAPIER.RigidBody): number {
  const i = body.principalInertia();
  return Math.max(1e-6, (i.x + i.y + i.z) / 3);
}
function bodyMatrix(body: RAPIER.RigidBody, out: THREE.Matrix4): THREE.Matrix4 {
  const t = body.translation(), r = body.rotation();
  return out.compose(v2.set(t.x, t.y, t.z), q1.set(r.x, r.y, r.z, r.w), s1.set(1, 1, 1));
}
function rot(body: RAPIER.RigidBody, out: THREE.Quaternion): THREE.Quaternion {
  const r = body.rotation();
  return out.set(r.x, r.y, r.z, r.w);
}

/** World (armature-space) bind matrices from the flat bind data. */
function bindWorldMatrices(n: number, bindT: Float32Array, bindR: Float32Array, parents: Int32Array): THREE.Matrix4[] {
  const out: (THREE.Matrix4 | null)[] = new Array(n).fill(null);
  const one = new THREE.Vector3(1, 1, 1);
  const get = (i: number): THREE.Matrix4 => {
    if (out[i]) return out[i]!;
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(bindT[i * 3], bindT[i * 3 + 1], bindT[i * 3 + 2]),
      new THREE.Quaternion(bindR[i * 4], bindR[i * 4 + 1], bindR[i * 4 + 2], bindR[i * 4 + 3]), one);
    out[i] = parents[i] < 0 ? local : get(parents[i]).clone().multiply(local);
    return out[i]!;
  };
  for (let i = 0; i < n; i++) get(i);
  return out as THREE.Matrix4[];
}

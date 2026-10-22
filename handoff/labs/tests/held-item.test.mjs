import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const { normalizationFromGrip, transformToMatrix4, itemLocalMatrix, ItemRig } =
  await server.ssrLoadModule('../skills/held-item/held-item.js');
await server.close();
const v = (x,y,z) => ({x,y,z});
const vec = (p) => new THREE.Vector3(p.x,p.y,p.z);
const near = (a,b,tolerance=1e-9) => assert.ok(a.distanceTo(b) < tolerance, `${a.toArray()} != ${b.toArray()}`);

test('source grip maps to origin, source forward to +Z, orthogonalized up to +Y', () => {
  for (const frame of [
    {position:v(1,2,-3),forward:v(0,1,0),up:v(0,0,1),scale:0.01},
    {position:v(-2,4,1),forward:v(1,2,3),up:v(-1,3,1),scale:1.3},
    {position:v(0,0,0),forward:v(0,0,-1),up:v(0,1,0),scale:2},
  ]) {
    const matrix=transformToMatrix4(normalizationFromGrip(frame));
    near(vec(frame.position).applyMatrix4(matrix),new THREE.Vector3());
    near(vec(frame.forward).transformDirection(matrix),new THREE.Vector3(0,0,1));
    const z=vec(frame.forward).normalize();
    const up=vec(frame.up).addScaledVector(z,-vec(frame.up).dot(z)).normalize();
    near(up.transformDirection(matrix),new THREE.Vector3(0,1,0));
    near(new THREE.Vector3().setFromMatrixScale(matrix),new THREE.Vector3().setScalar(frame.scale));
  }
});
test('reject unusable grip frames instead of silently producing an orientation', () => {
  const base={position:v(0,0,0),forward:v(0,0,1),up:v(0,1,0),scale:1};
  for (const patch of [{forward:v(0,0,0)},{up:v(0,0,3)},{scale:0},{scale:-1},{position:v(NaN,0,0)}])
    assert.throws(()=>normalizationFromGrip({...base,...patch}));
});
test('existing catalog retains Fight3D matrix convention and ZYX order', async () => {
  const catalog=JSON.parse(await readFile(new URL('../public/assets/items/catalog.json',import.meta.url)));
  const sword=catalog.find(d=>d.name==='swordI');
  const bone=new THREE.Matrix4().fromArray([-0.23206,0.22431,-0.94611,0,0.29484,0.94413,0.15147,0,0.92713,-0.24357,-0.28491,0,0.40662,0.95958,0.1702,1]);
  const actual=bone.multiply(itemLocalMatrix(sword.sockets.hand_r.transform,sword.local_transform)).elements;
  const expected=[-0.69282,0.27977,0.66443,0,0.38581,-0.63459,0.66949,0,0.60943,0.72076,0.33199,0,0.68835,1.15551,0.18561,1];
  actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-3,`${i}: ${n} != ${expected[i]}`));
});
test('bone-local grip remains attached through changing animated world transforms', () => {
  const frame={position:v(1,2,3),forward:v(0,1,0),up:v(0,0,1),scale:0.02};
  const fit={pos:v(0.03,0.07,-0.02),rot:v(20,40,-75),scale:1.2};
  const def={name:'test',local_transform:normalizationFromGrip(frame),sockets:{hand_r:{bone:'hand_r',transform:fit}}};
  let bone=new THREE.Matrix4();
  const char={armature:{rigBoneNames:['hand_r']},getBoneWorldMatrix:(_name,out)=>out.copy(bone)};
  const rig=new ItemRig(new THREE.Scene()), object=new THREE.Object3D();
  rig.setCharacter(char);rig.equip('hand_r',def,object);
  for(let i=0;i<5;i++) {
    bone.compose(new THREE.Vector3(i,1,-i),new THREE.Quaternion().setFromEuler(new THREE.Euler(i*0.3,i*0.8,0.2)),new THREE.Vector3(1,1,1));
    rig.update();
    near(vec(frame.position).applyMatrix4(object.matrix),vec(fit.pos).applyMatrix4(bone));
    assert.equal(object.visible,true);
  }
  rig.setCharacter(null);rig.update();assert.equal(object.visible,false);
  rig.setCharacter(char);rig.update();assert.equal(object.visible,true);
  rig.dispose();
});

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VSplatLoader, SplatClipLoader } from '@viggle/splat-engine-three';

const canvas = document.getElementById('c');
const statusEl = document.getElementById('status');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15161a);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 1.3, 4.2);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.9, 0);
controls.update();

const grid = new THREE.GridHelper(8, 16, 0x444444, 0x2a2a2a);
scene.add(grid);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const manifest = await (await fetch('/index.json')).json();
const loader = new VSplatLoader();
const clipLoader = new SplatClipLoader();
const [clipL, clipR] = await Promise.all(
  manifest.motions.map(m => clipLoader.loadAsync('/' + m.file)));

const FACE = 0; // 实测：不旋转时角色正对 +Z 的相机
let chars = [];
let paused = false;

async function showPair(i) {
  statusEl.textContent = '加载角色…';
  chars.forEach(c => { scene.remove(c); c.dispose(); });
  chars = [];
  const pair = manifest.pairs[i];
  const [l, r] = await Promise.all([pair.left, pair.right].map(id =>
    loader.loadAsync(`/characters/${id}.vsplat`)));
  [[l, clipL, -0.7], [r, clipR, 0.7]].forEach(([c, clip, x]) => {
    c.position.set(x, 0, 0);
    c.rotation.y = FACE;
    c.groundLockY = 0;
    c.rootMotion = 'off';
    c.timeScale = +document.getElementById('speed').value;
    c.paused = paused;
    c.play(clip, { loop: true });
    scene.add(c);
    chars.push(c);
  });
  statusEl.textContent = `${pair.name}（左 ${pair.left} / 右 ${pair.right}）· 拖动旋转，滚轮缩放`;
  document.querySelectorAll('#pairs button').forEach((b, j) => b.classList.toggle('on', j === i));
}

const pairsEl = document.getElementById('pairs');
manifest.pairs.forEach((p, i) => {
  const b = document.createElement('button');
  b.textContent = p.name;
  b.onclick = () => showPair(i);
  pairsEl.appendChild(b);
});
const playBtn = document.getElementById('play');
playBtn.onclick = () => {
  paused = !paused;
  chars.forEach(c => c.paused = paused);
  playBtn.textContent = paused ? '播放' : '暂停';
};
document.getElementById('speed').onchange = e => chars.forEach(c => c.timeScale = +e.target.value);

await showPair(0);

const ref = document.getElementById('ref');
const offEl = document.getElementById('off');
const offV = document.getElementById('offv');
const sndBtn = document.getElementById('snd');
offEl.oninput = () => offV.textContent = (+offEl.value).toFixed(2) + 's';
sndBtn.onclick = () => { ref.muted = !ref.muted; sndBtn.textContent = ref.muted ? '开启原声' : '关闭原声'; };
// 参考视频跟随 3D 角色的时间轴：视频时间 = 动作时间 + 偏移
function syncVideo() {
  const c = chars[0];
  if (!c || !ref.duration) return;
  const target = c.time + (+offEl.value);
  ref.playbackRate = c.timeScale;
  if (target < 0 || target > ref.duration) { if (!ref.paused) ref.pause(); return; }
  if (paused) { if (!ref.paused) ref.pause(); }
  else if (ref.paused) ref.play().catch(() => {});
  if (Math.abs(ref.currentTime - target) > 0.12) ref.currentTime = target;
}
// 时间轴：拖动时自动暂停并跳转，松手后恢复之前的状态
const tl = document.getElementById('tl');
const tt = document.getElementById('tt');
const play2 = document.getElementById('play2');
let scrubbing = false, resumeAfter = false;
function setPaused(p) {
  paused = p;
  chars.forEach(c => c.paused = p);
  playBtn.textContent = p ? '播放' : '暂停';
  play2.textContent = p ? '播放' : '暂停';
}
playBtn.onclick = play2.onclick = () => setPaused(!paused);
tl.addEventListener('pointerdown', () => { scrubbing = true; resumeAfter = !paused; setPaused(true); });
tl.addEventListener('input', () => chars.forEach(c => c.time = +tl.value));
addEventListener('pointerup', () => { if (scrubbing) { scrubbing = false; if (resumeAfter) setPaused(false); } });
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  chars.forEach(c => c.update(dt));
  const c0 = chars[0];
  if (c0) {
    tl.max = c0.duration;
    if (!scrubbing) tl.value = c0.time;
    const FPS = 25; // 动作 GLB 关键帧为 25fps（451 帧 / 18s）
    tt.textContent = `${(+tl.value).toFixed(2)} / ${c0.duration.toFixed(2)}s · 帧 ${Math.round(tl.value * FPS)} / ${Math.round(c0.duration * FPS)}`;
  }
  syncVideo();
  controls.update();
  renderer.render(scene, camera);
});

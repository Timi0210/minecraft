/* mesh-bench.cjs — 统计区块网格规模与视锥内批次数量，用来衡量批处理优化。
 * 用法：node tests/mesh-bench.cjs [种子] [半径]
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const noopCanvas = () => ({
  getContext: () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, drawImage() {}, fillRect() {}, clearRect() {}
  })
});
const globals = {
  console, performance, Math, Uint8Array, Uint32Array, Uint8ClampedArray,
  Float32Array, Int16Array, Map, Set, Array, Infinity, isFinite, Number
};
const context = vm.createContext({ ...globals, window: {}, document: { createElement: noopCanvas } });
for (const file of ['noise.js', 'blocks.js', 'world.js', 'mesher.js', 'renderer.js'])
  vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context, { filename: file });
const MC = context.window.MC;

const seed = Number(process.argv[2] || 2024);
const radius = Number(process.argv[3] || 4);
const world = new MC.World(seed, null);

const rows = [];
for (let cz = -radius; cz <= radius; cz++) for (let cx = -radius; cx <= radius; cx++) {
  const chunk = world.ensureChunk(cx, cz);
  const mesh = MC.meshChunk(world, chunk);
  rows.push({
    cx, cz,
    faces: mesh.faces,
    verts: mesh.opaque.verts.length / 10 + mesh.transparent.verts.length / 10,
    idx: mesh.opaque.idx.length + mesh.transparent.idx.length,
    opaqueBytes: mesh.opaque.verts.byteLength + mesh.opaque.idx.byteLength,
    transparentBytes: mesh.transparent.verts.byteLength + mesh.transparent.idx.byteLength
  });
}

const sum = (fn) => rows.reduce((a, r) => a + fn(r), 0);
const sortedFaces = rows.map(r => r.faces).sort((a, b) => a - b);
const pct = (p) => sortedFaces[Math.floor((sortedFaces.length - 1) * p)];
const total = rows.length;

console.log(`种子 ${seed} · ${(radius * 2 + 1) ** 2} 个区块`);
console.log('每个区块平均:');
console.log('  面数      ' + (sum(r => r.faces) / total).toFixed(1) +
  `  (中位 ${pct(0.5)}, p95 ${pct(0.95)}, 最大 ${sortedFaces[sortedFaces.length - 1]})`);
console.log('  顶点数    ' + (sum(r => r.verts) / total).toFixed(0));
console.log('  不透明    ' + (sum(r => r.opaqueBytes) / total / 1024).toFixed(1) + ' KB');
console.log('  透明      ' + (sum(r => r.transparentBytes) / total / 1024).toFixed(1) + ' KB');
console.log('  顶点上限  ' + (pct(0.99) * 4) + ' 个 (p99 面数 × 4)');

/* 粗略视锥：65° 水平视角，朝 -Z 看；只统计 GPU 网格会提交的区块。 */
const viewR = 10, fov = 65 * Math.PI / 180;
let visible = 0, visibleFaces = 0, visibleBytes = 0;
const halfTan = Math.tan(fov / 2);
for (let cz = -viewR; cz <= viewR; cz++) {
  for (let cx = -viewR; cx <= viewR; cx++) {
    const dx = cx * 16 + 8, dz = cz * 16 + 8;
    const dist = Math.hypot(dx, dz);
    if (dist > viewR * 16) continue;
    // 区块 AABB 的八个角都在视锥外才剔除；这里用中心+半径的保守近似。
    const r = 16;
    const inFrustum = Math.abs(dx) < Math.max(0, dist) * halfTan + r || dist < 24;
    if (!inFrustum) continue;
    const row = rows.find(x => x.cx === cx && x.cz === cz);
    if (!row) continue;
    visible++;
    visibleFaces += row.faces;
    visibleBytes += row.opaqueBytes + row.transparentBytes;
  }
}
console.log(`\n视距 ${viewR} 区块、65° 视角的估计:`);
console.log(`  可见区块（≈ draw call 数） ${visible}`);
console.log(`  可见面数 ${visibleFaces}`);
console.log(`  可见几何 ${(visibleBytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`  2×2 合并后 draw call ≈ ${Math.ceil(visible / 4)}，4×4 ≈ ${Math.ceil(visible / 16)}`);

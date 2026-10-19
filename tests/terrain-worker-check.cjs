/* 后台线程结果必须与原来的同步生成和网格完全一致。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const noopCanvas = () => ({ getContext: () => ({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, drawImage() {}, fillRect() {}, clearRect() {}
}) });
const globals = { console, Math, Uint8Array, Uint32Array, Uint8ClampedArray,
  Float32Array, Int16Array, Map, Set, Array };
function run(ctx, file) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), ctx, { filename: file });
}
const main = vm.createContext({ ...globals, window: {}, document: { createElement: noopCanvas } });
for (const file of ['noise.js', 'blocks.js', 'world.js', 'mesher.js']) run(main, file);
const MC = main.window.MC;

const messages = [];
const workerGlobal = { ...globals, postMessage: message => messages.push(message) };
workerGlobal.self = workerGlobal;
workerGlobal.importScripts = (...urls) => {
  for (const url of urls) run(worker, url.split('?')[0]);
};
const worker = vm.createContext(workerGlobal);
run(worker, 'terrain-worker.js');
worker.self.onmessage({ data: { type: 'init', seed: 2024 } });
assert.equal(messages.pop().type, 'ready');

const original = new MC.World(2024, [[193, 80, 160, MC.Block.TORCH]]);
worker.self.onmessage({ data: { type: 'generate', cx: 12, cz: 10 } });
const generated = messages.pop();
assert.equal(generated.type, 'generate');
const expected = original.ensureChunk(12, 10);
const actual = new MC.World(2024, [[193, 80, 160, MC.Block.TORCH]]);
const installed = actual.installChunk(12, 10, new Uint8Array(generated.blocks));
assert.deepEqual(installed.blocks, expected.blocks);
assert.deepEqual(installed.light, expected.light);

for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++)
  if (dx || dz) actual.ensureChunk(12 + dx, 10 + dz);
const center = actual.getChunk(12, 10);
const neighbors = [];
for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
  const c = actual.getChunk(12 + dx, 10 + dz);
  neighbors.push({ cx: c.cx, cz: c.cz, blocks: c.blocks, light: c.light, generated: true });
}
worker.self.onmessage({ data: { type: 'mesh', cx: 12, cz: 10, neighbors } });
const background = messages.pop();
const foreground = MC.meshChunk(actual, center);
assert.equal(background.type, 'mesh');
assert.equal(background.mesh.faces, foreground.faces);
for (const pass of ['opaque', 'transparent']) for (const field of ['verts', 'idx']) {
  const got = background.mesh[pass][field];
  const want = foreground[pass][field];
  assert.equal(got.length, want.length, pass + '.' + field + ' length');
  assert.equal(Buffer.compare(Buffer.from(got.buffer), Buffer.from(want.buffer)), 0,
    pass + '.' + field + ' differs');
}
const netherCx = original.netherExit.x >> 4;
worker.self.onmessage({ data: { type: 'generate', cx: netherCx, cz: 0 } });
const netherGenerated = messages.pop();
assert.equal(netherGenerated.type, 'generate');
const netherExpected = original.ensureChunk(netherCx, 0);
assert.deepEqual(new Uint8Array(netherGenerated.blocks), netherExpected.blocks);
console.log('PASS: 后台地表与下界生成、旧存档修改与网格完全一致');

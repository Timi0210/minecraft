/* verify.js — 无依赖的逻辑回归测试：node tests/verify.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const canvas = () => {
  const surface = { writes: [], drawCalls: [] };
  surface.getContext = () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img, x, y) => surface.writes.push({ img, x, y }),
    drawImage: (...args) => surface.drawCalls.push(args),
    fillRect: () => {},
    clearRect: () => {}
  });
  return surface;
};
const context = vm.createContext({
  console, performance, Math, Uint8Array, Uint32Array, Uint8ClampedArray, Float32Array,
  Int16Array, Map, Set, Array, window: {}, document: { createElement: canvas }
});
for (const file of ['noise', 'blocks', 'world', 'mesher', 'renderer',
  'items', 'crafting', 'particles', 'minimap', 'settings', 'horizon']) {
  const source = fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8');
  vm.runInContext(source, context, { filename: file + '.js' });
}
const MC = context.window.MC;

// 图集应输出含有真实子像素细节的 64px 材质，图标也从新图集裁切。
assert.equal(MC.Atlas.tile, 64);
assert.equal(MC.Atlas.size, 1024);
const stoneTile = MC.Atlas.canvas.writes[MC.Atlas.index.stone];
assert.equal(stoneTile.img.data.length, 64 * 64 * 4);
const stone = stoneTile.img.data;
let detailedCells = 0;
for (let by = 0; by < 16; by++) for (let bx = 0; bx < 16; bx++) {
  const p = ((by * 4) * 64 + bx * 4) * 4;
  if (stone[p] !== stone[p + 4] || stone[p] !== stone[p + 64 * 4]) detailedCells++;
}
assert(detailedCells > 200, '64px stone texture must contain fine detail within old 16px cells');
const stoneVariants = new Set();
for (let x = 0; x < 16; x++) stoneVariants.add(MC.Atlas.variant(MC.Atlas.index.stone, x, 12, 4, 0));
assert.equal(stoneVariants.size, 4);
const icon = canvas();
icon.width = 32;
MC.itemIcon(icon, 100, 32);
assert.equal(icon.drawCalls[0][3], 64);

function chunk(cx, cz) {
  return {
    cx, cz, blocks: new Uint8Array(36864), light: new Uint8Array(36864),
    generated: true, dirty: false,
    get(x, y, z) { return this.blocks[(y * 16 + z) * 16 + x]; }
  };
}
function lightWorld(minX, maxX, minZ, maxZ) {
  const world = Object.create(MC.World.prototype);
  world.chunks = new Map();
  world.lightSources = new Map();
  world.edits = new Map();
  world.editIndex = new Map();
  for (let cz = minZ; cz <= maxZ; cz++) {
    for (let cx = minX; cx <= maxX; cx++) {
      world.chunks.set(cx + ',' + cz, chunk(cx, cz));
    }
  }
  return world;
}

assert.equal(MC.BLOCKS.length, 44);
assert.equal(MC.ALL_ITEMS.length, 86);
assert.equal(MC.RECIPES.length, 36);
assert.equal(MC.BLOCKS[MC.Block.TORCH].light, 14);
assert.equal(MC.BLOCKS[MC.Block.TABLET].name, '石碑');
assert.equal(MC.BLOCKS[MC.Block.STONE_SWORD].name, '石中剑');
assert.equal(MC.BLOCKS[MC.Block.GLITCH].name, '丢失的贴图');
assert.equal(MC.MINE[MC.Block.TABLET].hard, -1);
assert.equal(MC.MINE[MC.Block.STONE_SWORD].hard, -1);
assert(MC.SECRET_ITEMS.has(MC.ITEM_KEY.broken_steel));
assert(MC.SECRET_ITEMS.has(MC.ITEM_KEY.moon_wool));
assert.equal(MC.itemTool(120).maxDur, 59);
assert.equal(MC.itemTool(140).maxDur, 1561);
const torchRecipe = MC.RECIPES.find(r => r.out.id === MC.Block.TORCH);
assert(torchRecipe);
assert.equal(MC.craftMatch(MC.craftFill(torchRecipe)), torchRecipe);
assert.equal(MC.craftIngredients(torchRecipe).join(','), '101,100');

// 火把在区块边缘传播、拆除后熄灭，墙后不透光。
const world = lightWorld(-1, 1, -1, 1);
world.setBlock(0, 10, 0, MC.Block.TORCH);
assert.equal(world.getLight(0, 10, 0), 14);
assert.equal(world.getLight(11, 10, 0), 3);
world.setBlock(15, 10, 0, MC.Block.TORCH);
assert.equal(world.getLight(16, 10, 0), 13);
world.setBlock(15, 10, 0, 0);
assert.equal(world.getLight(16, 10, 0), 0);
world.setBlock(0, 10, 0, 0);
assert.equal(world.getLight(11, 10, 0), 0);
for (let z = -15; z <= 15; z++) {
  for (let y = 0; y <= 30; y++) {
    const c = world.getChunk(0, z >> 4);
    c.blocks[(y * 16 + (z & 15)) * 16 + 2] = MC.Block.STONE;
  }
}
world.setBlock(0, 10, 0, MC.Block.TORCH);
assert.equal(world.getLight(3, 10, 0), 0);
assert.equal(world.getLight(1, 10, 0), 13);
world.setBlock(0, 10, 0, 0);
assert.equal(world.getLight(1, 10, 0), 0);

// 网格顶点通道和动物网格在同一布局中保持有效。
const c = world.getChunk(0, 0);
c.blocks.fill(0);
c.light.fill(0);
c.blocks[(10 * 16) * 16 + 1] = MC.Block.TORCH;
const mesh = MC.meshChunk(world, c);
assert.equal(mesh.opaque.verts.length % 10, 0);
assert(mesh.faces > 0);
const renderer = Object.create(MC.Renderer.prototype);
renderer.mobCache = new Map();
renderer.makeMesh = data => data;
const mobCube = renderer.getMobCube({
  top: MC.MOB_TILES.wool, side: MC.MOB_TILES.wool,
  bottom: MC.MOB_TILES.wool
});
assert.equal(mobCube.verts.length, 240);
assert.equal(mobCube.idx.length, 36);

// 读档和后加载区块只凭 edits 重建方块光。
const restored = new MC.World(2024, [[1, 140, 1, MC.Block.TORCH]]);
restored.ensureChunk(0, 0);
assert.equal(restored.getBlock(1, 140, 1), MC.Block.TORCH);
assert.equal(restored.getLight(1, 140, 1), 14);
assert.equal(restored.saveData().edits.length, 1);
const lazy = new MC.World(2024, [[15, 140, 1, MC.Block.TORCH]]);
lazy.ensureChunk(0, 0);
lazy.ensureChunk(1, 0);
assert.equal(lazy.getLight(16, 140, 1), 13);

// 后放置的实心墙撤去墙后光，挖通后重新传播。
const barrier = lightWorld(-1, 1, -1, 1);
barrier.setBlock(0, 10, 0, MC.Block.TORCH);
assert.equal(barrier.getLight(3, 10, 0), 11);
for (let z = -15; z <= 15; z++) {
  for (let y = 0; y <= 30; y++) barrier.setBlock(2, y, z, MC.Block.STONE, false);
}
assert.equal(barrier.getLight(3, 10, 0), 0);
barrier.setBlock(2, 10, 0, 0, false);
assert(barrier.getLight(3, 10, 0) > 0);

// 重叠光源与区块卸载均能正确撤光。
const overlap = lightWorld(-1, 1, -1, 1);
overlap.setBlock(0, 70, 0, MC.Block.TORCH);
overlap.setBlock(8, 70, 0, MC.Block.TORCH);
overlap.setBlock(0, 70, 0, 0);
assert.equal(overlap.getLight(4, 70, 0), 10);
overlap.setBlock(8, 70, 0, 0);
assert.equal(overlap.getLight(4, 70, 0), 0);
const unload = lightWorld(0, 1, 0, 0);
unload.setBlock(15, 70, 0, MC.Block.TORCH);
assert.equal(unload.getLight(16, 70, 0), 13);
unload.unloadChunk(unload.getChunk(0, 0));
assert.equal(unload.getLight(16, 70, 0), 0);

// 测试 main.js 的实际函数：旧档工具、材料扣除、损坏及存档。
const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
function between(start, end) { return main.slice(main.indexOf(start), main.indexOf(end)); }
const inventoryFactory = new Function('MC', 'state', 'ui', `
  const MAX_STACK = 64; let dirtySave = false;
  ${between('  const stack =', '  const START_HOTBAR')}
  ${between('  function parseStacks', '  const world =')}
  ${between('  function addToBag', '  function openInventory')}
  const {toast, showItemName, renderCraftGrid, refreshCraft, paintSlot, sfx} = ui;
  ${between('  function missingCraftMaterials', '  function putInGrid')}
  ${between('  function wearHeldTool', '  function resetMine')}
  return { stack, parseStacks, takeCraft, wearHeldTool };
`);
const state = {
  bag: Array(27).fill(null), hotbar: [null], selected: 0,
  craftGrid: Array(9).fill(0), craftRecipe: null
};
const messages = [];
const inventory = inventoryFactory(MC, state, {
  toast: message => messages.push(message), showItemName: () => {},
  renderCraftGrid: () => {}, refreshCraft: () => {},
  paintSlot: () => {}, sfx: { noise: () => {} }
});
assert.equal(inventory.parseStacks([[120, 1]], 1)[0].dur, 59);
assert.equal(inventory.parseStacks([[120, 1, 7, 59]], 1)[0].dur, 7);
state.craftRecipe = torchRecipe;
state.craftGrid = Array.from(MC.craftFill(torchRecipe));
inventory.takeCraft();
assert(messages.at(-1).includes('缺少'));
state.bag[0] = inventory.stack(101, 2);
state.bag[1] = inventory.stack(100, 2);
inventory.takeCraft();
assert.equal(state.bag[0].count, 1);
assert.equal(state.bag[1].count, 1);
assert(state.bag.some(s => s && s.id === MC.Block.TORCH && s.count === 4));
const toolRecipe = MC.RECIPES.find(r => r.out.id === 120);
state.bag = Array(27).fill(null);
state.bag[0] = inventory.stack(MC.Block.PLANKS, 3);
state.bag[1] = inventory.stack(100, 2);
state.craftRecipe = toolRecipe;
inventory.takeCraft();
const crafted = state.bag.find(s => s && s.id === 120);
assert(crafted && crafted.dur === 59);
state.hotbar[0] = crafted;
for (let i = 0; i < 58; i++) inventory.wearHeldTool();
assert.equal(state.hotbar[0].dur, 1);
inventory.wearHeldTool();
assert.equal(state.hotbar[0], null);
assert(messages.at(-1).includes('损坏'));
let savedJson = '';
const saveFactory = new Function('world', 'state', 'localStorage', 'player', `
  const SAVE_KEY = 'mcweb.save.v1'; let dirtySave = true, lastTimeSave = 0;
  const toast = () => {};
  ${between('  function saveWorld', '  setInterval(saveWorld')}
  return saveWorld;
`);
const save = saveFactory({ saveData: () => ({ seed: 2024, edits: [] }) }, {
  bag: [inventory.stack(120, 1, 17)], hotbar: [inventory.stack(1, 3)],
  time: 1, seen: { origin: true }, flags: { swordPulled: true }, explored: [[1, 2]]
}, { setItem: (key, value) => {
  assert.equal(key, 'mcweb.save.v1'); savedJson = value;
} }, { pos: [222.5, 91, 217.5], yaw: 1.2, pitch: -0.3, flying: true });
save(true);
assert.equal(JSON.parse(savedJson).inv[0][2], 17);
assert.deepEqual(JSON.parse(savedJson).player.pos, [222.5, 91, 217.5]);
assert.equal(JSON.parse(savedJson).secrets.origin, true);
assert.deepEqual(JSON.parse(savedJson).explored, [[1, 2]]);
const restoreFactory = new Function('MC', 'world', 'saved', 'seed', `
  ${between('  const player = new MC.Player(world);', '  const mobManager')}
  return player;
`);
const playerStub = { Player: class {
  constructor() { this.pos = [0, 65, 0]; this.yaw = 0; this.pitch = 0; this.flying = false; }
} };
const restoredPlayer = restoreFactory(playerStub, {}, JSON.parse(savedJson), 2024);
assert.deepEqual(restoredPlayer.pos, [222.5, 91, 217.5]);
assert.equal(restoredPlayer.flying, true);
assert.deepEqual(restoreFactory(playerStub, {}, { seed: 2024, edits: [] }, 2024).pos, [0, 65, 0]);

// 粒子池封顶，碰到地形消失；多个粒子只提交一个绘制调用。
const pool = Object.create(MC.Particles.prototype);
pool.enabled = true;
pool.pool = Array.from({ length: 512 }, () => ({ alive: false }));
pool.activeCount = 0;
pool.cursor = 0;
for (let i = 0; i < 600; i++) {
  pool.emit(i, 20, 0, 0, 0, 0, 0.1, 1, MC.BLOCKS[3].tex.side, 1, 1, 1);
}
assert.equal(pool.activeCount, 512);
pool.update(0.1, { getBlock: () => MC.Block.STONE });
assert.equal(pool.activeCount, 0);
let draws = 0;
const gl = new Proxy({}, { get(_target, key) {
  if (['createShader', 'createProgram', 'createVertexArray', 'createBuffer'].includes(key)) return () => ({});
  if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
  if (key === 'getUniformLocation') return () => ({});
  if (key === 'drawArrays') return () => { draws++; };
  if (typeof key === 'string' && key.toUpperCase() === key) return 1;
  return () => {};
} });
const particles = new MC.Particles({ gl });
particles.emit(0, 10, 0, 0, 0, 0, 0.1, 1, MC.BLOCKS[3].tex.side, 1, 1, 1);
particles.emit(1, 10, 0, 0, 0, 0, 0.1, 1, MC.BLOCKS[3].tex.side, 1, 1, 1);
particles.render({ vp: new Float32Array(16), canvas: { height: 700 }, texture: {} }, { fov: 65 });
assert.equal(draws, 1);

// 小地图首帧先有低清图，不等待完整 96 行。
const minimap = new MC.Minimap({
  biomeField: () => ({}), heightAt: () => 50, biomeAt: () => 'plains'
}, { classList: {} }, canvas(), {});
minimap.startBuild({ pos: [0, 60, 0] });
assert.equal(minimap.previewReady, true);
assert.equal(minimap.ready, false);

// 开放世界站点：每个种子都有可发现的注脚，说明石碑覆盖多种群系。
const open = new MC.World(2024);
assert.equal(open.sites.filter(s => s.type === 'tablet').length, 9);
assert.equal(open.sites.filter(s => s.type === 'origin').length, 1);
assert(open.sites.some(s => s.type === 'cabin'));
assert(open.sites.some(s => s.type === 'giant'));
assert(!open.sites.some(s => s.type === 'guardian'));
// 新冰川谷应是可进入的雪原，后方主峰高出谷底，且峰顶仍在世界高度内。
const glacier = open.glacier;
const valleyY = open.heightAt(glacier.x, glacier.z);
const summitX = Math.round(open.peaks[0][0]), summitZ = Math.round(open.peaks[0][1]);
const summitY = open.heightAt(summitX, summitZ);
assert(open.glacierWeight(glacier.x, glacier.z) > 0.8);
assert(summitY - valleyY >= 48);
assert(summitY < MC.WORLD.HEIGHT - 8);
assert(open.outpost.y + 22 < MC.WORLD.HEIGHT);
assert(open.biomeField(980, 260).mountain > 0.7);
assert(open.heightAt(980, 260) > 78);
for (const [x, z, expected] of [[glacier.x, glacier.z, MC.Block.SNOW],
  [summitX, summitZ, MC.Block.STONE]]) {
  open.ensureChunk(x >> 4, z >> 4);
  assert.equal(open.getBlock(x, open.heightAt(x, z), z), expected);
}
open.ensureChunk(0, 0);
assert.equal(open.getBlock(0, open.sites.find(s => s.type === 'origin').y + 1, 0), MC.Block.TABLET);
assert(open.lore.size >= 1);

console.log('PASS: 火把/遮光/跨区块/读档与位置恢复、配方/耐久、动物网格、粒子池与单次绘制、小地图预览、开放世界站点');

// 偏好不会污染世界存档，损坏字段与不可用存储均可降级。
const preferences = new Map([['mcweb.save.v1', 'untouched']]);
const storage = { getItem: k => preferences.get(k), setItem: (k, v) => preferences.set(k, v) };
const settings = new MC.Settings(storage);
settings.set('distance', 10);
settings.set('fov', 120);
settings.set('shadows', false);
settings.set('inputMode', 'touch');
assert.equal(new MC.Settings(storage).values.distance, 10);
assert.equal(new MC.Settings(storage).values.fov, 95);
assert.equal(new MC.Settings(storage).values.shadows, false);
assert.equal(new MC.Settings(storage).values.inputMode, 'touch');
assert.equal(preferences.get('mcweb.save.v1'), 'untouched');
assert.equal(new MC.Settings(null).values.distance, 10);
assert.equal(new MC.Settings(null).values.inputMode, 'auto');
preferences.set('mcweb.settings.v1', '{broken');
assert.equal(new MC.Settings(storage).values.fov, 65);

// 远景必须完成采样和网格后再交换；刷新时旧网格可继续绘制。
let uploads = 0, disposed = 0;
const horizon = new MC.Horizon({
  biomeField: () => ({}), heightAt: (x, z) => 50 + x * 0.01 + z * 0.01,
  biomeAt: () => 'plains'
}, {
  makeMesh(data) {
    uploads++;
    assert(data.verts.every(Number.isFinite));
    for (const index of data.idx) assert(index < data.verts.length / 10);
    return { count: data.idx.length };
  },
  disposeMesh(mesh) { if (mesh) disposed++; }
});
horizon.begin(0, 0);
for (let i = 0; i < 1000 && horizon.phase !== 'idle'; i++) horizon.update(0, 0);
assert.equal(horizon.phase, 'idle');
assert.equal(uploads, 1);
const oldMesh = horizon.mesh;
horizon.begin(-65, -65);
horizon.update(-65, -65);
assert.equal(horizon.mesh, oldMesh);
for (let i = 0; i < 1000 && horizon.phase !== 'idle'; i++) horizon.update(-65, -65);
assert.equal(uploads, 2);
assert.equal(disposed, 1);
assert.equal(horizon.originX, -864);
console.log('PASS: 画面偏好容错/持久化、远景分帧构建/缓冲范围/旧网格替换');

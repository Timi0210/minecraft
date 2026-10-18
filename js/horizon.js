/* horizon.js — 分帧生成的远景地形，只显示轮廓与群系色。 */
(function () {
  'use strict';
  const MC = window.MC;
  const STEP = 8;
  const CELLS = 128;
  const SIDE = CELLS + 1;
  const HALF = CELLS * STEP / 2;

  class Horizon {
    constructor(world, renderer) {
      this.world = world;
      this.renderer = renderer;
      this.mesh = null;
      this.originX = Infinity;
      this.originZ = Infinity;
      this.nextRow = SIDE;
      this.heights = new Float32Array(SIDE * SIDE);
      this.tiles = new Uint8Array(SIDE * SIDE);
    }

    begin(x, z) {
      this.originX = Math.round(x / 64) * 64 - HALF;
      this.originZ = Math.round(z / 64) * 64 - HALF;
      this.nextRow = 0;
    }

    update(x, z) {
      const centerX = this.originX + HALF, centerZ = this.originZ + HALF;
      if (this.nextRow === SIDE && (Math.abs(x - centerX) > 48 || Math.abs(z - centerZ) > 48))
        this.begin(x, z);
      if (this.nextRow === SIDE) return;

      // 每帧只取几行地形，移动时不会因为重建远景而停顿。
      const end = Math.min(SIDE, this.nextRow + 7);
      for (let row = this.nextRow; row < end; row++) for (let col = 0; col < SIDE; col++) {
        const wx = this.originX + col * STEP;
        const wz = this.originZ + row * STEP;
        const field = this.world.biomeField(wx, wz);
        const h = this.world.heightAt(wx, wz, field);
        const biome = this.world.biomeAt(wx, wz, h, field);
        const i = row * SIDE + col;
        this.heights[i] = Math.max(MC.WORLD.SEA + 0.1, h) - 1.4;
        this.tiles[i] = h <= MC.WORLD.SEA ? MC.Block.WATER :
          h > 88 ? (MC.Noise.hash2(col >> 2, row >> 2, this.world.seed + 6031) > 0.60 ? MC.Block.SNOW : MC.Block.STONE) :
          h > 65 ? (MC.Noise.hash2(col >> 2, row >> 2, this.world.seed + 6037) > 0.19 ? MC.Block.STONE : MC.Block.GRASS) :
          biome === 'desert' || biome === 'beach' ? MC.Block.SAND :
          biome === 'badlands' ? MC.Block.TERRACOTTA :
          biome === 'snow' ? MC.Block.SNOW : MC.Block.GRASS;
      }
      this.nextRow = end;
      if (end === SIDE) this.upload();
    }

    upload() {
      const verts = [], idx = [];
      const levels = new Float32Array(CELLS * CELLS);
      for (let row = 0; row < CELLS; row++) for (let col = 0; col < CELLS; col++) {
        const i = row * SIDE + col, h = this.heights;
        levels[row * CELLS + col] = Math.round((h[i] + h[i + 1] + h[i + SIDE] + h[i + SIDE + 1]) * 0.25);
      }
      const quad = (points, normal, tile, brightness, material) => {
        const uv = MC.Atlas.uv(tile);
        const u = (uv[0] + uv[2]) * 0.5, v = (uv[1] + uv[3]) * 0.5;
        const base = verts.length / 10;
        for (const p of points) verts.push(p[0], p[1], p[2], u, v, brightness,
          normal[0], normal[1], normal[2], material);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      // 远处仍以方块阶梯呈现；只补高低差产生的外侧墙面。
      for (let row = 0; row < CELLS; row++) for (let col = 0; col < CELLS; col++) {
        const x = this.originX + col * STEP, z = this.originZ + row * STEP;
        const y = levels[row * CELLS + col];
        const block = this.tiles[row * SIDE + col];
        const tile = MC.BLOCKS[block].tex.top;
        const material = block === MC.Block.WATER ? -1 : block === MC.Block.SAND ? -2 :
          block === MC.Block.TERRACOTTA ? -3 : 0;
        quad([[x, y, z], [x, y, z + STEP], [x + STEP, y, z + STEP], [x + STEP, y, z]],
          [0, 1, 0], tile, 0.96, material);
        const left = col ? levels[row * CELLS + col - 1] : y;
        const right = col < CELLS - 1 ? levels[row * CELLS + col + 1] : y;
        const back = row ? levels[(row - 1) * CELLS + col] : y;
        const front = row < CELLS - 1 ? levels[(row + 1) * CELLS + col] : y;
        if (left < y) quad([[x, y, z + STEP], [x, y, z], [x, left, z], [x, left, z + STEP]], [-1, 0, 0], tile, 0.79, material);
        if (right < y) quad([[x + STEP, y, z], [x + STEP, y, z + STEP], [x + STEP, right, z + STEP], [x + STEP, right, z]], [1, 0, 0], tile, 0.82, material);
        if (back < y) quad([[x, y, z], [x + STEP, y, z], [x + STEP, back, z], [x, back, z]], [0, 0, -1], tile, 0.75, material);
        if (front < y) quad([[x + STEP, y, z + STEP], [x, y, z + STEP], [x, front, z + STEP], [x + STEP, front, z + STEP]], [0, 0, 1], tile, 0.84, material);
      }
      const next = this.renderer.makeMesh({ verts: new Float32Array(verts), idx: new Uint32Array(idx) });
      this.renderer.disposeMesh(this.mesh);
      this.mesh = next;
      this.renderer.horizonMesh = next;
    }
  }

  MC.Horizon = Horizon;
})();

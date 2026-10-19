/* horizon.js — 限时采样与网格构建，远山沿真实地形轮廓连续起伏。 */
(function () {
  'use strict';
  const MC = window.MC;
  const STEP = 4, CELLS = 400, SIDE = CELLS + 1;
  const HALF = CELLS * STEP / 2;

  class Horizon {
    constructor(world, renderer) {
      this.world = world;
      this.renderer = renderer;
      this.mesh = null;
      this.originX = Infinity;
      this.originZ = Infinity;
      this.nextRow = SIDE;
      this.phase = 'idle';
      this.heights = new Float32Array(SIDE * SIDE);
      this.tiles = new Uint8Array(SIDE * SIDE);
      // 固定大小缓冲反复使用，避免一次性创建数十万个临时数组。
      this.vertices = new Float32Array(SIDE * SIDE * 10);
      this.indices = new Uint32Array(CELLS * CELLS * 6);
      let n = 0;
      for (let z = 0; z < CELLS; z++) for (let x = 0; x < CELLS; x++) {
        const i = z * SIDE + x;
        this.indices[n++] = i; this.indices[n++] = i + SIDE; this.indices[n++] = i + 1;
        this.indices[n++] = i + 1; this.indices[n++] = i + SIDE; this.indices[n++] = i + SIDE + 1;
      }
      this.tileUV = MC.BLOCKS.map(block => {
        if (!block || !block.tex) return [0, 0];
        const uv = MC.Atlas.uv(block.tex.top);
        return [(uv[0] + uv[2]) / 2, (uv[1] + uv[3]) / 2];
      });
    }

    begin(x, z) {
      this.originX = Math.round(x / 64) * 64 - HALF;
      this.originZ = Math.round(z / 64) * 64 - HALF;
      this.nextRow = 0;
      this.phase = 'sample';
    }

    update(x, z) {
      if (this.world.isNether && this.world.isNether(x, z)) return;
      if (this.phase === 'idle' &&
          (Math.abs(x - this.originX - HALF) > 48 || Math.abs(z - this.originZ - HALF) > 48))
        this.begin(x, z);
      if (this.phase === 'idle') return;
      const deadline = performance.now() + 2;
      // 整体完成后才交换 GPU 网格，生成途中继续显示上一份完整远景。
      if (this.phase === 'upload') {
        const next = this.renderer.makeMesh({ verts: this.vertices, idx: this.indices });
        this.renderer.disposeMesh(this.mesh);
        this.mesh = next;
        this.renderer.horizonMesh = next;
        this.phase = 'idle';
        return;
      }
      do {
        if (this.phase === 'sample') this.sampleRow(this.nextRow);
        else this.buildRow(this.nextRow);
        if (++this.nextRow === SIDE) {
          this.phase = this.phase === 'sample' ? 'mesh' : 'upload';
          this.nextRow = this.phase === 'mesh' ? 0 : SIDE;
          return;
        }
      } while (performance.now() < deadline);
    }

    sampleRow(row) {
      const B = MC.Block;
      for (let col = 0; col < SIDE; col++) {
        const x = this.originX + col * STEP, z = this.originZ + row * STEP;
        const field = this.world.biomeField(x, z);
        const h = this.world.heightAt(x, z, field);
        const biome = this.world.biomeAt(x, z, h, field);
        const glacier = this.world.glacierWeight ? this.world.glacierWeight(x, z) : 0;
        const i = row * SIDE + col;
        this.heights[i] = Math.max(MC.WORLD.SEA + 0.8, h + 0.8);
        this.tiles[i] = h <= MC.WORLD.SEA ? B.WATER :
          biome === 'desert' || biome === 'beach' ? B.SAND :
          biome === 'badlands' ? B.TERRACOTTA :
          biome === 'snow' || (glacier > 0.40 && h < 82) ? B.SNOW : B.GRASS;
      }
    }

    buildRow(row) {
      const h = this.heights, v = this.vertices, B = MC.Block;
      for (let col = 0; col < SIDE; col++) {
        const i = row * SIDE + col, b = this.tiles[i], uv = this.tileUV[b];
        const nx = h[row * SIDE + Math.max(0, col - 1)] - h[row * SIDE + Math.min(CELLS, col + 1)];
        const nz = h[Math.max(0, row - 1) * SIDE + col] - h[Math.min(CELLS, row + 1) * SIDE + col];
        const len = Math.hypot(nx, STEP * 2, nz);
        let n = i * 10;
        v[n++] = this.originX + col * STEP; v[n++] = h[i]; v[n++] = this.originZ + row * STEP;
        v[n++] = uv[0]; v[n++] = uv[1]; v[n++] = 0.94;
        v[n++] = nx / len; v[n++] = STEP * 2 / len; v[n++] = nz / len;
        v[n] = b === B.WATER ? -1 : b === B.SAND ? -2 : b === B.TERRACOTTA ? -3 : b === B.SNOW ? -4 : 0;
      }
    }
  }
  MC.Horizon = Horizon;
})();

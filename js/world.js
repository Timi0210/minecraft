/* world.js — 区块存储、无限地形生成、树、洞穴、水、编辑存档 */
(function () {
  'use strict';
  const MC = window.MC;
  const N = MC.Noise;
  const B = MC.Block;

  const CHUNK = 16;
  const HEIGHT = 144;
  const SEA = 32;
  const MAX_TERRAIN = 136;
  const CHUNK_VOL = CHUNK * CHUNK * HEIGHT;

  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const nz = (x, z, salt, oct) => (N.fbm2(x, z, salt, oct, 2, 0.5) - 0.5) * 3.6;
  const TREE_DENSITY = { forest: 0.032, taiga: 0.024, cherry: 0.03, plains: 0.006, snow: 0.014, mountain: 0.001, beach: 0, desert: 0, badlands: 0, ocean: 0 };
  // Every 3×3 group of regions contains every surface landscape. The low frequency
  // warp and wide blends keep the arrangement from looking like square tiles.
  const REGION_SIZE = 240;
  const REGION_BIOMES = [
    'plains', 'forest', 'desert',
    'cherry', 'mountain', 'badlands',
    'snow', 'ocean', 'taiga'
  ];
  const REGION_HEIGHT = {
    plains: 0, forest: 2, taiga: 4, desert: 0, cherry: 6,
    mountain: 19, badlands: 9, snow: 3, ocean: -19
  };
  const BIOME_NAMES = {
    ocean: '海洋', frozen_ocean: '冻洋', beach: '沙滩', desert: '沙漠', plains: '平原',
    forest: '森林', taiga: '针叶林', snow: '雪原', mountain: '山地', cherry: '樱花林', badlands: '恶地',
    lush_caves: '繁茂洞穴', dripstone_caves: '滴水石洞穴'
  };

  class Chunk {
    constructor(cx, cz) {
      this.cx = cx;
      this.cz = cz;
      this.blocks = new Uint8Array(CHUNK_VOL);
      this.light = new Uint8Array(CHUNK_VOL);
      this.generated = false;
      this.dirty = false;
      this.gpu = null;
      this.faces = 0;
    }
    idx(x, y, z) { return (y * CHUNK + z) * CHUNK + x; }
    get(x, y, z) { return this.blocks[(y * CHUNK + z) * CHUNK + x]; }
    set(x, y, z, v) { this.blocks[(y * CHUNK + z) * CHUNK + x] = v; }
  }

  class World {
    constructor(seed, savedEdits) {
      this.seed = seed | 0;
      this.chunks = new Map();
      this.lightSources = new Map(); // 已加载火把；光照不写入存档
      this.edits = new Map();       // "x,y,z" -> [x,y,z,id]
      this.editIndex = new Map();   // "cx,cz" -> Map<区块内索引, id>
      this.peaks = [
        [212 + (N.hash2(1, 0, this.seed + 19001) - 0.5) * 24,
          210 + (N.hash2(2, 0, this.seed + 19001) - 0.5) * 24, 123, 104, 55],
        [326 + (N.hash2(3, 0, this.seed + 19001) - 0.5) * 24,
          318 + (N.hash2(4, 0, this.seed + 19001) - 0.5) * 24, 112, 98, 52]
      ];
      this.valley = {
        x: Math.round(this.peaks[0][0] - 63), z: Math.round(this.peaks[0][1] - 56),
        rx: 68, rz: 52
      };
      const v = this.valley;
      this.camp = { x: v.x - 67, z: v.z - 19, y: 0 };
      let campY = 0;
      for (let dz = -6; dz <= 6; dz += 3) for (let dx = -7; dx <= 7; dx += 3)
        campY = Math.max(campY, this.heightAt(this.camp.x + dx, this.camp.z + dz));
      this.camp.y = Math.max(SEA + 3, campY + 1);
      this.trails = this.peaks.map((peak, index) => this.makePeakTrail(peak, index));
      this.trailIndex = new Map();
      for (const trail of this.trails) {
        for (const point of trail) {
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const x = point.x + dx, z = point.z + dz;
            const key = (x >> 4) + ',' + (z >> 4);
            let cells = this.trailIndex.get(key);
            if (!cells) { cells = new Map(); this.trailIndex.set(key, cells); }
            const cellKey = x + ',' + z;
            const old = cells.get(cellKey);
            const priority = dx === 0 && dz === 0 ? 2 : 1;
            if (!old || priority > old.priority || (priority === old.priority && point.y > old.y))
              cells.set(cellKey, { x, y: point.y, z, priority });
          }
        }
      }
      // 前哨站位于两座雪山之间的山肩，屋顶高度按当地地势确定。
      const outpostX = Math.round(this.peaks[0][0] + 105);
      const outpostZ = Math.round(this.peaks[0][1] - 8);
      let outpostY = 0;
      for (let dz = -20; dz <= 22; dz += 4) for (let dx = -31; dx <= 29; dx += 4)
        outpostY = Math.max(outpostY, this.heightAt(outpostX + dx, outpostZ + dz));
      this.outpost = { x: outpostX, z: outpostZ, y: Math.min(116, outpostY + 1) };
      this.arch = { x: v.x + 78, z: v.z - 12 };
      this.arch.y = this.heightAt(this.arch.x, this.arch.z) + 1;
      this.landmarks = [
        { id: 'camp', name: '湖畔营地', x: this.camp.x, y: this.camp.y, z: this.camp.z, icon: '⌂', note: '从篝火出发，沿木栈道走向湖面。' },
        { id: 'arch', name: '回声石门', x: this.arch.x, y: this.arch.y, z: this.arch.z, icon: '◇', note: '湖对岸的石门，留着旧世界的痕迹。' },
        { id: 'outpost', name: '霜线前哨', x: this.outpost.x, y: this.outpost.y, z: this.outpost.z, icon: '▣', note: '山肩上的旧堡垒与登山步道相邻。' },
        ...this.peaks.map((p, i) => ({ id: 'peak' + i, name: i ? '北境之巅' : '云上之巅',
          x: Math.round(p[0]), y: this.heightAt(Math.round(p[0]), Math.round(p[1])), z: Math.round(p[1]),
          icon: '△', note: '沿金色步道登顶，寻找山顶的奖励。' }))
      ];
      this.beaconLights = [
        [this.camp.x - 3, this.camp.y + 1, this.camp.z - 3],
        [this.camp.x + 3, this.camp.y + 1, this.camp.z + 3],
        [this.arch.x - 4, this.arch.y + 1, this.arch.z],
        [this.arch.x + 4, this.arch.y + 1, this.arch.z]
      ];
      if (savedEdits && savedEdits.length) {
        for (let i = 0; i < savedEdits.length; i++) {
          const e = savedEdits[i];
          if (e && e.length === 4) this.recordEdit(e[0], e[1], e[2], e[3]);
        }
      }
      this.spawn = this.findSpawn();
    }

    chunkKey(cx, cz) { return cx + ',' + cz; }

    getChunk(cx, cz) {
      return this.chunks.get(cx + ',' + cz) || null;
    }

    ensureChunk(cx, cz) {
      const key = cx + ',' + cz;
      let c = this.chunks.get(key);
      if (!c) {
        c = new Chunk(cx, cz);
        this.chunks.set(key, c);
        this.generate(c);
        c.generated = true;
        c.dirty = true;
        // 旧档的火把由 edits 写入方块，生成后在这里恢复光照。
        const edits = this.editIndex.get(key);
        if (edits) for (const [index, id] of edits) {
          if (id !== B.TORCH || c.blocks[index] !== B.TORCH) continue;
          const y = Math.floor(index / 256), z = (index >> 4) & 15, x = index & 15;
          this.lightSources.set((cx * 16 + x) + ',' + y + ',' + (cz * 16 + z),
            [cx * 16 + x, y, cz * 16 + z]);
        }
        for (const source of this.beaconLights) {
          if ((source[0] >> 4) !== cx || (source[2] >> 4) !== cz) continue;
          if (c.get(source[0] & 15, source[1], source[2] & 15) === B.TORCH)
            this.lightSources.set(source.join(','), source);
        }
        for (const source of this.lightSources.values()) {
          if (source[0] >= cx * 16 - 14 && source[0] < cx * 16 + 30 &&
              source[2] >= cz * 16 - 14 && source[2] < cz * 16 + 30)
            this.spreadLight(source[0], source[1], source[2], 14, true);
        }
        // 新邻居的接缝面需要重建
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nb = this.chunks.get((cx + dx) + ',' + (cz + dz));
          if (nb && nb.generated) nb.dirty = true;
        }
      }
      return c;
    }

    /* 区块的 4 个邻居是否就绪（决定边界接缝是否可算） */
    neighborsReady(cx, cz) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = this.chunks.get((cx + dx) + ',' + (cz + dz));
        if (!c || !c.generated) return false;
      }
      return true;
    }

    getBlock(x, y, z) {
      if (y < 0 || y >= HEIGHT) return 0;
      const c = this.chunks.get((x >> 4) + ',' + (z >> 4));
      if (!c || !c.generated) return 0;
      return c.blocks[(y * CHUNK + (z & 15)) * CHUNK + (x & 15)];
    }

    getLight(x, y, z) {
      if (y < 0 || y >= HEIGHT) return 0;
      const c = this.chunks.get((x >> 4) + ',' + (z >> 4));
      return c && c.generated ? c.light[(y * CHUNK + (z & 15)) * CHUNK + (x & 15)] : 0;
    }

    lightCell(x, y, z) {
      if (y < 0 || y >= HEIGHT) return null;
      const c = this.chunks.get((x >> 4) + ',' + (z >> 4));
      if (!c || !c.generated) return null;
      return { c, index: (y * CHUNK + (z & 15)) * CHUNK + (x & 15) };
    }

    setLight(x, y, z, value) {
      const cell = this.lightCell(x, y, z);
      if (!cell || cell.c.light[cell.index] === value) return false;
      cell.c.light[cell.index] = value;
      cell.c.dirty = true;
      return true;
    }

    spreadLight(x, y, z, level, traverseExisting) {
      // 只在方块变化或新区块生成时运行，BFS 不会进入尚未生成的区块。
      if (!this.lightCell(x, y, z)) return;
      if (level > this.getLight(x, y, z)) this.setLight(x, y, z, level);
      const q = [[x, y, z, this.getLight(x, y, z)]];
      const visited = traverseExisting ? new Set([x + ',' + y + ',' + z]) : null;
      for (let head = 0; head < q.length; head++) {
        const [px, py, pz, l] = q[head];
        if (l <= 1) continue;
        for (const [dx, dy, dz] of World.DIRS) {
          const nx = px + dx, ny = py + dy, nz = pz + dz;
          const cell = this.lightCell(nx, ny, nz);
          if (!cell || MC.BLOCKS[cell.c.blocks[cell.index]].opaque) continue;
          const next = Math.max(l - 1, MC.BLOCKS[cell.c.blocks[cell.index]].light);
          if (next < cell.c.light[cell.index] || (!visited && next === cell.c.light[cell.index])) continue;
          if (visited) {
            const key = nx + ',' + ny + ',' + nz;
            if (visited.has(key)) continue;
            visited.add(key);
          }
          if (next > cell.c.light[cell.index]) this.setLight(nx, ny, nz, next);
          q.push([nx, ny, nz, next]);
        }
      }
    }

    removeLight(x, y, z, oldLevel) {
      if (!oldLevel) return;
      this.setLight(x, y, z, 0);
      const dark = [[x, y, z, oldLevel]], relight = new Map();
      for (let head = 0; head < dark.length; head++) {
        const [px, py, pz, l] = dark[head];
        for (const [dx, dy, dz] of World.DIRS) {
          const nx = px + dx, ny = py + dy, nz = pz + dz;
          const nl = this.getLight(nx, ny, nz);
          if (!nl) continue;
          const id = this.getBlock(nx, ny, nz);
          if (!MC.BLOCKS[id].light && nl < l) {
            this.setLight(nx, ny, nz, 0);
            dark.push([nx, ny, nz, nl]);
          } else relight.set(nx + ',' + ny + ',' + nz, [nx, ny, nz, nl]);
        }
      }
      for (const [rx, ry, rz, l] of relight.values()) this.spreadLight(rx, ry, rz, l);
    }

    unloadChunk(c) {
      const removed = [];
      for (const [key, source] of this.lightSources) {
        if ((source[0] >> 4) === c.cx && (source[2] >> 4) === c.cz) {
          this.lightSources.delete(key);
          removed.push(source);
        }
      }
      this.chunks.delete(this.chunkKey(c.cx, c.cz));
      for (const source of removed) this.removeLight(source[0], source[1], source[2], 14);
    }

    setBlock(x, y, z, id, record) {
      if (y < 0 || y >= HEIGHT) return false;
      const cx = x >> 4, cz = z >> 4;
      const c = this.chunks.get(cx + ',' + cz);
      if (!c || !c.generated) return false;
      const lx = x & 15, lz = z & 15;
      const old = c.get(lx, y, lz);
      if (old === id) return false;
      const oldLight = this.getLight(x, y, z);
      c.blocks[(y * CHUNK + lz) * CHUNK + lx] = id;
      if (old === B.TORCH) this.lightSources.delete(x + ',' + y + ',' + z);
      if (id === B.TORCH) this.lightSources.set(x + ',' + y + ',' + z, [x, y, z]);
      if (MC.BLOCKS[old].light || (!MC.BLOCKS[old].opaque && MC.BLOCKS[id].opaque))
        this.removeLight(x, y, z, oldLight);
      if (MC.BLOCKS[id].light) this.spreadLight(x, y, z, MC.BLOCKS[id].light);
      else if (MC.BLOCKS[old].opaque && !MC.BLOCKS[id].opaque) {
        for (const [dx, dy, dz] of World.DIRS) {
          const l = this.getLight(x + dx, y + dy, z + dz);
          if (l > 1) this.spreadLight(x + dx, y + dy, z + dz, l);
        }
      }
      c.dirty = true;
      if (lx === 0) this.markDirty(cx - 1, cz);
      if (lx === 15) this.markDirty(cx + 1, cz);
      if (lz === 0) this.markDirty(cx, cz - 1);
      if (lz === 15) this.markDirty(cx, cz + 1);
      if (record !== false) this.recordEdit(x, y, z, id);
      return true;
    }

    markDirty(cx, cz) {
      const c = this.chunks.get(cx + ',' + cz);
      if (c) c.dirty = true;
    }

    recordEdit(x, y, z, id) {
      this.edits.set(x + ',' + y + ',' + z, [x, y, z, id]);
      const key = (x >> 4) + ',' + (z >> 4);
      let chunkEdits = this.editIndex.get(key);
      if (!chunkEdits) { chunkEdits = new Map(); this.editIndex.set(key, chunkEdits); }
      const index = (y * CHUNK + (z & 15)) * CHUNK + (x & 15);
      chunkEdits.set(index, id);
    }

    saveData() {
      const list = new Array(this.edits.size);
      let i = 0;
      for (const v of this.edits.values()) list[i++] = v;
      return { seed: this.seed, edits: list };
    }

    /* ---------------- 地形 ---------------- */

    regionBiome(ix, iz) {
      return REGION_BIOMES[(((iz % 3) + 3) % 3) * 3 + (((ix % 3) + 3) % 3)];
    }

    biomeField(x, z) {
      const s = this.seed;
      const wx = x + nz(x * 0.004, z * 0.004, s + 3301, 2) * 68;
      const wz = z + nz(x * 0.004, z * 0.004, s + 5501, 2) * 68;
      const gx = wx / REGION_SIZE, gz = wz / REGION_SIZE;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      const fx = smoothstep(0.18, 0.82, gx - ix);
      const fz = smoothstep(0.18, 0.82, gz - iz);
      const names = [this.regionBiome(ix, iz), this.regionBiome(ix + 1, iz),
        this.regionBiome(ix, iz + 1), this.regionBiome(ix + 1, iz + 1)];
      const weights = [(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz];
      let height = 0, mountain = 0, badlands = 0, dry = 0, snow = 0;
      for (let i = 0; i < 4; i++) {
        const w = weights[i], name = names[i];
        height += REGION_HEIGHT[name] * w;
        if (name === 'mountain') mountain += w;
        if (name === 'badlands') badlands += w;
        if (name === 'badlands' || name === 'desert') dry += w;
        if (name === 'snow') snow += w;
      }
      // Small scallops along the material boundary; elevation keeps its smooth blend.
      const edgeX = (N.noise2(x * 0.034, z * 0.034, s + 6503) - 0.5) * 0.24;
      const edgeZ = (N.noise2(x * 0.034, z * 0.034, s + 7703) - 0.5) * 0.24;
      let biome = this.regionBiome(ix + (gx - ix > 0.5 + edgeX ? 1 : 0),
        iz + (gz - iz > 0.5 + edgeZ ? 1 : 0));
      if (this.valley) {
        const v = this.valley;
        const radius = Math.hypot((x - v.x) / (v.rx * 1.7), (z - v.z) / (v.rz * 1.7));
        if (radius < 1) {
          const blend = 1 - smoothstep(0.65, 1, radius);
          height = height * (1 - blend) + 2 * blend;
          badlands *= 1 - blend; dry *= 1 - blend; snow *= 1 - blend;
          mountain *= 1 - blend;
          if (radius < 0.82) biome = 'plains';
        }
      }
      return { biome, height, mountain, badlands, dry, snow };
    }

    peakRise(x, z) {
      // Two fixed, seed-shifted summits in the first mountain region. Each bump
      // reaches zero with a flat derivative, so it joins the surrounding hills.
      let rise = 0;
      for (let i = 0; i < this.peaks.length; i++) {
        const p = this.peaks[i], dx = (x - p[0]) / p[2], dz = (z - p[1]) / p[3];
        const q = dx * dx + dz * dz;
        if (q < 1) {
          const radius = Math.sqrt(q);
          const taper = 1 - radius;
          const spine = Math.max(0, Math.cos(Math.atan2(dz, dx) * 7 + i * 1.4));
          rise += p[4] * Math.pow(taper, 1.24) +
            12 * spine * spine * spine * radius * taper;
        }
      }
      return rise;
    }

    makePeakTrail(peak, index) {
      const cx = Math.round(peak[0]), cz = Math.round(peak[1]);
      const other = this.peaks[1 - index];
      const radius = Math.min(108, Math.floor(Math.hypot(cx - other[0], cz - other[1]) / 2) - 5);
      const outerRadius = radius + 38;
      const toOther = Math.atan2(other[1] - cz, other[0] - cx);
      let startAngle = 0, startHeight = Infinity;
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16;
        if (Math.cos(angle - toOther) > -0.25) continue;
        const x = Math.round(cx + Math.cos(angle) * outerRadius);
        const z = Math.round(cz + Math.sin(angle) * outerRadius);
        const h = this.heightAt(x, z);
        if (h > SEA + 3 && h < startHeight) { startHeight = h; startAngle = angle; }
      }
      if (!Number.isFinite(startHeight)) {
        startAngle = toOther + Math.PI;
        startHeight = this.heightAt(Math.round(cx + Math.cos(startAngle) * outerRadius),
          Math.round(cz + Math.sin(startAngle) * outerRadius));
      }
      const top = this.heightAt(cx, cz);
      const points = [];
      for (let r = outerRadius; r > radius; r--) {
        const x = Math.round(cx + Math.cos(startAngle) * r);
        const z = Math.round(cz + Math.sin(startAngle) * r);
        if (points.length && points[points.length - 1].x === x && points[points.length - 1].z === z) continue;
        points.push({ x, z, y: this.heightAt(x, z) });
      }
      const steps = 2400;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const r = radius - t * (radius - 7);
        const angle = startAngle + (index ? -1 : 1) * t * Math.PI * 4.5;
        const x = Math.round(cx + Math.cos(angle) * r);
        const z = Math.round(cz + Math.sin(angle) * r);
        if (points.length && points[points.length - 1].x === x && points[points.length - 1].z === z) continue;
        const ground = this.heightAt(x, z);
        points.push({ x, z, y: Math.max(ground, Math.round(startHeight + (top - startHeight) * t)) });
      }
      const lastAngle = startAngle + (index ? -1 : 1) * Math.PI * 4.5;
      for (let r = 6; r >= 0; r--) {
        const x = Math.round(cx + Math.cos(lastAngle) * r), z = Math.round(cz + Math.sin(lastAngle) * r);
        if (points.length && points[points.length - 1].x === x && points[points.length - 1].z === z) continue;
        points.push({ x, z, y: Math.max(this.heightAt(x, z), top - r) });
      }
      // The upper envelope makes every adjacent step climbable, even where the
      // generated ridge cuts abruptly across the planned spiral.
      for (let i = 1; i < points.length; i++) points[i].y = Math.max(points[i].y, points[i - 1].y - 1);
      for (let i = points.length - 2; i >= 0; i--) points[i].y = Math.max(points[i].y, points[i + 1].y - 1);
      return points;
    }

    heightAt(x, z, field) {
      const s = this.seed;
      field = field || this.biomeField(x, z);
      let h = 39 + field.height;
      h += nz(x * 0.0027, z * 0.0027, s + 101, 3) * 5;
      h += nz(x * 0.012, z * 0.012, s + 211, 3) * (3.5 + field.mountain * 6);
      h += nz(x * 0.045, z * 0.045, s + 503, 2) * 1.4;
      // Jagged highlands, layered mesas, and winding water-level rivers.
      const ridge = Math.abs(nz(x * 0.006, z * 0.006, s + 337, 3));
      h += field.mountain * (9 + ridge * 11);
      const summit = this.peakRise(x, z);
      h += summit;
      // Keep both summits prominent even if their seed lands on a low ridge.
      if (summit > 18) {
        const target = 78 + summit * 0.65;
        h += smoothstep(18, 45, summit) * Math.max(0, target - h);
      }
      h += field.badlands * Math.floor(N.noise2(x * 0.009, z * 0.009, s + 404) * 4) * 2;
      const river = Math.abs(nz(x * 0.0028, z * 0.0028, s + 1511, 3));
      const cut = smoothstep(0.13, 0.025, river) * (1 - field.mountain * 0.7) *
        (1 - smoothstep(3, 24, summit));
      h -= cut * Math.max(0, h - SEA + 1);
      if (this.valley) {
        const v = this.valley;
        const radius = Math.hypot((x - v.x) / v.rx, (z - v.z) / v.rz) +
          (N.noise2(x * 0.042, z * 0.042, s + 5221) - 0.5) * 0.07;
        if (radius < 1.8) {
          const basin = 25 + 20 * smoothstep(0.28, 1.55, radius) +
            (N.noise2(x * 0.075, z * 0.075, s + 5213) - 0.5) * 2.5;
          const blend = 1 - smoothstep(1.15, 1.8, radius);
          h = h * (1 - blend) + basin * blend;
        }
      }
      return Math.max(5, Math.min(MAX_TERRAIN, Math.round(h)));
    }

    biomeAt(x, z, h, field) {
      field = field || this.biomeField(x, z);
      if (h === undefined) h = this.heightAt(x, z, field);
      if (h <= SEA) return field.biome === 'snow' ? 'frozen_ocean' : 'ocean';
      if (h <= SEA + 2) return 'beach';
      if (h > 64) return 'mountain';
      return field.biome;
    }

    caveBiomeAt(x, z) {
      const n = N.noise2(x * 0.004, z * 0.004, this.seed + 12021);
      return n > 0.62 ? 'lush_caves' : n < 0.36 ? 'dripstone_caves' : null;
    }

    biomeAtPlayer(x, y, z) {
      const h = this.heightAt(x, z);
      return y < h - 4 ? (this.caveBiomeAt(x, z) || this.biomeAt(x, z, h)) : this.biomeAt(x, z, h);
    }

    badlandsLayer(y) {
      const bands = [B.TERRACOTTA, B.ORANGE_TERRACOTTA, B.TERRACOTTA,
        B.YELLOW_TERRACOTTA, B.WHITE_TERRACOTTA, B.ORANGE_TERRACOTTA];
      return bands[((Math.floor(y / 3) % bands.length) + bands.length) % bands.length];
    }

    isCave(x, y, z) {
      // 一层「溶洞」+ 一层等值面隧道壳
      const n = N.noise3(x * 0.045, y * 0.075, z * 0.045, this.seed + 307);
      return n > 0.835 || Math.abs(n - 0.5) < 0.005;
    }

    generate(chunk) {
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
      const blocks = chunk.blocks;
      const SEA_ = SEA;

      // 先算 (CHUNK+2)^2 的高度图，用于坡度/悬崖上的岩层判断
      const HS = CHUNK + 2;
      const hmap = new Int16Array(HS * HS);
      const fields = new Array(CHUNK * CHUNK);
      for (let z = -1; z <= CHUNK; z++) {
        for (let x = -1; x <= CHUNK; x++) {
          const field = this.biomeField(bx + x, bz + z);
          hmap[(z + 1) * HS + (x + 1)] = this.heightAt(bx + x, bz + z, field);
          if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK) fields[z * CHUNK + x] = field;
        }
      }

      for (let z = 0; z < CHUNK; z++) {
        for (let x = 0; x < CHUNK; x++) {
          const wx = bx + x, wz = bz + z;
          const hi = (z + 1) * HS + (x + 1);
          const h = hmap[hi];
          const slope = Math.max(
            Math.abs(h - hmap[hi + 1]), Math.abs(h - hmap[hi - 1]),
            Math.abs(h - hmap[hi + HS]), Math.abs(h - hmap[hi - HS])
          );
          const top = h > SEA_ ? h : SEA_;
          const beach = h <= SEA_ + 2;
          const field = fields[z * CHUNK + x];
          const biome = h <= SEA_ ? (field.biome === 'snow' ? 'frozen_ocean' : 'ocean') :
            h <= SEA_ + 2 ? 'beach' : h > 64 ? 'mountain' : field.biome;
          const cherry = biome === 'cherry';
          const cold = field.biome === 'snow';
          const snowline = 79 + (N.noise2(wx * 0.038, wz * 0.038, this.seed + 3503) - 0.5) * 10;
          const redlands = field.badlands > 0.40 + N.noise2(wx * 0.052, wz * 0.052, this.seed + 3703) * 0.30;
          const sandy = field.dry > 0.25 + N.noise2(wx * 0.052, wz * 0.052, this.seed + 3903) * 0.50;
          const snowy = h >= snowline || (!redlands && field.snow >
            0.28 + N.noise2(wx * 0.052, wz * 0.052, this.seed + 4103) * 0.45);
          const rocky = slope >= 4 || h >= 64;
          const peakStrength = this.peakRise(wx, wz);
          const alpine = h > 74 && (field.mountain > 0.42 || peakStrength > 6);
          let rockRib = false, icefall = false;
          if (peakStrength > 10 && h > 78) {
            const p0 = this.peaks[0], p1 = this.peaks[1];
            const d0 = (wx - p0[0]) ** 2 + (wz - p0[1]) ** 2;
            const d1 = (wx - p1[0]) ** 2 + (wz - p1[1]) ** 2;
            const peak = d0 < d1 ? p0 : p1;
            const angle = Math.atan2(wz - peak[1], wx - peak[0]);
            const warp = (N.noise2(wx * 0.025, wz * 0.025, this.seed + 28111) - 0.5) * 1.3;
            rockRib = slope >= 1 && Math.sin(angle * 7 + warp) > 0.78;
            icefall = h > 89 && peakStrength > 22 &&
              Math.sin(angle * 4 + warp * 0.45 + 1.7) > 0.965;
          }
          const rockPatch = alpine && snowy && slope >= 1 &&
            N.noise2(wx * 0.021, wz * 0.021, this.seed + 28013) +
            N.noise2(wx * 0.092, wz * 0.092, this.seed + 28031) * 0.24 >
            (peakStrength > 10 ? 0.72 : 0.95) || rockRib;
          const icePatch = icefall || (rockPatch &&
            N.hash2(Math.floor(wx / 7), Math.floor(wz / 7), this.seed + 28049) > 0.9);
          const mossy = (biome === 'forest' || biome === 'taiga') &&
            N.noise2(wx * 0.042, wz * 0.042, this.seed + 2277) > 0.66;
          const surface = snowy ? (icePatch ? B.ICE : rockPatch ? B.STONE : B.SNOW) :
            (redlands ? B.RED_SAND : (beach || sandy ? B.SAND : ((rocky && !cherry) ? B.STONE : (mossy ? B.MOSS : B.GRASS))));
          const under = redlands ? B.TERRACOTTA : (beach || sandy ? B.SAND : (rocky ? B.STONE : B.DIRT));
          const caveCeiling = Math.min(h - 2, 72);
          for (let y = 0; y <= top; y++) {
            let id = 0;
            if (y === 0) {
              id = B.BEDROCK;
            } else if (y <= h) {
              if (y === h) id = surface;
              else if (icePatch && y >= h - 2) id = B.ICE;
              else if (snowy && !rockPatch && y >= h - 2) id = B.SNOW;
              else if (redlands && y > h - 18) id = this.badlandsLayer(y);
              else if (y > h - 4) id = under;
              else id = B.STONE;
            } else {
              id = (cold && y === SEA_) ? B.ICE : B.WATER;
            }
            if (id !== B.BEDROCK && id !== B.WATER && y > 2 && y < caveCeiling && this.isCave(wx, y, wz)) {
              id = 0;
            }
            blocks[(y * CHUNK + z) * CHUNK + x] = id;
          }
        }
      }

      this.addOres(chunk);
      this.decorateCaves(chunk);
      this.placeTrees(chunk);
      this.placeBoulders(chunk);
      this.placeAlpineDetails(chunk);
      this.placePetals(chunk);
      this.placeAlpineOutpost(chunk);
      this.placeFrontierLandmarks(chunk);
      this.placePeakTrail(chunk);
      this.placeSummitShrines(chunk);
      this.applyEdits(chunk);
      chunk.generated = true;
    }

    addOres(chunk) {
      const rng = N.mulberry32(Math.floor(N.hash2(chunk.cx, chunk.cz, this.seed + 8123) * 4294967296) | 0);
      const veins = [
        { id: 14, count: 16, minY: 6, maxY: 58, size: 7 },   // 煤
        { id: 15, count: 11, minY: 5, maxY: 44, size: 5 },   // 铁
        { id: 16, count: 4, minY: 4, maxY: 26, size: 4 },    // 金
        { id: 17, count: 2, minY: 4, maxY: 18, size: 3 },    // 钻石
        { id: 18, count: 4, minY: 4, maxY: 22, size: 4 }     // 红石
      ];
      const blocks = chunk.blocks;
      for (const v of veins) {
        for (let i = 0; i < v.count; i++) {
          let x = (rng() * CHUNK) | 0;
          let z = (rng() * CHUNK) | 0;
          let y = v.minY + ((rng() * (v.maxY - v.minY)) | 0);
          for (let k = 0; k < v.size; k++) {
            if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y > 1 && y < HEIGHT) {
              const idx = (y * CHUNK + z) * CHUNK + x;
              if (blocks[idx] === B.STONE) blocks[idx] = v.id;
            }
            x += ((rng() * 3) | 0) - 1;
            y += ((rng() * 3) | 0) - 1;
            z += ((rng() * 3) | 0) - 1;
          }
        }
      }
    }

    put(chunk, wx, y, wz, id, onlyAir) {
      const lx = wx - chunk.cx * CHUNK, lz = wz - chunk.cz * CHUNK;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
      const i = (y * CHUNK + lz) * CHUNK + lx;
      if (onlyAir && chunk.blocks[i] !== 0) return;
      chunk.blocks[i] = id;
    }

    placePeakTrail(chunk) {
      const cells = this.trailIndex.get(this.chunkKey(chunk.cx, chunk.cz));
      if (!cells) return;
      // Clear the whole corridor first, then put every tread back. This keeps
      // uphill steps from erasing a lower tread in the same three-wide path.
      for (const { x, y, z } of cells.values()) {
        for (let dy = 1; dy <= 3; dy++) this.put(chunk, x, y + dy, z, B.AIR);
      }
      for (const { x, y, z } of cells.values()) {
        const ground = this.heightAt(x, z);
        if (ground < y - 1) {
          for (let sy = ground + 1; sy < y; sy++) this.put(chunk, x, sy, z, B.COBBLE);
        }
        this.put(chunk, x, y, z, y >= 80 ? B.SNOW : B.COBBLE);
      }
    }

    placeAlpineOutpost(chunk) {
      const site = this.outpost;
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
      if (bx > site.x + 30 || bx + CHUNK - 1 < site.x - 31 ||
          bz > site.z + 27 || bz + CHUNK - 1 < site.z - 20) return;
      const x0 = site.x, z0 = site.z, base = site.y;
      const build = (left, top, right, bottom, floor, wallHeight, doorSide) => {
        const x1 = Math.max(bx, x0 + left), x2 = Math.min(bx + 15, x0 + right);
        const z1 = Math.max(bz, z0 + top), z2 = Math.min(bz + 15, z0 + bottom);
        for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
          const rx = x - x0, rz = z - z0;
          const edgeX = rx === left || rx === right, edgeZ = rz === top || rz === bottom;
          const wall = edgeX || edgeZ;
          const door = doorSide === 'south' && rz === bottom && Math.abs(rx - (left + right) / 2) <= 1;
          const h = this.heightAt(x, z);
          for (let y = h + 1; y <= floor; y++) this.put(chunk, x, y, z, B.STONE);
          this.put(chunk, x, floor, z, B.STONE);
          for (let dy = 1; dy < wallHeight; dy++) {
            let block = B.AIR;
            if (wall && !(door && dy <= 3)) {
              const pillar = (edgeX && rz % 5 === 0) || (edgeZ && rx % 5 === 0) || (edgeX && edgeZ);
              const window = dy >= 4 && dy <= 5 && !pillar &&
                ((edgeZ && Math.abs(rx) % 5 === 2) || (edgeX && Math.abs(rz) % 5 === 2));
              block = pillar ? B.COBBLE : window ? B.GLASS :
                (dy === 2 || dy === wallHeight - 2) ? B.WHITE_TERRACOTTA : B.STONE;
            }
            this.put(chunk, x, floor + dy, z, block);
          }
          this.put(chunk, x, floor + wallHeight, z, B.WHITE_TERRACOTTA);
          this.put(chunk, x, floor + wallHeight + 1, z,
            (edgeX || edgeZ || N.hash2(x, z, this.seed + 28191) > 0.23) ? B.SNOW : B.AIR);
        }
      };
      // 三栋相接的石砌建筑、错落的雪顶与中央塔楼。
      build(-30, -13, -3, 8, base, 10, 'south');
      build(2, -9, 27, 10, base + 2, 7, 'south');
      build(-11, 12, 5, 21, base - 2, 6, 'south');
      build(-3, -18, 7, -8, base + 2, 13, 'south');
      // 暴露的外墙扶壁和屋顶通风柱，远处也能辨认出建筑轮廓。
      for (let x = x0 - 29; x <= x0 + 27; x += 6) {
        for (let dy = 1; dy <= 3; dy++) {
          this.put(chunk, x, base + 10 + dy, z0 - 13, B.COBBLE);
          this.put(chunk, x, base + 9 + dy, z0 + 10, B.COBBLE);
        }
      }
      for (const [dx, dz, roof] of [[-24, -7, 10], [-17, 3, 10], [10, -3, 9], [20, 4, 9]]) {
        this.put(chunk, x0 + dx, base + roof + 2, z0 + dz, B.COBBLE);
        this.put(chunk, x0 + dx, base + roof + 3, z0 + dz, B.COBBLE);
      }
      for (const dx of [-24, -8]) for (let dy = 4; dy <= 6; dy++)
        this.put(chunk, x0 + dx, base + dy, z0 + 8, B.BRICK);
      for (const dx of [10, 22]) for (let dy = 4; dy <= 5; dy++)
        this.put(chunk, x0 + dx, base + 2 + dy, z0 + 10, B.BRICK);
      for (let dy = 1; dy <= 5; dy++) this.put(chunk, x0 + 2, base + 15 + dy, z0 - 13, B.COBBLE);
      this.put(chunk, x0 + 2, base + 21, z0 - 13, B.GLASS);
      // 主入口沿山坡下降，步行也能抵达，不必依赖飞行。
      for (let dz = 9; dz <= 27; dz++) for (let dx = -18; dx <= -16; dx++) {
        const x = x0 + dx, z = z0 + dz;
        const ground = this.heightAt(x, z);
        const stepY = Math.max(ground + 1, base - (dz - 8));
        for (let y = ground + 1; y <= stepY; y++) this.put(chunk, x, y, z, B.COBBLE);
        for (let dy = 1; dy <= 3; dy++) this.put(chunk, x, stepY + dy, z, B.AIR);
      }
    }

    placeFrontierLandmarks(chunk) {
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
      const c = this.camp;
      if (bx <= c.x + 36 && bx + 15 >= c.x - 8 &&
          bz <= c.z + 8 && bz + 15 >= c.z - 8) {
        for (let z = Math.max(bz, c.z - 6); z <= Math.min(bz + 15, c.z + 6); z++)
          for (let x = Math.max(bx, c.x - 7); x <= Math.min(bx + 15, c.x + 7); x++) {
            const dx = x - c.x, dz = z - c.z;
            const inside = Math.abs(dx) <= 5 && Math.abs(dz) <= 4;
            if (inside) {
              const ground = this.heightAt(x, z);
              for (let y = ground + 1; y <= c.y; y++) this.put(chunk, x, y, z, B.COBBLE);
              this.put(chunk, x, c.y, z, B.PLANKS);
              for (let dy = 1; dy <= 5; dy++) this.put(chunk, x, c.y + dy, z, B.AIR);
              if (Math.abs(dx) === 5 && Math.abs(dz) === 4)
                for (let dy = 1; dy <= 4; dy++) this.put(chunk, x, c.y + dy, z, B.SPRUCE_LOG);
              if (Math.abs(dx) <= 5 && Math.abs(dz) <= 4)
                this.put(chunk, x, c.y + 5 + (Math.abs(dz) < 3 ? 1 : 0), z, B.SPRUCE_LEAVES);
            }
            if (Math.abs(dx) === 7 && Math.abs(dz) <= 5)
              this.put(chunk, x, this.heightAt(x, z) + 1, z, B.COBBLE);
          }
        // 从营地向湖面伸出的木栈道。
        for (let x = Math.max(bx, c.x + 6); x <= Math.min(bx + 15, c.x + 36); x++)
          for (let z = Math.max(bz, c.z - 1); z <= Math.min(bz + 15, c.z + 1); z++) {
            const ground = this.heightAt(x, z);
            const floor = Math.max(SEA + 2, c.y - Math.floor((x - c.x) / 13));
            if ((x - c.x) % 8 === 0)
              for (let y = ground + 1; y < floor; y++) this.put(chunk, x, y, z, B.SPRUCE_LOG);
            this.put(chunk, x, floor, z, B.PLANKS);
            for (let dy = 1; dy <= 3; dy++) this.put(chunk, x, floor + dy, z, B.AIR);
          }
        this.put(chunk, c.x - 2, c.y + 1, c.z, B.TABLE);
        this.put(chunk, c.x + 3, c.y + 1, c.z - 2, B.COBBLE);
        this.put(chunk, c.x - 3, c.y + 1, c.z - 3, B.TORCH);
        this.put(chunk, c.x + 3, c.y + 1, c.z + 3, B.TORCH);
      }
      const a = this.arch;
      if (bx <= a.x + 5 && bx + 15 >= a.x - 5 &&
          bz <= a.z + 3 && bz + 15 >= a.z - 3) {
        for (let dx = -4; dx <= 4; dx++) for (let dz = -2; dz <= 2; dz++) {
          const x = a.x + dx, z = a.z + dz;
          this.put(chunk, x, a.y - 1, z, B.COBBLE);
          for (let dy = 0; dy <= 7; dy++) {
            const column = Math.abs(dx) >= 3 && Math.abs(dz) >= 1;
            const lintel = dy >= 6 && Math.abs(dz) >= 1;
            if (column || lintel) this.put(chunk, x, a.y + dy, z,
              dy === 7 ? B.SNOW : (dy % 3 === 0 ? B.STONE : B.COBBLE));
            else if (dy <= 5) this.put(chunk, x, a.y + dy, z, B.AIR);
          }
        }
        for (const dx of [-4, 4]) {
          this.put(chunk, a.x + dx, a.y, a.z, B.COBBLE);
          this.put(chunk, a.x + dx, a.y + 1, a.z, B.TORCH);
        }
      }
    }

    placeSummitShrines(chunk) {
      for (const peak of this.peaks) {
        const cx = Math.round(peak[0]), cz = Math.round(peak[1]);
        const y = this.heightAt(cx, cz);
        const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
        if (cx + 4 < bx || cx - 4 >= bx + CHUNK || cz + 4 < bz || cz - 4 >= bz + CHUNK) continue;
        for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
          if (dx * dx + dz * dz > 17) continue;
          const x = cx + dx, z = cz + dz;
          for (let dy = 1; dy <= 4; dy++) this.put(chunk, x, y + dy, z, B.AIR);
          this.put(chunk, x, y, z, dx * dx + dz * dz > 10 ? B.COBBLE : B.ICE);
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
            this.put(chunk, x, y + 1, z, B.GOLD_ORE);
            this.put(chunk, x, y + 2, z, B.GLASS);
          }
        }
        this.put(chunk, cx, y + 1, cz, B.DIAMOND_ORE);
        this.put(chunk, cx, y + 2, cz, B.GLASS);
      }
    }

    decorateCaves(chunk) {
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK, blocks = chunk.blocks;
      for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
        const wx = bx + x, wz = bz + z;
        const kind = this.caveBiomeAt(wx, wz);
        if (!kind) continue;
        const h = this.heightAt(wx, wz);
        for (let y = 5; y < Math.min(h - 4, 58); y++) {
          const i = (y * CHUNK + z) * CHUNK + x;
          if (blocks[i] !== B.AIR) continue;
          const below = i - CHUNK * CHUNK, above = i + CHUNK * CHUNK;
          const roll = N.hash3(wx, y, wz, this.seed + 13001);
          if (kind === 'lush_caves') {
            if (blocks[below] === B.STONE) blocks[below] = roll < 0.16 ? B.CLAY : B.MOSS;
            if (blocks[above] === B.STONE && roll > 0.55) blocks[above] = B.MOSS;
          } else {
            if (blocks[below] === B.STONE && roll < 0.33) blocks[below] = B.DRIPSTONE;
            if (blocks[above] === B.STONE && roll > 0.68) blocks[above] = B.DRIPSTONE;
            // 体素化钟乳石/石笋，只在洞室有足够空间时延伸。
            if (roll < 0.045 && blocks[below] === B.DRIPSTONE && blocks[above] === B.AIR) blocks[i] = B.DRIPSTONE;
            if (roll > 0.955 && blocks[above] === B.DRIPSTONE && blocks[below] === B.AIR) blocks[i] = B.DRIPSTONE;
          }
        }
      }
    }

    placeTrees(chunk) {
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
      const s = this.seed;
      for (let mz = -3; mz < CHUNK + 3; mz++) {
        for (let mx = -3; mx < CHUNK + 3; mx++) {
          const wx = bx + mx, wz = bz + mz;
          const tp = N.randomAt(wx, wz, s + 6203);
          const cr = N.randomAt(wx, wz, s + 7777);
          if (tp > 0.032 && cr > 0.006) continue;
          const h = this.heightAt(wx, wz);
          if (h <= SEA + 2 || h > 63) continue;
          const biome = this.biomeAt(wx, wz, h);
          if (biome === 'desert' || biome === 'badlands') {
            if (cr < 0.006) {
              const th = 1 + ((N.randomAt(wx, wz, s + 331) * 3) | 0);
              for (let i = 1; i <= th; i++) this.put(chunk, wx, h + i, wz, B.CACTUS, true);
            }
            continue;
          }
          const dens = TREE_DENSITY[biome] || 0;
          if (dens <= 0 || tp > dens) continue;
          // 陡坡上不长树
          if (Math.abs(this.heightAt(wx + 2, wz) - h) > 2 ||
              Math.abs(this.heightAt(wx - 2, wz) - h) > 2 ||
              Math.abs(this.heightAt(wx, wz + 2) - h) > 2 ||
              Math.abs(this.heightAt(wx, wz - 2) - h) > 2) continue;
          // 树种：森林混白桦，雪原云杉，其余橡树
          let kind = 'oak';
          if (biome === 'snow' || biome === 'taiga') kind = 'spruce';
          else if (biome === 'cherry') kind = 'cherry';
          else if (biome === 'forest' && N.randomAt(wx, wz, s + 5555) < 0.42) kind = 'birch';
          this.placeTree(chunk, wx, h, wz, kind, s);
        }
      }
    }

    placePetals(chunk) {
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
      for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
        const wx = bx + x, wz = bz + z;
        if (N.randomAt(wx, wz, this.seed + 18881) > 0.15) continue;
        const h = this.heightAt(wx, wz);
        if (h > SEA + 2 && h < 64 && this.biomeAt(wx, wz, h) === 'cherry') {
          const i = ((h + 1) * CHUNK + z) * CHUNK + x;
          if (chunk.blocks[i] === B.AIR) chunk.blocks[i] = B.PINK_PETALS;
        }
      }
    }

    placeBoulders(chunk) {
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
      for (let z = -2; z < CHUNK + 2; z++) for (let x = -2; x < CHUNK + 2; x++) {
        const wx = bx + x, wz = bz + z;
        if (N.randomAt(wx, wz, this.seed + 28071) > 0.0015) continue;
        const h = this.heightAt(wx, wz);
        if (h < SEA + 4 || h > 73) continue;
        const biome = this.biomeAt(wx, wz, h);
        if (biome !== 'mountain' && biome !== 'taiga') continue;
        const radius = N.randomAt(wx, wz, this.seed + 28072) > 0.6 ? 2 : 1;
        for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dz * dz > radius * radius + 0.5) continue;
          const ground = this.heightAt(wx + dx, wz + dz);
          if (Math.abs(ground - h) > 2) continue;
          const top = dx === 0 && dz === 0 ? 2 : 1;
          for (let dy = 1; dy <= top; dy++) this.put(chunk, wx + dx, ground + dy, wz + dz, B.COBBLE, true);
        }
      }
    }

    nearPeakTrail(wx, wz, radius) {
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        const x = wx + dx, z = wz + dz;
        const cells = this.trailIndex.get(this.chunkKey(x >> 4, z >> 4));
        if (cells && cells.has(x + ',' + z)) return true;
      }
      return false;
    }

    placeAlpineDetails(chunk) {
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
      for (let z = -4; z < CHUNK + 4; z++) for (let x = -4; x < CHUNK + 4; x++) {
        const wx = bx + x, wz = bz + z;
        const treeRoll = N.randomAt(wx, wz, this.seed + 28129);
        const cragRoll = N.randomAt(wx, wz, this.seed + 28147);
        if (treeRoll >= 0.018 && cragRoll >= 0.006) continue;
        const peak = this.peakRise(wx, wz);
        if (peak < 5) continue;
        const h = this.heightAt(wx, wz);
        const tree = h >= 64 && h <= 95 && treeRoll < 0.018;
        const crag = h >= 83 && h <= 113 && peak > 12 && cragRoll < 0.006;
        if (!tree && !crag) continue;
        if (this.nearPeakTrail(wx, wz, tree ? 4 : 3)) continue;
        const slope = Math.max(
          Math.abs(this.heightAt(wx + 2, wz) - h), Math.abs(this.heightAt(wx - 2, wz) - h),
          Math.abs(this.heightAt(wx, wz + 2) - h), Math.abs(this.heightAt(wx, wz - 2) - h));
        if (tree && slope <= 3) {
          this.placeTree(chunk, wx, h, wz, 'spruce', this.seed);
          continue;
        }
        if (!crag || slope > 5) continue;
        const ice = N.randomAt(wx, wz, this.seed + 28153) > 0.7;
        const height = 2 + ((N.randomAt(wx, wz, this.seed + 28159) * 3) | 0);
        for (let dy = 1; dy <= height; dy++) {
          this.put(chunk, wx, h + dy, wz, ice ? B.ICE : B.STONE, true);
          if (dy <= 2) {
            this.put(chunk, wx + 1, h + dy, wz, ice ? B.ICE : B.COBBLE, true);
            this.put(chunk, wx, h + dy, wz + 1, ice ? B.ICE : B.COBBLE, true);
          }
        }
      }
    }

    placeTree(chunk, wx, h, wz, kind, s) {
      const rnd = (salt) => N.randomAt(wx, wz, s + salt);
      let th, logId, leafId;
      if (kind === 'cherry') {
        th = 5 + ((rnd(14) * 3) | 0);
        logId = B.CHERRY_LOG; leafId = B.CHERRY_LEAVES;
      } else if (kind === 'spruce') {
        th = 7 + ((rnd(11) * 4) | 0);
        logId = B.SPRUCE_LOG; leafId = B.SPRUCE_LEAVES;
      } else if (kind === 'birch') {
        th = 5 + ((rnd(12) * 3) | 0);
        logId = B.BIRCH_LOG; leafId = B.BIRCH_LEAVES;
      } else {
        th = 4 + ((rnd(13) * 3) | 0);
        logId = B.LOG; leafId = B.LEAVES;
      }

      for (let i = 1; i <= th; i++) this.put(chunk, wx, h + i, wz, logId, false);
      const top = h + th;

      if (kind === 'spruce') {
        // 圆锥形：底部最宽，往上逐层收窄
        for (let dy = -7; dy <= 0; dy++) {
          const t = dy + 7;                 // 0 = 最底层
          const rad = t < 3 ? 2 : (t < 7 ? 1 : 0);
          for (let dz = -rad; dz <= rad; dz++) {
            for (let dx = -rad; dx <= rad; dx++) {
              if (dx === 0 && dz === 0) continue;
              if (dx * dx + dz * dz > rad * rad + 1) continue;
              this.put(chunk, wx + dx, top + dy, wz + dz, leafId, true);
            }
          }
        }
        this.put(chunk, wx, top + 1, wz, leafId, true);
        this.put(chunk, wx, top, wz, leafId, true);
      } else {
        // 圆冠：两层半径 2 + 两层半径 1，砍掉四角
        for (let dy = -2; dy <= 1; dy++) {
          const rad = dy <= -1 ? 2 : 1;
          for (let dz = -rad; dz <= rad; dz++) {
            for (let dx = -rad; dx <= rad; dx++) {
              if (dx * dx + dz * dz > (rad === 2 ? 6 : 3)) continue;
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
              if (dx === 0 && dz === 0 && dy <= 0) continue;
              this.put(chunk, wx + dx, top + dy, wz + dz, leafId, true);
            }
          }
        }
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
            this.put(chunk, wx + dx, top + 2, wz + dz, leafId, true);
          }
        }
        if (kind === 'cherry') {
          for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
            if (dx * dx + dz * dz > 10) continue;
            this.put(chunk, wx + dx, top - 1, wz + dz, leafId, true);
          }
        }
      }
    }

    applyEdits(chunk) {
      const chunkEdits = this.editIndex.get(chunk.cx + ',' + chunk.cz);
      if (!chunkEdits) return;
      const blocks = chunk.blocks;
      for (const [index, id] of chunkEdits) blocks[index] = id;
    }

    nearTree(x, z) {
      for (let dz = -5; dz <= 5; dz++) {
        for (let dx = -5; dx <= 5; dx++) {
          const wx = x + dx, wz = z + dz;
          if (N.randomAt(wx, wz, this.seed + 6203) > 0.011) continue;
          const h = this.heightAt(wx, wz);
          if (h > SEA + 2 && h <= 63) return true;
        }
      }
      return false;
    }

    findSpawn() {
      if (this.valley) {
        const v = this.valley;
        const x = Math.round(v.x - v.rx * 1.15), z = Math.round(v.z + v.rz * 0.21);
        const dx = v.x + 40 - x, dz = v.z + 25 - z;
        return { x: x + 0.5, y: this.heightAt(x, z) + 1.2, z: z + 0.5,
          yaw: Math.atan2(-dx, -dz), pitch: -0.055 };
      }
      // 挑一个「靠海 + 有起伏」的出生点，第一眼就有风景
      let best = null, bestScore = -1e9;
      for (let gz = -6; gz <= 6; gz++) {
        for (let gx = -6; gx <= 6; gx++) {
          const x = gx * 32, z = gz * 32;
          const h = this.heightAt(x, z);
          if (h <= SEA + 2 || h > 54) continue;
          if (this.nearTree(x, z)) continue;
          let water = 0, relief = 0, hill = 0, waterAng = 0, waterDist = 1e9;
          for (let r = 16; r <= 80; r += 16) {
            for (let a = 0; a < 8; a++) {
              const ang = (a / 8) * Math.PI * 2;
              const hh = this.heightAt(x + Math.round(Math.cos(ang) * r), z + Math.round(Math.sin(ang) * r));
              if (hh <= SEA) { water = 1; if (r < waterDist) { waterDist = r; waterAng = ang; } }
              if (hh > hill) hill = hh;
              if (hh > h + relief) relief = hh - h;
            }
          }
          const biome = this.biomeAt(x, z, h);
          let score = water * 60 + Math.min(30, relief * 2) + Math.min(20, Math.max(0, hill - 50));
          if (biome === 'forest' || biome === 'plains') score += 14;
          else if (biome === 'snow') score -= 6;
          else if (biome === 'desert') score -= 8;
          score -= Math.hypot(x, z) * 0.05;
          if (score > bestScore) {
            bestScore = score;
            best = { x: x + 0.5, z: z + 0.5, h, waterAng, waterDist };
          }
        }
      }
      if (best) {
        const yaw = best.waterDist < 1e8 ? Math.atan2(-Math.cos(best.waterAng), -Math.sin(best.waterAng)) : 0.7;
        return { x: best.x, y: best.h + 1.2, z: best.z, yaw };
      }

      for (let r = 0; r < 300; r += 3) {
        const steps = r === 0 ? 1 : 16;
        for (let a = 0; a < steps; a++) {
          const ang = (a / steps) * Math.PI * 2 + r * 0.37;
          const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
          const h = this.heightAt(x, z);
          if (h > SEA + 3 && h < 62) return { x: x + 0.5, y: h + 1.2, z: z + 0.5 };
        }
      }
      return { x: 0.5, y: this.heightAt(0, 0) + 1.2, z: 0.5 };
    }
  }

  World.DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  MC.World = World;
  MC.WORLD = { CHUNK, HEIGHT, SEA, CHUNK_VOL };
  MC.BIOME_NAMES = BIOME_NAMES;
})();

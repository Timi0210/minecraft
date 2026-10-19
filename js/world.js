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
  // 下界放在同一坐标存档的独立地带，区块、编辑和背包因而可以原样沿用。
  const NETHER_X = 65536;
  const NETHER_EDGE = 60000;

  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const nz = (x, z, salt, oct) => (N.fbm2(x, z, salt, oct, 2, 0.5) - 0.5) * 3.6;
  const TREE_DENSITY = { forest: 0.032, taiga: 0.024, cherry: 0.03, plains: 0.006, snow: 0.014, mountain: 0, beach: 0, desert: 0, badlands: 0, ocean: 0 };
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
    mountain: 8, badlands: 9, snow: 3, ocean: -19
  };
  const PEAK_LINKS = [[1, 0, 56, 90], [0, 2, 58, 92], [2, 3, 43, 78]];
  const BIOME_NAMES = {
    ocean: '海洋', frozen_ocean: '冻洋', beach: '沙滩', desert: '沙漠', plains: '平原',
    forest: '森林', taiga: '针叶林', snow: '雪原', mountain: '山地', cherry: '樱花林', badlands: '恶地',
    lush_caves: '繁茂洞穴', dripstone_caves: '滴水石洞穴',
    crimson: '绯红森林', warped: '诡异森林', basalt: '玄武岩三角洲', souls: '灵魂沙峡谷'
  };

  /* 九座石碑的残页。它们不组成任务，只是同一段往事的不同切口。 */
  const TABLET_BIOMES = ['plains', 'forest', 'desert', 'cherry', 'mountain', 'badlands', 'snow', 'taiga', 'beach'];
  const TABLET_TEXTS = {
    plains: ['一 · 无名之地', '很久以前，这里没有名字。\n\n人们把第一块石头立起来，叫它远野。\n\n后来石头被草盖住了，名字却留了下来。'],
    forest: ['二 · 树先到', '树比人先到这里。\n\n伐木的人说，每棵树倒下时，森林都会往后退一步。\n\n所以他们只砍够用的，把剩下的路留给树。'],
    desert: ['三 · 沙下的河', '沙下有河。\n\n有人把水存在陶罐里，再把陶罐埋回沙里，留给下一个路过的人。\n\n没有人知道第一个人是谁。'],
    cherry: ['四 · 安静的一天', '樱花开的时候，村子会安静一天。\n\n没有人规定，但大家都记得。\n\n连风都放轻了脚步。'],
    mountain: ['五 · 山不阻止', '山不欢迎人。\n\n它只是不阻止人。\n\n登上去的人说，山顶的风会把名字吹走，所以下山后要重新介绍自己。'],
    badlands: ['六 · 烧过的土', '彩色的土层里夹着一层灰。\n\n老人说，那是远野烧过一场很大的火。\n\n火之后，土变成了现在这样，一层一层，像书页。'],
    snow: ['七 · 雪线', '雪线之上没有路。\n\n只有风记得谁上去过。\n\n它不告诉任何人。'],
    taiga: ['八 · 替山挡风', '云杉排成队，替山挡风。\n\n最外圈的那排树总是弯的。\n\n里面那排，长得很直。'],
    beach: ['九 · 海的另一边', '海的另一边也有人。\n\n他们也在石头上写字。\n\n潮水把两边的话都磨掉了一半，剩下的刚好能读懂。']
  };

  // 每个站点会占用的最大水平半径，用于区块生成时的快速裁剪。
  const SITE_RADIUS = {
    origin: 6, sword: 5, cairn: 4, cabin: 17, lab: 8, ship: 8, bench: 4,
    sky: 10, tablet: 3, giant: 12, lighthouse: 7, arch: 7
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
      // 四条相连的山脊环抱冰川谷。种子只轻微偏移整组山，不会把谷地撕开。
      const offsetX = Math.round((N.hash2(1, 0, this.seed + 19001) - 0.5) * 34);
      const offsetZ = Math.round((N.hash2(2, 0, this.seed + 19001) - 0.5) * 34);
      this.peaks = [
        [310 + offsetX, 370 + offsetZ, 215, 195, 94],
        [105 + offsetX, 300 + offsetZ, 185, 205, 67],
        [470 + offsetX, 305 + offsetZ, 185, 190, 68],
        [520 + offsetX, 165 + offsetZ, 150, 170, 49]
      ];
      this.glacier = { x: 280 + offsetX, z: 245 + offsetZ, rx: 150, rz: 145 };
      const v = this.glacier;
      // 岩石前哨仍作为雪谷中的唯一建筑，位置落在谷内较高的山肩。
      const outpostX = v.x + 26;
      const outpostZ = v.z + 28;
      let outpostY = 0;
      for (let dz = -20; dz <= 22; dz += 4) for (let dx = -31; dx <= 29; dx += 4)
        outpostY = Math.max(outpostY, this.heightAt(outpostX + dx, outpostZ + dz));
      this.outpost = { x: outpostX, z: outpostZ, y: Math.min(112, outpostY + 1) };
      const entranceDepth = (wallZ, direction) => {
        for (let distance = 6; distance <= 32; distance++) {
          if (this.heightAt(outpostX - 17, outpostZ + wallZ + direction * distance) >=
              this.outpost.y - (distance - 3)) return distance;
        }
        return 32;
      };
      this.outpostPathEnds = {
        north: entranceDepth(-13, -1), south: entranceDepth(8, 1)
      };
      this.outpostChest = { x: outpostX - 21, y: this.outpost.y + 1, z: outpostZ + 1 };
      this.outpostPortal = { x: outpostX + 11, y: this.outpost.y + 3, z: outpostZ - 3 };
      this.netherExit = { x: NETHER_X, z: 0, y: 69 };
      if (savedEdits && savedEdits.length) {
        for (let i = 0; i < savedEdits.length; i++) {
          const e = savedEdits[i];
          if (e && e.length === 4) this.recordEdit(e[0], e[1], e[2], e[3]);
        }
      }
      this.spawn = this.findSpawn();
      // 开放世界的内容：远景地标、散落的人造痕迹与不进入任何列表的彩蛋。
      this.lore = new Map();
      this.sites = [];
      this.planOpenWorld();
    }

    chunkKey(cx, cz) { return cx + ',' + cz; }

    getChunk(cx, cz) {
      return this.chunks.get(cx + ',' + cz) || null;
    }

    ensureChunk(cx, cz) {
      return this.installChunk(cx, cz);
    }

    // 后台线程送回完整方块数组时，只在主线程登记光源与接缝。
    installChunk(cx, cz, blocks) {
      const key = cx + ',' + cz;
      let c = this.chunks.get(key);
      if (!c) {
        c = new Chunk(cx, cz);
        this.chunks.set(key, c);
        if (blocks) {
          c.blocks = blocks;
          this.applyEdits(c);
        } else this.generate(c);
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
        // 结构里的火把是直接写进方块的，这里补一次光源登记。
        for (let i = 0; i < c.blocks.length; i++) {
          if (c.blocks[i] !== B.TORCH) continue;
          const y = Math.floor(i / 256), z = (i >> 4) & 15, x = i & 15;
          const wx = cx * 16 + x, wz = cz * 16 + z;
          this.lightSources.set(wx + ',' + y + ',' + wz, [wx, y, wz]);
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
      if (this.isNether(x, z)) return { biome: this.netherBiome(x, z), height: 0, mountain: 0, badlands: 0, dry: 0, snow: 0 };
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
      return { biome, height, mountain, badlands, dry, snow };
    }

    peakRise(x, z) {
      // Sharp summits and branching ribs, with a wide footprint for a full massif.
      const v = this.glacier;
      if (v && (x < v.x - 430 || x > v.x + 455 || z < v.z - 270 || z > v.z + 435)) return 0;
      let rise = 0;
      for (let i = 0; i < this.peaks.length; i++) {
        const p = this.peaks[i], dx = (x - p[0]) / p[2], dz = (z - p[1]) / p[3];
        const rawRadius = Math.hypot(dx, dz);
        if (rawRadius >= 1.34) continue;
        const angle = Math.atan2(dz, dx);
        const folds = 1 + Math.sin(angle * (5 + i % 3) + i * 1.7) * 0.18 +
          Math.sin(angle * (11 + i % 2) - i * 0.9) * 0.07;
        const radius = rawRadius * folds;
        if (radius >= 1) continue;
        const taper = 1 - radius;
        const ribs = Math.pow(Math.max(0, Math.cos(angle * (5 + i % 3) + i * 1.7)), 4);
        const irregular = (N.noise2(x * 0.014, z * 0.014, this.seed + 21341 + i * 197) - 0.5) * 9;
        const summit = p[4] * Math.pow(taper, 1.04) + ribs * radius * taper * 28 + irregular * taper;
        rise = Math.max(rise, summit);
      }
      // Saddles connect the summits into one horizon-wide mountain chain.
      for (const [from, to, height, width] of PEAK_LINKS) {
        const a = this.peaks[from], b = this.peaks[to];
        const vx = b[0] - a[0], vz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz)));
        if (t <= 0 || t >= 1) continue;
        const distance = Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
        if (distance >= width) continue;
        const saddle = height * Math.pow(1 - distance / width, 1.12) * Math.pow(Math.sin(Math.PI * t), 0.72);
        rise = Math.max(rise, saddle);
      }
      return rise;
    }

    glacierAxis(z) {
      const v = this.glacier;
      return v.x + Math.sin((z - v.z) * 0.011) * 24 +
        (N.noise2(z * 0.008, 7.3, this.seed + 22217) - 0.5) * 28;
    }

    glacierWidth(z) {
      return this.glacier.rx * (0.80 +
        N.noise2(z * 0.011, 5.7, this.seed + 22253) * 0.29);
    }

    glacierWeight(x, z) {
      const v = this.glacier;
      if (!v) return 0;
      if (z < v.z - 270 || z > v.z + 195 || Math.abs(x - v.x) > v.rx * 1.65) return 0;
      // The glacier is an open, winding valley, not a circular basin.
      const axis = this.glacierAxis(z);
      const warp = (N.noise2(x * 0.009, z * 0.009, this.seed + 22517) - 0.5) * 0.19;
      const lateral = Math.abs(x - axis) / this.glacierWidth(z) + warp;
      const sides = 1 - smoothstep(0.55, 1.18, lateral);
      const endWarp = (N.noise2(x * 0.009, z * 0.009, this.seed + 22319) - 0.5) * 32;
      const front = smoothstep(v.z - 245, v.z - 153, z + endWarp);
      const back = 1 - smoothstep(v.z + 45, v.z + 120, z + endWarp);
      return sides * front * back;
    }

    heightAt(x, z, field) {
      if (this.isNether(x, z)) return this.netherHeight(x, z);
      const s = this.seed;
      field = field || this.biomeField(x, z);
      let h = 39 + field.height;
      h += nz(x * 0.0027, z * 0.0027, s + 101, 3) * 5;
      h += nz(x * 0.012, z * 0.012, s + 211, 3) * (3.5 + field.mountain * 6);
      h += nz(x * 0.045, z * 0.045, s + 503, 2) * 1.4;
      // Every mountain region uses ridged terrain; the first massif adds broad
      // named summits that remain visible from the glacier floor.
      const ridge = 1 - Math.abs(N.fbm2(x * 0.006, z * 0.006, s + 337, 3) * 2 - 1);
      const highland = field.mountain * (20 + 52 * Math.pow(ridge, 2.2));
      const summit = this.peakRise(x, z);
      h += Math.max(highland, summit);
      h += field.badlands * Math.floor(N.noise2(x * 0.009, z * 0.009, s + 404) * 4) * 2;
      const river = Math.abs(nz(x * 0.0028, z * 0.0028, s + 1511, 3));
      const cut = smoothstep(0.13, 0.025, river) * (1 - field.mountain * 0.9) *
        (1 - smoothstep(3, 24, summit));
      h -= cut * Math.max(0, h - SEA + 1);
      if (this.glacier) {
        const v = this.glacier;
        if (z > v.z - 245 && z < v.z + 145 && Math.abs(x - v.x) < v.rx * 1.5) {
          const axis = this.glacierAxis(z);
          const lateral = Math.abs(x - axis) / this.glacierWidth(z);
          const floor = 59 + 8 * smoothstep(0.18, 1.1, lateral) +
            (z - v.z) * 0.018 +
            (N.noise2(x * 0.025, z * 0.025, s + 5213) - 0.5) * 3;
          const blend = this.glacierWeight(x, z);
          h -= Math.max(0, h - floor) * blend;
          // A small rocky knoll carries the outpost above the snowfield.
          const island = Math.hypot((x - v.x - 26) / 39, (z - v.z - 28) / 31);
          h += 10 * (1 - smoothstep(0.25, 1.25, island)) * blend;
        }
      }
      // Compress only the very tallest tips so no seed produces a flat 136-block roof.
      if (h > 129) h = 129 + 7 * (1 - Math.exp(-(h - 129) / 7));
      return Math.max(5, Math.min(MAX_TERRAIN, Math.round(h)));
    }

    biomeAt(x, z, h, field) {
      if (this.isNether(x, z)) return this.netherBiome(x, z);
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
      if (this.isNether(x, z)) return this.netherBiome(x, z);
      const h = this.heightAt(x, z);
      return y < h - 4 ? (this.caveBiomeAt(x, z) || this.biomeAt(x, z, h)) : this.biomeAt(x, z, h);
    }

    isNether(x, z) { return x >= NETHER_EDGE; }

    netherBiome(x, z) {
      const n = N.fbm2((x - NETHER_X) * 0.0032, z * 0.0032, this.seed + 51001, 3);
      return n < 0.36 ? 'souls' : n < 0.51 ? 'crimson' : n < 0.68 ? 'warped' : 'basalt';
    }

    netherHeight(x, z) {
      const nx = x - NETHER_X;
      const broad = N.fbm2(nx * 0.007, z * 0.007, this.seed + 51103, 3);
      const ridge = 1 - Math.abs(N.fbm2(nx * 0.018, z * 0.018, this.seed + 51127, 3) * 2 - 1);
      let h = 30 + broad * 38 + Math.pow(ridge, 2) * 13;
      // 门周围是一块安全的岩台；越过边缘便能看到熔岩海和菌林。
      const d = Math.hypot(nx, z);
      h += (68 - h) * (1 - smoothstep(14, 38, d));
      return Math.max(22, Math.min(103, Math.round(h)));
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
      if (this.isNether(bx, bz)) { this.generateNether(chunk); return; }
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
          const peakStrength = this.peakRise(wx, wz);
          const glacier = this.glacierWeight(wx, wz);
          const protectedAlpine = glacier > 0.12 || peakStrength > 9;
          const redlands = !protectedAlpine && field.badlands >
            0.40 + N.noise2(wx * 0.052, wz * 0.052, this.seed + 3703) * 0.30;
          const sandy = !protectedAlpine && field.dry >
            0.25 + N.noise2(wx * 0.052, wz * 0.052, this.seed + 3903) * 0.50;
          const alpine = field.mountain > 0.18 || peakStrength > 9 || glacier > 0.12;
          const snowline = 73 - glacier * 23 - field.mountain * 7 +
            (N.noise2(wx * 0.028, wz * 0.028, this.seed + 3503) - 0.5) * 10;
          const snowy = !redlands && ((alpine && h >= snowline) || field.snow >
            0.28 + N.noise2(wx * 0.052, wz * 0.052, this.seed + 4103) * 0.45);
          const rockNoise = N.noise2(wx * 0.024, wz * 0.024, this.seed + 28013) * 0.34 +
            (N.noise2(wx * 0.083, wz * 0.083, this.seed + 28031) - 0.5) * 0.10;
          const exposure = smoothstep(75, 112, h) * 0.35 +
            smoothstep(1, 4, slope) * 0.18 + rockNoise - glacier * 0.42;
          const rockPatch = snowy && alpine && h > 75 && exposure > 0.47;
          const rocky = slope >= 4 || h >= 64;
          const mossy = (biome === 'forest' || biome === 'taiga') &&
            N.noise2(wx * 0.042, wz * 0.042, this.seed + 2277) > 0.66;
          const surface = snowy ? (rockPatch ? B.STONE : B.SNOW) :
            (redlands ? B.RED_SAND : (beach || sandy ? B.SAND : ((rocky && !cherry) ? B.STONE : (mossy ? B.MOSS : B.GRASS))));
          const under = redlands ? B.TERRACOTTA : (beach || sandy ? B.SAND : (rocky ? B.STONE : B.DIRT));
          const caveCeiling = Math.min(h - 2, 72);
          for (let y = 0; y <= top; y++) {
            let id = 0;
            if (y === 0) {
              id = B.BEDROCK;
            } else if (y <= h) {
              if (y === h) id = surface;
              else if (snowy && !rockPatch && y >= h - 3) id = B.SNOW;
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
      this.placePetals(chunk);
      this.placeAlpineOutpost(chunk);
      this.placeOpenWorld(chunk);
      this.applyEdits(chunk);
      chunk.generated = true;
    }

    generateNether(chunk) {
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK, blocks = chunk.blocks;
      for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
        const wx = bx + x, wz = bz + z;
        const h = this.netherHeight(wx, wz), biome = this.netherBiome(wx, wz);
        const sea = 35;
        const top = Math.max(h, sea);
        const surface = biome === 'basalt' ? B.BASALT : biome === 'souls' ? B.SOUL_SAND : B.NETHERRACK;
        for (let y = 0; y <= top; y++) {
          let id = y === 0 ? B.BEDROCK : y <= h ? (y >= h - 3 ? surface : B.NETHERRACK) : B.LAVA;
          if (id === B.NETHERRACK && y > 7 && y < h - 7 &&
              N.noise3(wx * 0.045, y * 0.07, wz * 0.045, this.seed + 51239) > 0.78) id = B.AIR;
          if (id === B.NETHERRACK && y < h - 3 && N.hash3(wx, y, wz, this.seed + 51427) > 0.994)
            id = B.QUARTZ_ORE;
          blocks[(y * CHUNK + z) * CHUNK + x] = id;
        }
        // 厚实的洞顶包住下界，不借用地表的天空。
        const roof = 122 + Math.floor(N.noise2(wx * 0.02, wz * 0.02, this.seed + 51301) * 8);
        for (let y = roof; y < HEIGHT; y++)
          blocks[(y * CHUNK + z) * CHUNK + x] = y >= HEIGHT - 2 ? B.BEDROCK : B.NETHERRACK;
        if (N.hash2(wx, wz, this.seed + 51503) > 0.987)
          this.put(chunk, wx, roof - 1, wz, B.GLOWSTONE);
      }
      // 邻区块同样扫描边缘种子，菌伞能自然跨过区块线。
      for (let dz = -4; dz < CHUNK + 4; dz++) for (let dx = -4; dx < CHUNK + 4; dx++) {
        const x = bx + dx, z = bz + dz;
        if (Math.hypot(x - NETHER_X, z) < 14 || N.hash2(x, z, this.seed + 51611) > 0.012) continue;
        const biome = this.netherBiome(x, z);
        if (biome !== 'crimson' && biome !== 'warped') continue;
        const h = this.netherHeight(x, z);
        if (h <= 38 || h > 91) continue;
        const stem = biome === 'crimson' ? B.CRIMSON_STEM : B.WARPED_STEM;
        const cap = biome === 'crimson' ? B.CRIMSON_CAP : B.WARPED_CAP;
        const th = 4 + Math.floor(N.hash2(x, z, this.seed + 51631) * 4);
        for (let y = h + 1; y <= h + th; y++) this.put(chunk, x, y, z, stem);
        for (let zz = -2; zz <= 2; zz++) for (let xx = -2; xx <= 2; xx++) {
          if (xx * xx + zz * zz > 6) continue;
          this.put(chunk, x + xx, h + th, z + zz, cap, true);
          if (Math.abs(xx) <= 1 && Math.abs(zz) <= 1) this.put(chunk, x + xx, h + th + 1, z + zz, cap, true);
        }
      }
      this.placePortal(chunk, this.netherExit.x, this.netherExit.y, this.netherExit.z, true);
      this.applyEdits(chunk);
      chunk.generated = true;
    }

    placePortal(chunk, x0, floor, z0, platform) {
      // 4×5 黑曜石门框，中心可穿行；与真实的方块网格对齐。
      if (platform) for (let dx = -3; dx <= 6; dx++) for (let dz = -4; dz <= 4; dz++) {
        const x = x0 + dx, z = z0 + dz;
        for (let y = this.netherHeight(x, z) + 1; y < floor; y++) this.put(chunk, x, y, z, B.NETHERRACK);
        this.put(chunk, x, floor - 1, z, B.BASALT);
        for (let y = floor; y <= floor + 5; y++) this.put(chunk, x, y, z, B.AIR);
      }
      for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 5; dy++) {
        const edge = dx === 0 || dx === 3 || dy === 0 || dy === 4;
        this.put(chunk, x0 + dx, floor + dy, z0, edge ? B.OBSIDIAN : B.PORTAL);
      }
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

    placeAlpineOutpost(chunk) {
      const site = this.outpost;
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
      if (bx > site.x + 30 || bx + CHUNK - 1 < site.x - 31 ||
          bz > site.z + Math.max(27, 8 + this.outpostPathEnds.south) ||
          bz + CHUNK - 1 < site.z - Math.max(20, 13 + this.outpostPathEnds.north)) return;
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
      // 朝向雪谷来路的北门和南侧露台共用宽门洞、木门廊与落地台阶。
      const entrance = (wallZ, direction, endDepth) => {
        const outsideZ = wallZ + direction;
        for (let dx = -19; dx <= -15; dx++) {
          for (let dy = 1; dy <= 4; dy++) this.put(chunk, x0 + dx, base + dy, z0 + wallZ, B.AIR);
          this.put(chunk, x0 + dx, base + 5, z0 + wallZ, B.SPRUCE_LOG);
        }
        for (const dx of [-20, -14]) for (const z of [wallZ, outsideZ])
          for (let dy = 1; dy <= 5; dy++) this.put(chunk, x0 + dx, base + dy, z0 + z, B.SPRUCE_LOG);
        for (let distance = 1; distance <= 3; distance++) for (let dx = -21; dx <= -13; dx++) {
          const z = z0 + wallZ + direction * distance;
          this.put(chunk, x0 + dx, base + 6, z, B.PLANKS);
          this.put(chunk, x0 + dx, base + 7, z, B.SNOW);
        }
        // 五格宽的步道贴着原有雪坡落地，路面上方始终留出四格空间。
        for (let distance = 1; distance <= endDepth; distance++) {
          const z = z0 + wallZ + direction * distance;
          const stepY = Math.max(this.heightAt(x0 - 17, z), base - Math.max(0, distance - 3));
          for (let dx = -19; dx <= -15; dx++) {
            const x = x0 + dx, ground = this.heightAt(x, z);
            for (let y = ground + 1; y < stepY; y++) this.put(chunk, x, y, z, B.COBBLE);
            this.put(chunk, x, stepY, z, B.PLANKS);
            for (let y = stepY + 1; y <= Math.max(stepY + 4, ground + 3); y++)
              this.put(chunk, x, y, z, B.AIR);
          }
          if (distance <= endDepth - 2) for (const dx of [-20, -14]) {
            const x = x0 + dx, ground = this.heightAt(x, z);
            for (let y = ground + 1; y <= stepY; y++) this.put(chunk, x, y, z, B.COBBLE);
            this.put(chunk, x, stepY + 1, z, B.SPRUCE_LOG);
          }
        }
        for (const dx of [-20, -14]) this.put(chunk, x0 + dx, base + 2,
          z0 + wallZ + direction * 2, B.TORCH);
      };
      entrance(-13, -1, this.outpostPathEnds.north);
      entrance(8, 1, this.outpostPathEnds.south);
      // 主屋和传送门房之间的封闭连廊，用两级缓坡消化地板高度差。
      for (let dx = -3; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const x = x0 + dx, z = z0 + dz;
        const floor = base + (dx >= 1 ? 2 : dx >= -1 ? 1 : 0);
        const ground = this.heightAt(x, z);
        for (let y = ground + 1; y < floor; y++) this.put(chunk, x, y, z, B.STONE);
        this.put(chunk, x, floor, z, B.PLANKS);
        for (let y = floor + 1; y <= base + 7; y++) this.put(chunk, x, y, z, B.AIR);
        if (dx > -3 && dx < 2) {
          if (Math.abs(dz) === 2) for (let y = floor + 1; y <= base + 7; y++)
            this.put(chunk, x, y, z, y >= base + 3 && y <= base + 5 ? B.GLASS : B.STONE);
          this.put(chunk, x, base + 8, z, B.WHITE_TERRACOTTA);
          this.put(chunk, x, base + 9, z, B.SNOW);
        }
      }
      // 左侧物资间：补给箱、工作台与可以辨认的储物架。
      this.put(chunk, x0 - 21, base + 1, z0 + 1, B.SUPPLY_CHEST);
      this.put(chunk, x0 - 24, base + 1, z0 - 3, B.TABLE);
      for (const [dx, dz] of [[-27, -8], [-27, 4], [-10, -8]]) {
        this.put(chunk, x0 + dx, base + 2, z0 + dz, B.PLANKS);
        this.put(chunk, x0 + dx, base + 3, z0 + dz, B.PLANKS);
      }
      this.put(chunk, x0 - 20, base + 2, z0 - 9, B.TORCH);
      // 另一间房里的传送门与雪谷形成鲜明的色彩对照。
      this.placePortal(chunk, this.outpostPortal.x, this.outpostPortal.y, this.outpostPortal.z, false);
      this.put(chunk, x0 + 20, base + 5, z0 - 8, B.TORCH);
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

    /* ---------------- 开放世界：选址、结构与散落的注脚 ---------------- */

    maxHeight(x, z, r) {
      let y = 0;
      for (let dz = -r; dz <= r; dz += 2)
        for (let dx = -r; dx <= r; dx += 2)
          y = Math.max(y, this.heightAt(x + dx, z + dz));
      return y;
    }

    flat(x, z, r) {
      const h = this.heightAt(x, z);
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        if (Math.abs(this.heightAt(x + dx, z + dz) - h) > 2) return false;
      }
      return true;
    }

    nearWater(x, z, r) {
      for (let a = 0; a < 8; a++) {
        const ang = a * Math.PI / 4;
        for (let d = Math.max(4, r - 8); d <= r; d += 2) {
          if (this.heightAt(x + Math.round(Math.cos(ang) * d),
            z + Math.round(Math.sin(ang) * d)) < SEA) return true;
        }
      }
      return false;
    }

    freeSite(x, z, dist) {
      for (const s of this.sites) {
        if (Math.hypot(s.x - x, s.z - z) < dist) return false;
      }
      return true;
    }

    addSite(site) {
      this.sites.push(site);
      return site;
    }

    setLore(x, y, z, title, text) {
      this.lore.set(x + ',' + y + ',' + z, { title, text });
    }

    loreAt(x, y, z) {
      return this.lore.get(x + ',' + y + ',' + z) || null;
    }

    findSite(ox, oz, minR, maxR, filter) {
      for (let r = minR; r <= maxR; r += 20) {
        const steps = Math.max(12, Math.round(r / 12));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2 +
            (N.hash2(r, i, this.seed + 9029) - 0.5) * 1.1;
          const x = Math.round(ox + Math.cos(a) * r);
          const z = Math.round(oz + Math.sin(a) * r);
          const h = this.heightAt(x, z);
          if (h <= SEA + 2 || h > MAX_TERRAIN - 14) continue;
          const biome = this.biomeAt(x, z, h);
          if (!filter(x, z, h, biome)) continue;
          return { x, z, y: h, biome };
        }
      }
      return null;
    }

    findWaterSite(ox, oz, minR, maxR) {
      for (let r = minR; r <= maxR; r += 20) {
        const steps = Math.max(16, Math.round(r / 10));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2 +
            (N.hash2(r, i + 7, this.seed + 12043) - 0.5) * 0.8;
          const x = Math.round(ox + Math.cos(a) * r);
          const z = Math.round(oz + Math.sin(a) * r);
          const h = this.heightAt(x, z);
          if (SEA - h < 6) continue;
          if (!this.freeSite(x, z, 80)) continue;
          if (this.biomeAt(x, z, h) === 'frozen_ocean') continue;
          let shore = false;
          for (let k = 0; k < 8 && !shore; k++) {
            const ang = k * Math.PI / 4;
            shore = this.heightAt(x + Math.round(Math.cos(ang) * 34),
              z + Math.round(Math.sin(ang) * 34)) > SEA + 1;
          }
          if (!shore) continue;
          return { x, z, y: h, biome: 'ocean' };
        }
      }
      return null;
    }

    findHighSite(ox, oz, minR, maxR) {
      let best = null;
      for (let r = minR; r <= maxR; r += 12) {
        const steps = Math.max(10, Math.round(r / 14));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2 +
            (N.hash2(r, i + 3, this.seed + 17707) - 0.5) * 0.7;
          const x = Math.round(ox + Math.cos(a) * r);
          const z = Math.round(oz + Math.sin(a) * r);
          const h = this.heightAt(x, z);
          if (h <= SEA + 3 || h > MAX_TERRAIN - 18) continue;
          if (!this.flat(x, z, 2)) continue;
          if (!this.freeSite(x, z, 46)) continue;
          if (!best || h > best.h) best = { x, z, h };
        }
      }
      return best;
    }

    planOpenWorld() {
      const spawn = this.spawn;

      // 原点：无论那里是陆地还是海面，都立一块石头。
      this.addSite({ type: 'origin', x: 0, z: 0,
        y: Math.max(this.maxHeight(0, 0, 4) + 1, SEA + 2) });

      // 新群峰的两处峰顶仍留有石中剑与旧石堆。
      const p0 = this.peaks[0], p1 = this.peaks[1];
      this.addSite({ type: 'sword', x: Math.round(p0[0]), z: Math.round(p0[1]),
        y: this.heightAt(Math.round(p0[0]), Math.round(p0[1])) + 1 });
      this.addSite({ type: 'cairn', x: Math.round(p1[0]), z: Math.round(p1[1]),
        y: this.heightAt(Math.round(p1[0]), Math.round(p1[1])) + 1 });

      // 开发者小屋：离出生点够远，只有不沿路走的人才会遇到。
      const cabin = this.findSite(spawn.x, spawn.z, 620, 820, (x, z, h, biome) =>
        (biome === 'forest' || biome === 'plains' || biome === 'taiga' || biome === 'snow') &&
        this.flat(x, z, 4) && this.freeSite(x, z, 120));
      if (cabin) this.addSite({ type: 'cabin', x: cabin.x, z: cabin.z,
        y: this.maxHeight(cabin.x, cabin.z, 5) + 1 });

      // 埋在林地边缘的混凝土小屋：一块不该存在的贴图。
      const lab = this.findSite(spawn.x, spawn.z, 150, 320, (x, z, h, biome) =>
        (biome === 'forest' || biome === 'taiga' || biome === 'plains') &&
        this.flat(x, z, 3) && this.freeSite(x, z, 70));
      if (lab) this.addSite({ type: 'lab', x: lab.x, z: lab.z,
        y: this.maxHeight(lab.x, lab.z, 3) + 1 });

      // 沉船：找一个离岸不远、够深的水域。
      const ship = this.findWaterSite(spawn.x, spawn.z, 80, 460);
      if (ship) this.addSite({ type: 'ship', x: ship.x, z: ship.z, y: ship.y + 1 });

      // 长椅：出生点附近最高的、能坐下来的地方。
      const bench = this.findHighSite(spawn.x, spawn.z, 60, 170);
      if (bench) this.addSite({ type: 'bench', x: bench.x, z: bench.z,
        y: bench.h + 1 });

      // 云上小岛：不指路，飞上去才看得见。
      const skyAngle = N.hash2(31, 7, this.seed + 5501) * Math.PI * 2;
      const skyDist = 210 + N.hash2(5, 9, this.seed + 6607) * 80;
      this.addSite({ type: 'sky',
        x: Math.round(spawn.x + Math.cos(skyAngle) * skyDist),
        z: Math.round(spawn.z + Math.sin(skyAngle) * skyDist), y: 138 });

      this.planTablets(spawn);
      this.planLandmarks(spawn);
    }

    planTablets(spawn) {
      const buckets = {};
      for (let dz = -660; dz <= 660; dz += 32) {
        for (let dx = -660; dx <= 660; dx += 32) {
          const x = Math.round(spawn.x + dx), z = Math.round(spawn.z + dz);
          const d = Math.hypot(dx, dz);
          if (d < 90 || d > 620) continue;
          const h = this.heightAt(x, z);
          const biome = this.biomeAt(x, z, h);
          if (!TABLET_TEXTS[biome]) continue;
          if (biome === 'beach') {
            if (h < SEA + 1 || h > SEA + 2) continue;
          } else if (h <= SEA + 2 || h > MAX_TERRAIN - 16) continue;
          if (!this.flat(x, z, 2)) continue;
          if (!this.freeSite(x, z, 52)) continue;
          const list = buckets[biome] || (buckets[biome] = []);
          list.push({ x, z, y: h, d });
        }
      }
      for (let i = 0; i < TABLET_BIOMES.length; i++) {
        const biome = TABLET_BIOMES[i];
        const list = buckets[biome];
        if (!list || !list.length) continue;
        list.sort((a, b) => a.d - b.d);
        let pick = null;
        for (let k = 0; k < Math.min(list.length, 12); k++) {
          const at = list[Math.min(list.length - 1,
            (k + Math.floor(N.hash2(i, k, this.seed + 4409) * 4)) % list.length)];
          if (this.freeSite(at.x, at.z, 64)) { pick = at; break; }
        }
        if (!pick) continue;
        this.addSite({ type: 'tablet', biome, index: i, x: pick.x, z: pick.z,
          y: this.maxHeight(pick.x, pick.z, 1) + 1 });
      }
    }

    planLandmarks(spawn) {
      const defs = [
        { type: 'giant', min: 100, max: 340, radius: 8,
          ok: (x, z, h, b) => (b === 'forest' || b === 'plains') && this.flat(x, z, 5) },
        { type: 'lighthouse', min: 130, max: 430, radius: 6,
          ok: (x, z, h, b) => this.nearWater(x, z, 14) && this.flat(x, z, 3) },
        { type: 'arch', min: 150, max: 420, radius: 11,
          ok: (x, z, h, b) => (b === 'plains' || b === 'desert' || b === 'badlands') &&
            this.flat(x, z, 5) }
      ];
      for (const d of defs) {
        const site = this.findSite(spawn.x, spawn.z, d.min, d.max, (x, z, h, b) =>
          d.ok(x, z, h, b) && this.freeSite(x, z, 115));
        if (!site) continue;
        this.addSite({ type: d.type, x: site.x, z: site.z,
          y: this.maxHeight(site.x, site.z, d.radius) + 1 });
      }
    }

    clearTrees(chunk, x0, z0, x1, z1) {
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
      const ax = Math.max(x0, bx), bx2 = Math.min(x1, bx + CHUNK - 1);
      const az = Math.max(z0, bz), bz2 = Math.min(z1, bz + CHUNK - 1);
      if (ax > bx2 || az > bz2) return;
      for (let z = az; z <= bz2; z++) for (let x = ax; x <= bx2; x++) {
        const lx = x - bx, lz = z - bz;
        for (let y = 1; y < HEIGHT; y++) {
          const i = (y * CHUNK + lz) * CHUNK + lx;
          const id = chunk.blocks[i];
          if (id === B.LOG || id === B.LEAVES || id === B.SPRUCE_LOG ||
              id === B.SPRUCE_LEAVES || id === B.BIRCH_LOG || id === B.BIRCH_LEAVES ||
              id === B.CHERRY_LOG || id === B.CHERRY_LEAVES) chunk.blocks[i] = 0;
        }
      }
    }

    clearBox(chunk, x0, y0, z0, x1, y1, z1) {
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          for (let x = x0; x <= x1; x++) this.put(chunk, x, y, z, 0);
    }

    fillBelow(chunk, x, y, z) {
      const ground = this.heightAt(x, z);
      for (let k = ground + 1; k < y; k++) this.put(chunk, x, k, z, B.COBBLE);
    }

    placeOpenWorld(chunk) {
      const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;
      for (const s of this.sites) {
        const r = SITE_RADIUS[s.type] || 8;
        if (bx > s.x + r || bx + CHUNK - 1 < s.x - r ||
            bz > s.z + r || bz + CHUNK - 1 < s.z - r) continue;
        switch (s.type) {
          case 'origin': this.buildOrigin(chunk, s); break;
          case 'sword': this.buildSword(chunk, s); break;
          case 'cairn': this.buildCairn(chunk, s); break;
          case 'cabin': this.buildCabin(chunk, s); break;
          case 'lab': this.buildLab(chunk, s); break;
          case 'ship': this.buildShip(chunk, s); break;
          case 'bench': this.buildBench(chunk, s); break;
          case 'sky': this.buildSky(chunk, s); break;
          case 'tablet': this.buildTablet(chunk, s); break;
          case 'giant': this.buildGiant(chunk, s); break;
          case 'lighthouse': this.buildLighthouse(chunk, s); break;
          case 'arch': this.buildArch(chunk, s); break;
        }
      }
    }

    buildOrigin(chunk, s) {
      const { x, z } = s, y = s.y;
      this.clearBox(chunk, x - 5, y + 1, z - 5, x + 5, y + 5, z + 5);
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dz * dz > 20) continue;
        this.fillBelow(chunk, x + dx, y, z + dz);
        this.put(chunk, x + dx, y, z + dz, B.COBBLE);
      }
      this.put(chunk, x, y + 1, z, B.TABLET);
      this.setLore(x, y + 1, z, '原点的石头',
        '石头上没有落款。\n\n你试着读那些刻痕：\n“从这里算起，往哪走都算远方。”\n\n风把字磨得很浅，像有人只想写给停下脚步的人看。');
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        for (let dy = 1; dy <= 2; dy++) this.put(chunk, x + dx, y + dy, z + dz, B.COBBLE);
        this.put(chunk, x + dx, y + 3, z + dz, B.TORCH);
      }
    }

    buildSword(chunk, s) {
      const { x, z } = s, y = s.y;
      this.clearBox(chunk, x - 4, y, z - 4, x + 4, y + 6, z + 4);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dz * dz > 10) continue;
        this.fillBelow(chunk, x + dx, y, z + dz);
        this.put(chunk, x + dx, y, z + dz, dx * dx + dz * dz > 6 ? B.STONE : B.COBBLE);
      }
      this.put(chunk, x, y + 1, z, B.STONE_SWORD);
      this.setLore(x, y + 1, z, '石中剑',
        '一把剑斜插在岩石里，像长在那里。\n\n你握住剑柄，用力——\n\n（这里只有风。）\n\n剑纹丝不动。也许它认人，也许它只是喜欢这样。');
      for (const [dx, dz] of [[-2, 2], [2, -2]]) this.put(chunk, x + dx, y + 1, z + dz, B.TORCH);
    }

    buildCairn(chunk, s) {
      const { x, z } = s, y = s.y;
      this.clearBox(chunk, x - 2, y, z - 2, x + 2, y + 5, z + 2);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        this.fillBelow(chunk, x + dx, y, z + dz);
        this.put(chunk, x + dx, y, z + dz, B.COBBLE);
      }
      this.put(chunk, x, y + 1, z, B.TABLET);
      this.put(chunk, x + 1, y + 1, z, B.TORCH);
      this.setLore(x, y + 1, z, '山顶的记号',
        '一个小石堆，几块石头被摆成指向北方的箭头。\n\n风很大，但石堆没有散。\n\n不知道是谁堆的，也不知道北方有什么。');
    }

    buildCabin(chunk, s) {
      const { x, z } = s, y = s.y;
      this.clearTrees(chunk, x - 16, z - 15, x + 16, z + 15);
      this.clearBox(chunk, x - 7, y, z - 6, x + 7, y + 9, z + 6);
      for (let dz = -4; dz <= 4; dz++) for (let dx = -5; dx <= 5; dx++) {
        this.fillBelow(chunk, x + dx, y, z + dz);
        this.put(chunk, x + dx, y, z + dz, B.PLANKS);
        for (let dy = 1; dy <= 4; dy++) this.put(chunk, x + dx, y + dy, z + dz, 0);
      }
      for (let dz = -4; dz <= 4; dz++) for (let dx = -5; dx <= 5; dx++) {
        if (Math.abs(dx) !== 5 && Math.abs(dz) !== 4) continue;
        const corner = Math.abs(dx) === 5 && Math.abs(dz) === 4;
        const door = dz === 4 && dx >= -1 && dx <= 1;
        for (let dy = 1; dy <= 4; dy++) {
          let id = corner ? B.SPRUCE_LOG : B.PLANKS;
          if (!corner && dy === 3 && (Math.abs(dx) === 5 ? dz % 2 === 0 : dx % 2 === 0))
            id = B.GLASS;
          if (door && dy <= 2) id = 0;
          this.put(chunk, x + dx, y + dy, z + dz, id);
        }
      }
      // 阶梯式的红瓦坡屋顶，在雪地和森林里都能一眼认出来。
      for (let dz = -5; dz <= 5; dz++) for (let dx = -6; dx <= 6; dx++)
        this.put(chunk, x + dx, y + 5, z + dz, B.BRICK);
      for (let dz = -4; dz <= 4; dz++) for (let dx = -5; dx <= 5; dx++)
        this.put(chunk, x + dx, y + 6, z + dz, B.BRICK);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++)
        this.put(chunk, x + dx, y + 7, z + dz, B.BRICK);
      for (let dz = -2; dz <= 2; dz++) this.put(chunk, x, y + 8, z + dz, B.BRICK);
      for (let dy = 5; dy <= 7; dy++) {
        this.put(chunk, x + 4, y + dy, z - 3, B.COBBLE);
        this.put(chunk, x + 3, y + dy, z - 3, B.COBBLE);
      }
      this.put(chunk, x + 3, y + 8, z - 3, B.COBBLE);
      // 门前的小路，两格宽。
      for (let dz = 5; dz <= 10; dz++) for (let dx = -1; dx <= 1; dx++) {
        const ground = this.heightAt(x + dx, z + dz);
        this.put(chunk, x + dx, ground + 1, z + dz, B.COBBLE);
        for (let dy = 1; dy <= 3; dy++) this.put(chunk, x + dx, ground + 1 + dy, z + dz, 0);
      }
      this.put(chunk, x - 3, y + 1, z - 2, B.TABLE);
      this.put(chunk, x + 3, y + 1, z - 2, B.TORCH);
      this.put(chunk, x - 3, y + 1, z + 2, B.TABLET);
      this.setLore(x - 3, y + 1, z + 2, '给走到这里的你',
        '木屋里有一张桌子、一盏没吹灭的灯，和一本翻到一半的笔记。\n\n“如果你找到这里，说明你没有沿着路走。谢谢。\n这栋房子是我住过最久的地方，现在留给你。”\n\n窗外正对着日出。');
      // 墙上的像素肖像：不是任何人的脸，但像某个人。
      const wall = z - 4;
      for (let i = -2; i <= 2; i++) this.put(chunk, x + i, y + 4, wall + 1, B.TERRACOTTA);
      for (let i = -2; i <= 2; i++) this.put(chunk, x + i, y + 3, wall + 1, i === 0 ? B.ORANGE_TERRACOTTA : B.WHITE_TERRACOTTA);
      for (const i of [-1, 1]) this.put(chunk, x + i, y + 3, wall + 1, B.BRICK);
      for (let i = -1; i <= 1; i++) this.put(chunk, x + i, y + 2, wall + 1, i === 1 ? B.ORANGE_TERRACOTTA : B.WHITE_TERRACOTTA);
      this.put(chunk, x, y + 2, wall + 1, B.TERRACOTTA);
    }

    buildLab(chunk, s) {
      const { x, z } = s, y = s.y;
      this.clearTrees(chunk, x - 9, z - 8, x + 9, z + 9);
      this.clearBox(chunk, x - 5, y, z - 4, x + 5, y + 6, z + 5);
      for (let dz = -4; dz <= 4; dz++) for (let dx = -5; dx <= 5; dx++) {
        this.fillBelow(chunk, x + dx, y, z + dz);
        this.put(chunk, x + dx, y, z + dz, B.STONE);
      }
      for (let dz = -4; dz <= 4; dz++) for (let dx = -5; dx <= 5; dx++) {
        const edge = Math.abs(dx) === 5 || Math.abs(dz) === 4;
        if (!edge) continue;
        const door = dz === 4 && dx >= -1 && dx <= 1;
        for (let dy = 1; dy <= 4; dy++) {
          if (door && dy <= 2) { this.put(chunk, x + dx, y + dy, z + dz, 0); continue; }
          this.put(chunk, x + dx, y + dy, z + dz,
            dy === 4 || (Math.abs(dx) === 5 && Math.abs(dz) === 4) ? B.COBBLE : B.STONE);
        }
      }
      for (let dz = -4; dz <= 4; dz++) for (let dx = -5; dx <= 5; dx++)
        this.put(chunk, x + dx, y + 5, z + dz, B.STONE);
      this.put(chunk, x, y + 1, z, B.GLITCH);
      this.setLore(x, y + 1, z, 'missing texture',
        '一块粉黑相间的方块，格格不入。\n\n旁边有一张纸：\n“这不是 bug。\n这是我们在删掉一个世界时，唯一没删干净的地方。\n别挖它。”\n\n屏幕外传来很轻的电流声。');
      this.put(chunk, x - 3, y + 1, z - 2, B.TABLE);
      this.put(chunk, x + 3, y + 1, z - 2, B.TORCH);
      this.put(chunk, x + 2, y + 6, z + 2, B.TORCH);
    }

    buildShip(chunk, s) {
      const { x, z } = s, y = s.y;
      for (let dx = -6; dx <= 6; dx++) {
        const half = Math.abs(dx) >= 5 ? 1 : 2;
        for (let dz = -half; dz <= half; dz++) {
          this.put(chunk, x + dx, y, z + dz, B.PLANKS);
          for (let dy = 1; dy <= 3; dy++) {
            if (Math.abs(dz) === half || Math.abs(dx) >= 5)
              this.put(chunk, x + dx, y + dy, z + dz, B.PLANKS);
          }
          if (Math.abs(dx) <= 4 && Math.abs(dz) <= 1)
            this.put(chunk, x + dx, y + 3, z + dz, B.PLANKS);
        }
      }
      for (let dy = 4; dy <= 11; dy++) this.put(chunk, x, y + dy, z, B.SPRUCE_LOG);
      this.put(chunk, x, y + 12, z, B.BANNER);
      this.put(chunk, x - 2, y + 4, z, B.TABLET);
      this.setLore(x - 2, y + 4, z, '沉船日志',
        '最后一页没有写完。\n\n“……我们看见云上有一块岛。船长说是灯。\n如果有人读到这行字，别去找它——它不亮，它只是在等。”\n\n落款被海水泡烂了。');
    }

    buildBench(chunk, s) {
      const { x, z } = s, y = s.y;
      this.clearBox(chunk, x - 3, y, z - 3, x + 3, y + 4, z + 3);
      for (let dz = -1; dz <= 1; dz++) {
        this.fillBelow(chunk, x, y, z + dz);
        this.put(chunk, x, y + 1, z + dz, B.PLANKS);
        this.put(chunk, x + 1, y + 2, z + dz, B.PLANKS);
      }
      this.put(chunk, x, y, z - 1, B.SPRUCE_LOG);
      this.put(chunk, x, y, z + 1, B.SPRUCE_LOG);
      this.put(chunk, x - 2, y + 1, z, B.TABLET);
      this.setLore(x - 2, y + 1, z, '长椅上的话',
        '长椅正对西边。坐在这里，能看见太阳落进山后。\n\n靠背上刻着一行小字：\n“我在这里等过一个人。\n他没来。但日落很好看。”');
    }

    buildSky(chunk, s) {
      const { x, z } = s, y = s.y;
      this.clearBox(chunk, x - 8, y + 1, z - 8, x + 8, y + 10, z + 8);
      for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
        if (dx * dx + dz * dz > 42) continue;
        this.put(chunk, x + dx, y, z + dz, B.GRASS);
        this.put(chunk, x + dx, y - 1, z + dz, B.DIRT);
        this.put(chunk, x + dx, y - 2, z + dz, B.DIRT);
        this.put(chunk, x + dx, y - 3, z + dz, B.STONE);
        if (dx * dx + dz * dz <= 22) {
          this.put(chunk, x + dx, y - 4, z + dz, B.STONE);
          this.put(chunk, x + dx, y - 5, z + dz, B.STONE);
        }
        if (dx * dx + dz * dz <= 8) this.put(chunk, x + dx, y - 6, z + dz, B.STONE);
      }
      this.placeTree(chunk, x - 2, y, z, 'oak', this.seed);
      for (let dy = 1; dy <= 4; dy++) this.put(chunk, x + 4, y + dy, z, B.SPRUCE_LOG);
      this.put(chunk, x + 4, y + 5, z, B.BANNER);
      this.put(chunk, x - 3, y + 1, z, B.TABLET);
      this.setLore(x - 3, y + 1, z, '云上的旗',
        '旗子是新的，风把它拉得很直。\n\n一张压在石头下的纸条：\n“你居然真的上来了。\n这个世界没有终点，也没有任务。\n往哪走都行。”\n\n字迹很轻松，像在笑。');
    }

    buildTablet(chunk, s) {
      const { x, z } = s, y = s.y;
      this.clearBox(chunk, x - 2, y, z - 2, x + 2, y + 4, z + 2);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        this.fillBelow(chunk, x + dx, y, z + dz);
        this.put(chunk, x + dx, y, z + dz, s.biome === 'snow' ? B.SNOW : B.COBBLE);
      }
      this.put(chunk, x, y + 1, z, B.TABLET);
      this.put(chunk, x + 1, y + 1, z, B.TORCH);
      const text = TABLET_TEXTS[s.biome];
      if (text) this.setLore(x, y + 1, z, text[0], text[1]);
    }

    buildGiant(chunk, s) {
      const { x, z } = s, y = s.y;
      for (let dy = 1; dy <= 34; dy++) {
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if ((Math.abs(dx) === 2 && Math.abs(dz) === 2) && dy % 3 !== 0) continue;
          this.put(chunk, x + dx, y + dy, z + dz, B.LOG);
        }
      }
      for (let dy = 23; dy <= 39; dy++) {
        const t = (dy - 23) / 16;
        const rad = Math.round(10 - Math.abs(t - 0.55) * 13);
        const yy = y + dy;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dz * dz > rad * rad) continue;
          if (Math.abs(dx) + Math.abs(dz) < 2 && dy < 33) continue;
          this.put(chunk, x + dx, yy, z + dz, B.LEAVES, true);
        }
      }
      for (const [dx, dz] of [[-3, 0], [3, 0], [0, -3], [0, 3]])
        for (let dy = 1; dy <= 2; dy++) this.put(chunk, x + dx, y + dy, z + dz, B.COBBLE, true);
    }

    buildLighthouse(chunk, s) {
      const { x, z } = s, y = s.y;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        this.fillBelow(chunk, x + dx, y, z + dz);
        this.put(chunk, x + dx, y, z + dz, B.COBBLE);
      }
      for (let dy = 1; dy <= 24; dy++) {
        const band = Math.floor((dy - 1) / 4) % 2;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
          let id = band ? B.WHITE_TERRACOTTA : B.BRICK;
          if (dy % 8 === 4 && (Math.abs(dx) === 2 ? dz === 0 : dx === 0)) id = B.GLASS;
          this.put(chunk, x + dx, y + dy, z + dz, id);
        }
      }
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        if (Math.abs(dx) === 3 || Math.abs(dz) === 3)
          this.put(chunk, x + dx, y + 25, z + dz, B.COBBLE);
      }
      this.put(chunk, x, y + 25, z, B.COBBLE);
      // 灯笼房：玻璃围一圈，火把在里面。
      for (let dy = 26; dy <= 27; dy++) {
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) === 2 || Math.abs(dz) === 2)
            this.put(chunk, x + dx, y + dy, z + dz, B.GLASS);
        }
      }
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++)
        this.put(chunk, x + dx, y + 28, z + dz, B.WHITE_TERRACOTTA);
      this.put(chunk, x, y + 26, z, B.TORCH);
    }

    buildArch(chunk, s) {
      const { x, z } = s, y = s.y;
      for (const side of [-1, 1]) {
        for (let dx = 4; dx <= 5; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            for (let dy = 1; dy <= 26; dy++) {
              this.fillBelow(chunk, x + side * dx, y + dy, z + dz);
              this.put(chunk, x + side * dx, y + dy, z + dz,
                dy % 7 === 0 ? B.STONE : B.COBBLE);
            }
          }
        }
      }
      for (let dx = -5; dx <= 5; dx++) for (let dz = -2; dz <= 2; dz++) {
        for (let dy = 27; dy <= 28; dy++)
          this.put(chunk, x + dx, y + dy, z + dz, dy === 28 ? B.STONE : B.COBBLE);
      }
      for (let dx = -5; dx <= 5; dx++) this.put(chunk, x + dx, y + 29, z, B.MOSS, true);
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
      if (this.glacier) {
        const v = this.glacier;
        // 从冰川谷入口看向群峰；不要把玩家放在旧湖边。
        const x = Math.round(v.x - v.rx * 0.58), z = Math.round(v.z - v.rz * 0.63);
        const dx = v.x + 20 - x, dz = v.z + 130 - z;
        return { x: x + 0.5, y: this.heightAt(x, z) + 1.2, z: z + 0.5,
          yaw: Math.atan2(-dx, -dz), pitch: -0.09 };
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

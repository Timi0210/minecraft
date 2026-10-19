/* minimap.js — 手绘地图：只有走过的地方才会显影。 */
(function () {
  'use strict';
  const MC = window.MC;
  const RES = 96;
  const SIZE = 192;
  const STEP = 14; // 每个源像素对应的方块数，整张图约 1344 格
  const REVEAL = 88; // 记忆半径（格）
  const COLORS = {
    ocean: [48, 102, 163], frozen_ocean: [147, 195, 216],
    beach: [218, 200, 144], desert: [220, 186, 119],
    plains: [104, 158, 82], forest: [56, 120, 78], taiga: [56, 111, 100],
    snow: [218, 232, 231], mountain: [128, 133, 130],
    cherry: [205, 146, 172], badlands: [170, 99, 72],
    crimson: [153, 54, 69], warped: [48, 141, 136], basalt: [82, 76, 84], souls: [122, 107, 103]
  };

  class Minimap {
    constructor(world, container, canvas, state) {
      this.world = world;
      this.container = container;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.canvas.width = this.canvas.height = SIZE;
      this.base = document.createElement('canvas');
      this.base.width = this.base.height = RES;
      this.baseCtx = this.base.getContext('2d');
      this.preview = document.createElement('canvas');
      this.preview.width = this.preview.height = 16;
      this.previewCtx = this.preview.getContext('2d');
      this.previewReady = false;
      this.explored = state.explored || (state.explored = []);
      this.lastPoint = this.explored.length ? this.explored[this.explored.length - 1] : null;
      this.fog = document.createElement('canvas');
      this.fog.width = this.fog.height = SIZE;
      this.fogCtx = this.fog.getContext('2d');
      this.fogDirty = true;
      // 一开始，纸上只有墨。
      this.fogCtx.fillStyle = 'rgba(9, 19, 21, .93)';
      this.fogCtx.fillRect(0, 0, SIZE, SIZE);
      this.heights = new Int16Array(RES * RES);
      this.image = null;
      this.centerX = this.centerZ = 0;
      this.buildX = this.buildZ = 0;
      this.nextRow = 0;
      this.building = false;
      this.ready = false;
      this.visible = true;
      this.drawWait = 0;
      this.fogAt = 0;
    }

    toggle() {
      this.visible = !this.visible;
      this.container.classList.toggle('hide', !this.visible);
      this.drawWait = 0;
      return this.visible;
    }

    startBuild(player) {
      this.buildX = Math.round(player.pos[0] / 64) * 64;
      this.buildZ = Math.round(player.pos[2] / 64) * 64;
      this.image = this.baseCtx.createImageData(RES, RES);
      this.nextRow = 0;
      this.building = true;
      this.centerX = this.buildX;
      this.centerZ = this.buildZ;
      // 先画 16×16 地形占位，完整地图仍分帧生成。
      const preview = this.previewCtx.createImageData(16, 16);
      for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
        const x = this.buildX + (px - 7.5) * RES * STEP / 16;
        const z = this.buildZ + (py - 7.5) * RES * STEP / 16;
        const field = this.world.biomeField(x, z);
        const h = this.world.heightAt(x, z, field);
        const biome = this.world.biomeAt(x, z, h, field);
        const color = h >= 82 && !(this.world.isNether && this.world.isNether(x, z)) ? COLORS.snow : (COLORS[biome] || COLORS.plains);
        const i = (py * 16 + px) * 4;
        preview.data[i] = color[0]; preview.data[i + 1] = color[1];
        preview.data[i + 2] = color[2]; preview.data[i + 3] = 255;
      }
      this.previewCtx.putImageData(preview, 0, 0);
      this.previewReady = true;
      this.fogDirty = true;
    }

    buildRows(count) {
      const data = this.image.data;
      const stop = Math.min(RES, this.nextRow + count);
      for (let py = this.nextRow; py < stop; py++) {
        const z = this.buildZ + (py - RES / 2 + 0.5) * STEP;
        for (let px = 0; px < RES; px++) {
          const x = this.buildX + (px - RES / 2 + 0.5) * STEP;
          const field = this.world.biomeField(x, z);
          const h = this.world.heightAt(x, z, field);
          const biome = this.world.biomeAt(x, z, h, field);
          const i = py * RES + px, p = i * 4;
          this.heights[i] = h;
          const left = px ? this.heights[i - 1] : h;
          const up = py ? this.heights[i - RES] : h;
          const shade = Math.max(0.67, Math.min(1.23,
            0.93 + (h - MC.WORLD.SEA) * 0.002 + (h - left + h - up) * 0.026));
          const color = h >= 82 && !(this.world.isNether && this.world.isNether(x, z)) ? COLORS.snow : (COLORS[biome] || COLORS.plains);
          data[p] = Math.min(255, color[0] * shade);
          data[p + 1] = Math.min(255, color[1] * shade);
          data[p + 2] = Math.min(255, color[2] * shade);
          data[p + 3] = 255;
        }
      }
      this.nextRow = stop;
      if (stop === RES) {
        this.baseCtx.putImageData(this.image, 0, 0);
        this.centerX = this.buildX;
        this.centerZ = this.buildZ;
        this.ready = true;
        this.building = false;
        this.image = null;
        this.drawWait = 0;
        this.buildFog();
      }
    }

    project(x, z) {
      return [SIZE / 2 + (x - this.centerX) * SIZE / (RES * STEP),
        SIZE / 2 + (z - this.centerZ) * SIZE / (RES * STEP)];
    }

    remember(player) {
      const x = Math.round(player.pos[0]), z = Math.round(player.pos[2]);
      if (this.lastPoint &&
          Math.hypot(x - this.lastPoint[0], z - this.lastPoint[1]) < 20) return;
      this.lastPoint = [x, z];
      this.explored.push([x, z]);
      if (this.explored.length > 640) this.explored.splice(0, this.explored.length - 640);
      this.fogDirty = true;
    }

    buildFog() {
      const ctx = this.fogCtx;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, SIZE, SIZE);
      // 底噪：没去过的地方是纸上的墨。
      ctx.fillStyle = 'rgba(9, 19, 21, .93)';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.globalCompositeOperation = 'destination-out';
      const radius = Math.max(9, REVEAL * SIZE / (RES * STEP));
      for (const p of this.explored) {
        if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        const pos = this.project(p[0], p[1]);
        if (pos[0] < -radius || pos[1] < -radius ||
            pos[0] > SIZE + radius || pos[1] > SIZE + radius) continue;
        const g = ctx.createRadialGradient(pos[0], pos[1], radius * 0.18,
          pos[0], pos[1], radius);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.62, 'rgba(0,0,0,.92)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pos[0], pos[1], radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      this.fogDirty = false;
    }

    draw(player) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = '#143044';
      ctx.fillRect(0, 0, SIZE, SIZE);
      if (this.ready || this.previewReady) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.building ? this.preview : this.base, 0, 0, SIZE, SIZE);
      } else {
        ctx.fillStyle = '#cfeaf1';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('正在描地图…', SIZE / 2, SIZE / 2);
      }
      ctx.drawImage(this.fog, 0, 0);

      // 只有玩家的方向，没有目标。
      const pos = this.project(player.pos[0], player.pos[2]);
      ctx.save();
      ctx.translate(pos[0], pos[1]);
      ctx.rotate(-player.yaw);
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(6, 7);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fillStyle = '#68f0f5';
      ctx.strokeStyle = '#10354b';
      ctx.lineWidth = 2.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // 四个方向，不指任何地方。
      ctx.fillStyle = 'rgba(240, 247, 228, .72)';
      ctx.font = '700 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('北', SIZE / 2, 8);
      ctx.fillText('南', SIZE / 2, SIZE - 8);
      ctx.fillText('西', 8, SIZE / 2);
      ctx.fillText('东', SIZE - 8, SIZE / 2);

      ctx.strokeStyle = 'rgba(230, 251, 255, .65)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);
    }

    update(player, dt) {
      this.remember(player);
      if (!this.visible) return;
      const now = performance.now();
      if (this.fogDirty && now - this.fogAt > 500) {
        this.buildFog();
        this.fogAt = now;
      }
      const moved = !this.ready ||
        Math.abs(player.pos[0] - this.centerX) > 192 ||
        Math.abs(player.pos[2] - this.centerZ) > 192;
      if (!this.building && moved) this.startBuild(player);
      if (this.building) this.buildRows(6);
      this.drawWait -= dt;
      if (this.drawWait <= 0) {
        this.draw(player);
        this.drawWait = 0.1;
      }
    }
  }

  MC.Minimap = Minimap;
})();

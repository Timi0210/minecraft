/* minimap.js — low-cost procedural overview and snow mountain waypoints */
(function () {
  'use strict';
  const MC = window.MC;
  const RES = 96;
  const SIZE = 192;
  const STEP = 14; // blocks per source pixel; the visible map spans 1344 blocks
  const COLORS = {
    ocean: [48, 102, 163], frozen_ocean: [147, 195, 216],
    beach: [218, 200, 144], desert: [220, 186, 119],
    plains: [104, 158, 82], forest: [56, 120, 78], taiga: [56, 111, 100],
    snow: [218, 232, 231], mountain: [128, 133, 130],
    cherry: [205, 146, 172], badlands: [170, 99, 72]
  };
  const DIRECTIONS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

  class Minimap {
    constructor(world, container, canvas, nearestEl) {
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
      this.nearestEl = nearestEl;
      this.heights = new Int16Array(RES * RES);
      this.image = null;
      this.centerX = this.centerZ = 0;
      this.buildX = this.buildZ = 0;
      this.nextRow = 0;
      this.building = false;
      this.ready = false;
      this.visible = true;
      this.drawWait = 0;
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
        const color = h >= 82 ? COLORS.snow : (COLORS[biome] || COLORS.plains);
        const i = (py * 16 + px) * 4;
        preview.data[i] = color[0]; preview.data[i + 1] = color[1];
        preview.data[i + 2] = color[2]; preview.data[i + 3] = 255;
      }
      this.previewCtx.putImageData(preview, 0, 0);
      this.previewReady = true;
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
          const color = h >= 82 ? COLORS.snow : (COLORS[biome] || COLORS.plains);
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
      }
    }

    project(x, z) {
      return [SIZE / 2 + (x - this.centerX) * SIZE / (RES * STEP),
        SIZE / 2 + (z - this.centerZ) * SIZE / (RES * STEP)];
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
        ctx.fillText('正在绘制地图…', SIZE / 2, SIZE / 2);
      }

      if ((this.ready || this.previewReady) && this.world.trails) {
        ctx.save();
        ctx.strokeStyle = 'rgba(248, 225, 155, .92)';
        ctx.lineWidth = 1.5;
        for (const trail of this.world.trails) {
          ctx.beginPath();
          for (let j = 0; j < trail.length; j += 4) {
            const p = this.project(trail[j].x, trail[j].z);
            if (j === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
          }
          ctx.stroke();
          const start = this.project(trail[0].x, trail[0].z);
          ctx.fillStyle = '#ffd36a';
          ctx.fillRect(start[0] - 2, start[1] - 2, 4, 4);
        }
        ctx.restore();
      }

      let nearest = 0, nearestDist = Infinity;
      for (let i = 0; i < this.world.peaks.length; i++) {
        const peak = this.world.peaks[i];
        const dx = peak[0] - player.pos[0], dz = peak[1] - player.pos[2];
        const dist = Math.hypot(dx, dz);
        if (dist < nearestDist) { nearest = i; nearestDist = dist; }
        if (!this.ready && !this.previewReady) continue;
        const pos = this.project(peak[0], peak[1]);
        const mx = Math.max(10, Math.min(SIZE - 10, pos[0]));
        const my = Math.max(10, Math.min(SIZE - 10, pos[1]));
        ctx.beginPath();
        ctx.arc(mx, my, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#f6fdff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = i === nearest ? '#f9d66b' : '#5d8499';
        ctx.stroke();
        ctx.fillStyle = '#17435d';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), mx, my + 0.5);
      }

      if (this.ready || this.previewReady) {
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
      }
      ctx.strokeStyle = 'rgba(230, 251, 255, .65)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);

      const peak = this.world.peaks[nearest];
      const dx = peak[0] - player.pos[0], dz = peak[1] - player.pos[2];
      const angle = Math.atan2(dx, -dz);
      const dir = DIRECTIONS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
      this.nearestEl.textContent = '最近雪山 ' + (nearest + 1) + ' · ' + dir + ' ' + Math.round(nearestDist) + ' 格';
    }

    update(player, dt) {
      if (!this.visible) return;
      if (!this.building && (!this.ready ||
          Math.abs(player.pos[0] - this.centerX) > 192 ||
          Math.abs(player.pos[2] - this.centerZ) > 192)) this.startBuild(player);
      if (this.building) this.buildRows(6);
      this.drawWait -= dt;
      if (this.drawWait <= 0) {
        this.draw(player);
        this.drawWait = 0.08;
      }
    }
  }

  MC.Minimap = Minimap;
})();

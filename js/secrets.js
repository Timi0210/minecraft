/* secrets.js — 不进入任何列表的彩蛋：时间、地点、动作与运气。 */
(function () {
  'use strict';
  const MC = window.MC;
  const DAY = MC.DAY_LENGTH;

  const EGG_NAMES = {
    origin: '原点',
    cabin: '开发者小屋',
    sword: '石中剑',
    figure: '凌晨三点的远影',
    moon: '月圆白羊',
    missing: '丢失的贴图',
    ship: '沉船',
    tablets: '九座石碑',
    aurora: '极光',
    meteor: '流星雨',
    konami: '旧时代的秘密',
    sky: '云上的旗',
    bench: '长椅',
    cave: '洞穴里的脚步声'
  };

  const SITE_EGG = {
    origin: 'origin', cabin: 'cabin', sword: 'sword', lab: 'missing',
    ship: 'ship', sky: 'sky', bench: 'bench', cairn: 'tablets'
  };

  class Secrets {
    constructor(ctx) {
      this.world = ctx.world;
      this.player = ctx.player;
      this.state = ctx.state;
      this.seen = ctx.state.seen;
      this.sfx = ctx.sfx;
      this.particles = ctx.particles;
      this.mobs = ctx.mobManager;
      this.hooks = ctx.hooks;
      this.debug = !!ctx.debug;
      this.scenicOnly = !!ctx.scenicOnly;

      this.acc = 0;
      this.figure = null;
      this.figureNight = -1;
      this.figureLook = 0;
      this.figureAge = 0;
      this.moonSheep = null;
      this.auroraNight = -1;
      this.meteorNight = -1;
      this.ambientAt = 6 + Math.random() * 10;
      this.caveAt = 12 + Math.random() * 20;
      this.lastMoon = -1;
      this.flags = ctx.state.flags || (ctx.state.flags = {});
    }

    /* ---------- 时间 ---------- */
    dayIndex() { return Math.floor(this.state.time / DAY); }
    clock() { return (12 + this.state.time / DAY * 24) % 24; }
    isNight() { const h = this.clock(); return h >= 19 || h < 5; }
    isFigureWindow() { const h = this.clock(); return h >= 0 && h < 3.5; }
    isDawn() { const h = this.clock(); return h >= 4.5 && h < 6.5; }
    fullMoon() { return this.dayIndex() % 8 === 0; }

    markSeen(id) {
      if (!id || this.seen[id]) return false;
      this.seen[id] = true;
      if (this.hooks.save) this.hooks.save();
      return true;
    }

    /* ---------- 站点查找 ---------- */
    siteNear(x, y, z, radius) {
      const r = radius || 5;
      for (const s of this.world.sites) {
        if (Math.hypot(s.x - x, s.z - z) <= r && Math.abs(s.y - y) <= 7) return s;
      }
      return null;
    }

    swordStone(x, y, z) {
      const site = this.siteNear(x, y, z, 3);
      if (!site || site.type !== 'sword') return null;
      this.markSeen('sword');
      const hash = MC.Noise.hash2(this.world.seed, 1234, 5678);
      const canPull = hash > 0.87 && !this.flags.swordPulled;
      if (canPull) {
        const added = this.hooks.addItem(MC.ITEM_KEY.broken_steel, 1);
        if (added) {
          this.flags.swordPulled = true;
          if (this.hooks.save) this.hooks.save();
          this.hooks.toast('剑身松动了。你拔出了「断钢」');
          return {
            title: '石中剑',
            text: '剑身松动了。\n\n你把它从岩石里拔出来，发现断口很旧，像被谁折断过。\n\n剑很轻，像一段被忘掉的故事。'
          };
        }
      }
      return {
        title: '石中剑',
        text: '一把剑斜插在岩石里，像长在那里。\n\n你握住剑柄，用力——\n\n（这里只有风。）\n\n剑纹丝不动。也许它认人，也许它只是喜欢这样。'
      };
    }

    readLore(x, y, z) {
      const lore = this.world.loreAt(x, y, z);
      if (!lore) return null;
      const site = this.siteNear(x, y, z, 5);
      if (site) {
        if (site.type === 'tablet') this.markSeen('tablet:' + site.biome);
        else if (site.type === 'lab') this.markSeen('missing');
        else if (SITE_EGG[site.type]) this.markSeen(SITE_EGG[site.type]);
      }
      return lore;
    }

    /* ---------- 每帧 ---------- */
    update(dt) {
      if (this.figure) {
        this.figureAge += dt;
        this.updateFigure(dt);
      }
      if (this.moonSheep && !this.moonSheep.dead) this.moonGlow(dt);
      this.acc += dt;
      if (this.acc < 1) return;
      const step = this.acc;
      this.acc = 0;
      this.ambient(step);
      if (!this.scenicOnly) this.checkFigure();
      this.checkMoonSheep();
      this.checkSky();
      if (!this.scenicOnly) this.checkCave(step);
    }

    collect(out) {
      if (!this.figure) return;
      const f = this.figure, M = MC.MobMat;
      const tiles = { top: f.tile, side: f.tile, bottom: f.tile };
      const root = M.mul(M.trs(f.x, f.y, f.z), M.ry(f.yaw));
      const add = (dx, dy, dz, sx, sy, sz) => {
        out.push({ m: M.mul(root, M.mul(M.trs(dx, dy, dz), M.scl(sx, sy, sz))),
          tiles, flash: 0 });
      };
      add(0, 1.36, 0, 0.42, 1.05, 0.32);
      add(0, 2.06, 0, 0.34, 0.36, 0.34);
      add(-0.36, 1.44, 0, 0.15, 0.95, 0.2);
      add(0.36, 1.44, 0, 0.15, 0.95, 0.2);
      add(-0.15, 0.4, 0, 0.16, 0.82, 0.2);
      add(0.15, 0.4, 0, 0.16, 0.82, 0.2);
    }

    updateFigure(dt) {
      if (!this.isNight() || !this.isFigureWindow()) { this.vanishFigure(); return; }
      const f = this.figure, p = this.player;
      const eye = p.eye();
      const dx = f.x - eye[0], dy = f.y + 1.6 - eye[1], dz = f.z - eye[2];
      const dist = Math.hypot(dx, dz);
      f.yaw = Math.atan2(dx, dz) + Math.PI;
      const len = Math.hypot(dx, dy, dz) || 1;
      const cp = Math.cos(p.pitch);
      const lx = -Math.sin(p.yaw) * cp, ly = Math.sin(p.pitch), lz = -Math.cos(p.yaw) * cp;
      const dot = (dx * lx + dy * ly + dz * lz) / len;
      if (dot > 0.985) this.figureLook += dt;
      else this.figureLook = Math.max(0, this.figureLook - dt * 1.5);
      if (this.figureLook > 2.2 || dist < 7 || this.figureAge > 120) this.vanishFigure();
    }

    checkFigure(force) {
      if (this.figure) return false;
      if (!force && (!this.isNight() || !this.isFigureWindow())) return false;
      const night = this.dayIndex();
      if (!force) {
        if (night === this.figureNight) return false;
        this.figureNight = night;
        // 大部分夜晚什么也不会发生。
        if (MC.Noise.hash2(this.world.seed, night, 7717) > 0.22) return false;
      }
      const p = this.player;
      const h = this.world.heightAt(Math.floor(p.pos[0]), Math.floor(p.pos[2]));
      if (p.pos[1] < h - 4) return false; // 地下看不到
      const dist = 26 + MC.Noise.hash2(night, 3, 93) * 10;
      for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35]) {
        const dx = -Math.sin(p.yaw + off), dz = -Math.cos(p.yaw + off);
        const x = Math.floor(p.pos[0] + dx * dist);
        const z = Math.floor(p.pos[2] + dz * dist);
        if (Math.hypot(x - p.pos[0], z - p.pos[2]) < 18) continue;
        const chunk = this.world.getChunk(x >> 4, z >> 4);
        if (!chunk || !chunk.generated) continue;
        const ground = this.world.heightAt(x, z);
        if (ground <= MC.WORLD.SEA + 1) continue;
        if (this.world.getBlock(x, ground + 2, z) !== 0) continue;
        this.figure = { x: x + 0.5, y: ground + 1, z: z + 0.5, yaw: 0,
          tile: MC.Atlas.index.shade };
        this.figureLook = 0;
        this.figureAge = 0;
        this.sfx.tone(48, 2.8, 0.035, 'sine', 0.94);
        this.sfx.noise(220, 1.6, 1.2, 0.008, 0.32);
        return true;
      }
      return false;
    }

    vanishFigure() {
      this.figure = null;
      this.figureLook = 0;
      this.sfx.tone(64, 1.2, 0.05, 'sine', 0.7);
      this.sfx.noise(160, 0.6, 0.8, 0.03, 0.4);
    }

    moonGlow(dt) {
      this.glowAcc = (this.glowAcc || 0) + dt;
      if (this.glowAcc < 0.1) return;
      this.glowAcc = 0;
      const m = this.moonSheep;
      if (!m || !this.particles.enabled) return;
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.3 + Math.random() * 0.5;
        this.particles.emit(m.pos[0] + Math.cos(a) * r,
          m.pos[1] + 0.3 + Math.random() * 1.0,
          m.pos[2] + Math.sin(a) * r,
          Math.cos(a) * 0.04, 0.12 + Math.random() * 0.12, Math.sin(a) * 0.04,
          0.07 + Math.random() * 0.03, 1.1 + Math.random() * 0.6,
          MC.Atlas.index.wool, 0.86, 0.94, 1, 0.12);
      }
    }

    checkMoonSheep() {
      if (this.moonSheep) {
        if (!this.isNight() || this.moonSheep.dead ||
            this.mobs.mobs.indexOf(this.moonSheep) < 0) {
          this.removeMoonSheep();
        } else if (this.particles.enabled) {
          const m = this.moonSheep;
          if (Math.random() < 0.5) {
            this.particles.emit(m.pos[0] + (Math.random() - 0.5) * 0.8,
              m.pos[1] + 0.6 + Math.random() * 0.9,
              m.pos[2] + (Math.random() - 0.5) * 0.8,
              0, 0.18, 0, 0.05, 0.9, MC.Atlas.index.wool, 0.85, 0.95, 1);
          }
        }
        return;
      }
      if (!this.isNight() || !this.fullMoon()) return;
      const day = this.dayIndex();
      if (this.lastMoon === day) return;
      this.lastMoon = day;
      const p = this.player;
      for (let i = 0; i < 8; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 12 + Math.random() * 10;
        const x = Math.floor(p.pos[0] + Math.cos(ang) * dist);
        const z = Math.floor(p.pos[2] + Math.sin(ang) * dist);
        const h = this.world.heightAt(x, z);
        if (h <= MC.WORLD.SEA + 2) continue;
        if (this.world.getBlock(x, h + 1, z) !== 0 || this.world.getBlock(x, h + 2, z) !== 0) continue;
        const mob = new MC.Mob('sheep', x + 0.5, h + 1, z + 0.5);
        mob.moonlit = true;
        this.mobs.mobs.push(mob);
        this.moonSheep = mob;
        this.markSeen('moon');
        this.sfx.tone(880, 0.6, 0.03, 'sine', 1.4);
        return;
      }
    }

    removeMoonSheep() {
      if (!this.moonSheep) return;
      const i = this.mobs.mobs.indexOf(this.moonSheep);
      if (i >= 0) this.mobs.mobs.splice(i, 1);
      this.moonSheep = null;
    }

    checkSky() {
      const night = this.dayIndex();
      const p = this.player;
      const biome = this.world.biomeAtPlayer(p.pos[0], p.pos[1], p.pos[2]);
      if (this.isNight() && this.auroraNight !== night &&
          (biome === 'snow' || biome === 'mountain' || biome === 'frozen_ocean') &&
          MC.Noise.hash2(this.world.seed, night, 3371) < 0.03) {
        this.auroraNight = night;
        if (this.hooks.aurora) this.hooks.aurora(true);
        this.state.auroraUntil = this.state.time + 80;
      }
      if (this.state.auroraUntil && this.state.time > this.state.auroraUntil) {
        this.state.auroraUntil = 0;
        if (this.hooks.aurora) this.hooks.aurora(false);
      }
      if (this.isNight() && this.meteorNight !== night &&
          MC.Noise.hash2(this.world.seed, night, 5521) < 0.012) {
        this.meteorNight = night;
        if (this.hooks.meteor) this.hooks.meteor(true);
        this.state.meteorUntil = this.state.time + 24;
      }
      if (this.state.meteorUntil && this.state.time > this.state.meteorUntil) {
        this.state.meteorUntil = 0;
        if (this.hooks.meteor) this.hooks.meteor(false);
      }
    }

    checkCave(step) {
      const p = this.player;
      const h = this.world.heightAt(Math.floor(p.pos[0]), Math.floor(p.pos[2]));
      if (p.pos[1] > h - 5 || p.pos[1] > 34) return;
      this.caveAt -= step;
      if (this.caveAt > 0) return;
      this.caveAt = 22 + Math.random() * 36;
      this.markSeen('cave');
      this.sfx.noise(900 + Math.random() * 500, 0.08, 2.5, 0.025, 0.5);
      if (Math.random() < 0.55) this.sfx.tone(260 + Math.random() * 120, 0.09, 0.02, 'sine', 0.6);
      if (Math.random() < 0.3) {
        // 脚步声：很近，但周围没有人。
        this.sfx.noise(300, 0.12, 1.2, 0.03, 0.7);
        this.sfx.tone(90, 0.12, 0.02, 'sine', 0.8);
      }
    }

    ambient(step) {
      this.ambientAt -= step;
      if (this.ambientAt > 0) return;
      this.ambientAt = 7 + Math.random() * 12;
      const p = this.player;
      const biome = this.world.biomeAtPlayer(p.pos[0], p.pos[1], p.pos[2]);
      const h = this.world.heightAt(Math.floor(p.pos[0]), Math.floor(p.pos[2]));
      if (p.pos[1] < h - 5) return;
      const hClock = this.clock();
      if (hClock >= 5.5 && hClock < 18) {
        // 鸟：两三声短促的高音。
        for (let i = 0; i < 2 + ((Math.random() * 2) | 0); i++) {
          setTimeout(() => this.sfx.tone(1250 + Math.random() * 900, 0.07,
            0.012 + Math.random() * 0.012, 'sine', 0.8), i * 120);
        }
      } else {
        // 虫鸣：更低、更密。
        for (let i = 0; i < 3; i++) {
          setTimeout(() => this.sfx.noise(2600, 0.05, 8, 0.008, 1), i * 95);
        }
      }
      if (biome === 'ocean' || biome === 'frozen_ocean' ||
          h <= MC.WORLD.SEA + 2) {
        this.sfx.noise(520, 0.7, 0.8, 0.012, 0.6);
      } else if (biome === 'snow' || biome === 'mountain') {
        this.sfx.noise(700, 0.8, 0.5, 0.008, 0.4);
      }
    }

    konami() {
      if (this.seen.konami) return false;
      this.markSeen('konami');
      if (this.hooks.flash) this.hooks.flash();
      this.sfx.tone(55, 1.8, 0.09, 'sawtooth', 0.6);
      this.sfx.noise(220, 1.2, 0.7, 0.06, 0.4);
      this.hooks.toast('你找到了旧时代的秘密。');
      return true;
    }

    /* ---------- 调试与验收 ---------- */
    ensureSite(site) {
      if (!site) return;
      const cx = site.x >> 4, cz = site.z >> 4;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) this.world.ensureChunk(cx + dx, cz + dz);
    }

    loreNearSite(site) {
      let best = null;
      for (const [key] of this.world.lore) {
        const p = key.split(',').map(Number);
        if (Math.abs(p[0] - site.x) <= 8 && Math.abs(p[2] - site.z) <= 8 &&
            Math.abs(p[1] - site.y) <= 8) { best = p; break; }
      }
      return best ? this.readLore(best[0], best[1], best[2]) : null;
    }

    trigger(id) {
      if (id === 'figure') {
        this.figureNight = -1;
        this.state.time = DAY * 0.56;
        this.checkFigure(true);
        return !!this.figure;
      }
      if (id === 'moon') {
        this.lastMoon = -1;
        this.state.time = DAY * 0.52;
        this.checkMoonSheep();
        return !!this.moonSheep;
      }
      if (id === 'aurora') {
        this.auroraNight = -1;
        this.state.time = DAY * 0.55;
        this.state.auroraUntil = this.state.time + 80;
        if (this.hooks.aurora) this.hooks.aurora(true);
        return true;
      }
      if (id === 'meteor') {
        this.meteorNight = -1;
        this.state.time = DAY * 0.55;
        this.state.meteorUntil = this.state.time + 24;
        if (this.hooks.meteor) this.hooks.meteor(true);
        return true;
      }
      if (id === 'konami') return this.konami();
      if (id === 'cave') {
        this.markSeen('cave');
        this.sfx.noise(980, 0.09, 2.4, 0.025, 0.5);
        this.sfx.noise(300, 0.12, 1.2, 0.03, 0.7);
        return { title: '洞穴里的脚步声',
          text: '很轻的一声，像有人在你身后停下。\n\n你回头。只有滴水。' };
      }
      if (id === 'sword') {
        const s = this.world.sites.find(s => s.type === 'sword');
        if (!s) return null;
        this.ensureSite(s);
        return this.swordStone(s.x, s.y + 1, s.z);
      }
      if (id === 'missing') {
        const s = this.world.sites.find(s => s.type === 'lab');
        if (!s) return null;
        this.ensureSite(s);
        return this.readLore(s.x, s.y + 1, s.z);
      }
      if (id === 'origin') {
        const s = this.world.sites.find(s => s.type === 'origin');
        if (!s) return null;
        this.ensureSite(s);
        return this.readLore(s.x, s.y + 1, s.z);
      }
      const s = this.world.sites.find(s => s.type === id ||
        (id === 'tablets' && s.type === 'tablet'));
      if (!s) return null;
      this.ensureSite(s);
      return this.loreNearSite(s);
    }

    list() {
      return Object.keys(EGG_NAMES).map(id => ({
        id, name: EGG_NAMES[id], seen: !!this.seen[id] ||
          (id === 'tablets' && Object.keys(this.seen).some(k => k.startsWith('tablet:')))
      }));
    }

    seenTablets() {
      return Object.keys(this.seen).filter(k => k.startsWith('tablet:')).length;
    }
  }

  MC.Secrets = Secrets;
})();

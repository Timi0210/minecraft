/* secrets.js — 六个不进入任何列表的彩蛋：地点、时间、动作与运气。 */
(function () {
  'use strict';
  const MC = window.MC;
  const DAY = MC.DAY_LENGTH;

  const EGGS = {
    easel: '无人认领的画架',
    well: '会回答的井',
    shoes: '海边的一双鞋',
    key: '石堆里的钥匙',
    shutter: '夜里的摄影师',
    fireflies: '萤火引路'
  };

  // 世界里有实体、可以按 R 互动的四个彩蛋。
  const SITE_REACH = { easel: 6, well: 6, shoes: 5, key: 5 };

  class Secrets {
    constructor(ctx) {
      this.world = ctx.world;
      this.player = ctx.player;
      this.state = ctx.state;
      this.seen = ctx.state.seen;
      this.sfx = ctx.sfx;
      this.particles = ctx.particles;
      this.hooks = ctx.hooks;
      this.debug = !!ctx.debug;

      this.acc = 0;
      this.ambientAt = 6 + Math.random() * 10;
      this.shutter = null;
      this.shutterNight = -1;
      this.fireflies = null;
      this.fireflyNight = -1;
      this.flags = ctx.state.flags || (ctx.state.flags = {});
    }

    /* ---------- 时间 ---------- */
    dayIndex() { return Math.floor(this.state.time / DAY); }
    clock() { return (12 + this.state.time / DAY * 24) % 24; }
    isNight() { const h = this.clock(); return h >= 19 || h < 5; }
    isSmallHours() { return this.clock() < 4.2; }

    clockText() {
      const h = this.clock();
      const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    }

    markSeen(id) {
      if (!id || this.seen[id]) return false;
      this.seen[id] = true;
      if (this.hooks.save) this.hooks.save();
      return true;
    }

    /* ---------- 地点 ---------- */
    siteOf(type) {
      for (const s of this.world.sites) if (s.type === type) return s;
      return null;
    }

    nearby() {
      const p = this.player.pos;
      for (const id of ['easel', 'well', 'shoes', 'key']) {
        const s = this.siteOf(id);
        if (!s) continue;
        if (Math.hypot(s.x - p[0], s.z - p[2]) > SITE_REACH[id]) continue;
        if (Math.abs(s.y - p[1]) > 7) continue;
        if (id === 'easel') return { id, title: '看一眼画架', hint: '画布上有什么' };
        if (id === 'well') return { id, title: '朝井里喊一声', hint: '听听井底' };
        if (id === 'shoes') return { id, title: '看看那双鞋', hint: '谁留在这里的' };
        const found = (this.flags.keyStage || 0) >= 3;
        return {
          id,
          title: found ? '看看石堆' : '搬开石头',
          hint: found ? '你已经把它放回去了' : '最上面那块像是能挪动'
        };
      }
      return null;
    }

    ensureSite(site) {
      if (!site) return;
      const cx = site.x >> 4, cz = site.z >> 4;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) this.world.ensureChunk(cx + dx, cz + dz);
    }

    use(id) {
      const s = this.siteOf(id);
      if (!s) return null;
      if (id === 'easel') return this.useEasel(s);
      if (id === 'well') return this.useWell(s);
      if (id === 'shoes') return this.useShoes(s);
      if (id === 'key') return this.useKey(s);
      return null;
    }

    /* ---------- 彩蛋：画架 ---------- */
    easelLit(site) {
      for (let dy = -1; dy <= 3; dy++)
        for (let dz = -4; dz <= 4; dz++)
          for (let dx = -4; dx <= 4; dx++) {
            const id = this.world.getBlock(site.x + dx, site.y + dy, site.z + dz);
            if (id === MC.Block.TORCH || id === MC.Block.GLOWSTONE) return true;
          }
      return false;
    }

    useEasel(site) {
      const first = this.markSeen('easel');
      const lit = this.easelLit(site);
      if (lit) {
        const newLamp = !this.flags.easelLamp;
        this.flags.easelLamp = true;
        if (newLamp) {
          if (this.hooks.save) this.hooks.save();
          this.sfx.tone(760, 0.5, 0.028, 'sine', 1.3);
          this.sfx.tone(1140, 0.6, 0.018, 'sine', 1.5);
          if (this.particles.enabled) {
            for (let i = 0; i < 8; i++) {
              this.particles.emit(site.x + (Math.random() - 0.5) * 2.4, site.y + 2.2,
                site.z + (Math.random() - 0.5) * 0.6,
                0, 0.08 + Math.random() * 0.06, 0, 0.05, 1.4,
                MC.Atlas.index.torch_top, 1, 0.94, 0.72, 0);
            }
          }
          return {
            title: '无人认领的画架',
            text: '你把灯放在画架旁边。\n\n画上多了一个人。\n\n很小，站在山坡上，背对着你。\n\n你抬头看那片山坡。\n\n那里什么也没有。'
          };
        }
        return {
          title: '无人认领的画架',
          text: '灯还亮着。\n\n画上的人没有动。\n\n你换了个角度看，他始终背对着你。'
        };
      }
      if (first) this.sfx.tone(520, 0.7, 0.018, 'sine', 1.1);
      return {
        title: '无人认领的画架',
        text: '一块画布支在木架上。\n\n上面只有底色，和几道很轻的铅笔线。\n\n画的是一片山坡——正好是从这里看出去的那片。\n\n画的人没有画完。也许他在等一个更好的时辰。'
      };
    }

    /* ---------- 彩蛋：井 ---------- */
    useWell(site) {
      const first = this.markSeen('well');
      this.sfx.tone(300, 0.22, 0.05, 'sine', 0.8);
      this.sfx.noise(620, 0.18, 0.9, 0.03, 0.6);
      const deep = this.isSmallHours();
      setTimeout(() => {
        this.sfx.tone(deep ? 150 : 176, 0.4, 0.04, 'sine', 0.82);
        this.sfx.noise(280, 0.3, 1.4, 0.022, 0.5);
      }, deep ? 900 : 620);
      if (deep) {
        return {
          title: '会回答的井',
          text: '你朝井里喊了一声。\n\n井底回了一个词。\n\n你没听清。\n\n但你确定那是一个词，不是回声。'
        };
      }
      if (first) return {
        title: '会回答的井',
        text: '你朝井里喊了一声。\n\n过了半拍，井底也喊了一声。\n\n比你低，比你慢。\n\n第二声不是你喊的。'
      };
      return {
        title: '会回答的井',
        text: '你又喊了一声。\n\n井底也又喊了一声。\n\n这次它没有慢那么多。'
      };
    }

    /* ---------- 彩蛋：鞋 ---------- */
    useShoes(site) {
      const first = this.markSeen('shoes');
      if (first) {
        this.sfx.noise(520, 0.5, 0.7, 0.02, 0.8);
        if (this.particles.enabled) {
          for (let i = 0; i < 5; i++) {
            this.particles.emit(site.x + 0.5 + (Math.random() - 0.5),
              site.y + 0.2, site.z + 2 + Math.random(),
              0, 0.06, 0.12, 0.05, 0.7, MC.Atlas.index.sand, 0.92, 0.88, 0.8, 0.4);
          }
        }
      }
      return {
        title: '海边的一双鞋',
        text: '沙滩上并排摆着一双旧鞋，鞋尖朝着海。\n\n两只都摆得很正，像有人脱下它们，认真地面朝大海站了一会儿。\n\n旁边的木头下面压着半张纸，字被潮气泡花了：\n\n“我只是想看看海。”\n\n没有落款。'
      };
    }

    /* ---------- 彩蛋：石堆里的钥匙 ---------- */
    useKey(site) {
      const before = this.flags.keyStage || 0;
      const y = site.y;
      let stage = before;
      if (stage === 0) {
        if (this.hooks.setBlock) this.hooks.setBlock(site.x, y + 3, site.z, 0);
        stage = 1;
      } else if (stage === 1) {
        for (const [dx, dz] of [[-1, 0], [0, 0], [1, 0], [0, -1], [0, 1]])
          if (this.hooks.setBlock) this.hooks.setBlock(site.x + dx, y + 2, site.z + dz, 0);
        stage = 2;
      } else if (stage === 2) {
        if (this.hooks.setBlock) this.hooks.setBlock(site.x, y + 1, site.z, 0);
        stage = 3;
      }
      if (stage !== before) {
        this.flags.keyStage = stage;
        if (this.hooks.save) this.hooks.save();
        this.sfx.noise(340, 0.16, 1.1, 0.08, 0.7);
        this.sfx.tone(120, 0.12, 0.03, 'sine', 0.8);
      }
      if (stage === 1) return {
        title: '石堆里的钥匙',
        text: '石堆比看起来新。\n\n你搬开最上面那块石头。\n\n下面还是石头。'
      };
      if (stage === 2) return {
        title: '石堆里的钥匙',
        text: '再搬开一块。\n\n这块石头的背面有一道刻痕，像一个箭头，指向石堆里面。'
      };
      if (stage === 3) {
        if (before < 3) {
          // 你把石头一块块压回去，石堆看起来和原来一样。
          if (this.hooks.setBlock) {
            this.hooks.setBlock(site.x, y + 1, site.z, MC.Block.COBBLE);
            for (const [dx, dz] of [[-1, 0], [0, 0], [1, 0], [0, -1], [0, 1]])
              this.hooks.setBlock(site.x + dx, y + 2, site.z + dz, MC.Block.STONE);
            this.hooks.setBlock(site.x, y + 3, site.z, MC.Block.STONE);
          }
          this.markSeen('key');
          this.sfx.tone(660, 0.7, 0.03, 'sine', 1.2);
          return {
            title: '石堆里的钥匙',
            text: '最后一块。\n\n下面压着一枚钥匙。铜绿色，很小，齿磨得很平。\n\n你把它拿在手里，想不出这世界上还有哪把锁。\n\n于是你把它放回原处，把石头一块块压好。'
          };
        }
        return {
          title: '石堆里的钥匙',
          text: '石堆还在。\n\n你压回去的那几块石头，位置没有变。\n\n钥匙在下面。它不着急。'
        };
      }
      return null;
    }

    /* ---------- 彩蛋：夜里的摄影师 ---------- */
    checkShutter(force) {
      if (this.shutter) return false;
      if (!force && (!this.isNight() || !this.isSmallHours())) return false;
      const night = this.dayIndex();
      if (!force) {
        if (night === this.shutterNight) return false;
        this.shutterNight = night;
        // 大部分夜晚什么也不会发生。
        if (MC.Noise.hash2(this.world.seed, night, 9041) > 0.16) return false;
      }
      const p = this.player;
      if (this.world.isNether && this.world.isNether(p.pos[0], p.pos[2])) return false;
      const h = this.world.heightAt(Math.floor(p.pos[0]), Math.floor(p.pos[2]));
      if (p.pos[1] < h - 4) return false;
      const dist = 26 + MC.Noise.hash2(night, 3, 93) * 12;
      for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2]) {
        const dx = -Math.sin(p.yaw + off), dz = -Math.cos(p.yaw + off);
        const x = Math.floor(p.pos[0] + dx * dist);
        const z = Math.floor(p.pos[2] + dz * dist);
        if (Math.hypot(x - p.pos[0], z - p.pos[2]) < 18) continue;
        const chunk = this.world.getChunk(x >> 4, z >> 4);
        if (!chunk || !chunk.generated) continue;
        const ground = this.world.heightAt(x, z);
        if (ground <= MC.WORLD.SEA + 1) continue;
        if (this.world.getBlock(x, ground + 1, z) !== 0 ||
            this.world.getBlock(x, ground + 2, z) !== 0) continue;
        this.shutter = {
          x: x + 0.5, y: ground + 1, z: z + 0.5,
          yaw: 0, age: 0, look: 0, flashAt: 2 + Math.random() * 3
        };
        this.sfx.tone(58, 2.2, 0.025, 'sine', 0.9);
        this.sfx.noise(200, 1.2, 1.0, 0.008, 0.4);
        return true;
      }
      return false;
    }

    updateShutter(dt) {
      const f = this.shutter;
      if (!f) return;
      f.age += dt;
      if (!this.isNight() || f.age > 150) { this.vanishShutter(); return; }
      const p = this.player;
      const eye = p.eye();
      const dx = eye[0] - f.x, dy = eye[1] - (f.y + 1.7), dz = eye[2] - f.z;
      f.yaw = Math.atan2(dx, dz) + Math.PI;
      const dist = Math.hypot(dx, dy, dz);
      // 每几秒一次闪光，远处只看见一小团白。
      f.flashAt -= dt;
      if (f.flashAt <= 0) {
        f.flashAt = 2.6 + Math.random() * 3.4;
        const fx = f.x - Math.sin(f.yaw) * 0.45;
        const fz = f.z - Math.cos(f.yaw) * 0.45;
        if (this.particles.enabled) {
          for (let i = 0; i < 7; i++) {
            this.particles.emit(fx + (Math.random() - 0.5) * 0.3, f.y + 1.9,
              fz + (Math.random() - 0.5) * 0.3,
              0, 0.02, 0, 0.24 + Math.random() * 0.14, 0.1 + Math.random() * 0.05,
              MC.Atlas.index.torch_top, 1, 1, 1, 0);
          }
        }
        this.sfx.noise(3200, 0.05, 2.2, 0.05, 1.6);
        this.sfx.tone(1400, 0.03, 0.02, 'square', 1.2);
      }
      // 你看得太久，它会收工；但举起相机的时候，它愿意等。
      if (this.state.mode === 'photo') {
        f.look = 0;
      } else {
        const cp = Math.cos(p.pitch);
        const lx = -Math.sin(p.yaw) * cp, ly = Math.sin(p.pitch), lz = -Math.cos(p.yaw) * cp;
        const len = dist || 1;
        const dot = (dx * lx + dy * ly + dz * lz) / len;
        if (dot > 0.985) f.look += dt;
        else f.look = Math.max(0, f.look - dt * 1.5);
      }
      if (f.look > 5 || dist < 7) this.vanishShutter(true);
    }

    vanishShutter(tookPhoto) {
      if (!this.shutter) return;
      this.shutter = null;
      if (tookPhoto) {
        // 它举起相机，替你也拍了一张。
        if (this.hooks.flash) this.hooks.flash();
        this.sfx.tone(1500, 0.05, 0.06, 'square', 1.4);
        this.sfx.noise(2600, 0.08, 2, 0.06, 1.5);
      } else {
        this.sfx.tone(52, 1.2, 0.03, 'sine', 0.7);
        this.sfx.noise(160, 0.6, 0.8, 0.02, 0.4);
      }
    }

    /* ---------- 彩蛋：萤火引路 ---------- */
    checkFireflies(force) {
      if (this.fireflies) return false;
      if (!this.isNight()) return false;
      const p = this.player;
      if (this.world.isNether && this.world.isNether(p.pos[0], p.pos[2])) return false;
      const night = this.dayIndex();
      if (!force) {
        if (night === this.fireflyNight) return false;
        this.fireflyNight = night;
        if (MC.Noise.hash2(this.world.seed, night, 6121) > 0.05) return false;
      }
      const h = this.world.heightAt(Math.floor(p.pos[0]), Math.floor(p.pos[2]));
      if (p.pos[1] < h - 3) return false;
      const biome = this.world.biomeAtPlayer(p.pos[0], p.pos[1], p.pos[2]);
      if (biome !== 'forest' && biome !== 'plains' && biome !== 'cherry' && biome !== 'taiga') return false;
      // 萤火是飞着的，可以掠过一小段水面；但要尽量把人留在陆地上，
      // 并且往你正看着的方向飘——不然很容易从背后溜走。
      const fwdX = -Math.sin(p.yaw), fwdZ = -Math.cos(p.yaw);
      let best = null, bestScore = -Infinity;
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        let score = 0;
        let prev = h;
        for (let d = 8; d <= 48; d += 8) {
          const x = Math.floor(p.pos[0] + dx * d), z = Math.floor(p.pos[2] + dz * d);
          const hh = this.world.heightAt(x, z);
          if (hh <= MC.WORLD.SEA + 1) { score -= 2; continue; }
          if (Math.abs(hh - prev) > 8) score -= 1;
          else score += 1;
          if (this.world.biomeAt(x, z, hh) === biome) score += 1;
          prev = hh;
        }
        score += MC.Noise.hash2(night, i, 771) * 0.4;
        score += (dx * fwdX + dz * fwdZ) * 1.6;
        if (score > bestScore) { bestScore = score; best = { dx, dz }; }
      }
      if (bestScore < 3) return false;
      if (!best) return false;
      const ground = this.world.heightAt(Math.floor(p.pos[0] + best.dx * 6),
        Math.floor(p.pos[2] + best.dz * 6));
      this.fireflies = {
        x: p.pos[0] + best.dx * 6, y: ground + 1.6, z: p.pos[2] + best.dz * 6,
        dx: best.dx, dz: best.dz, traveled: 0, age: 0, acc: 0
      };
      // 先在你脚边亮成一条线，再飘走——不然容易错过。
      if (this.particles.enabled) {
        for (let i = 0; i < 12; i++) {
          const d = 2 + i * 0.55;
          this.particles.emit(p.pos[0] + best.dx * d, ground + 1.2 + Math.random() * 0.8,
            p.pos[2] + best.dz * d, (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.2,
            0.05 + Math.random() * 0.02, 1 + Math.random() * 0.8,
            MC.Atlas.index.torch_top, 1, 0.95, 0.45, 0);
        }
      }
      this.sfx.tone(1560, 0.22, 0.02, 'sine', 1.5);
      this.sfx.tone(2080, 0.18, 0.012, 'sine', 1.8);
      return true;
    }

    updateFireflies(dt) {
      const f = this.fireflies;
      if (!f) return;
      f.age += dt;
      if (!this.isNight() || f.age > 90) { this.endFireflies(); return; }
      const speed = 1.25;
      f.x += f.dx * speed * dt;
      f.z += f.dz * speed * dt;
      f.traveled += speed * dt;
      const ground = this.world.heightAt(Math.floor(f.x), Math.floor(f.z));
      const targetY = ground + 1.5 + Math.sin(f.age * 2.1) * 0.35;
      f.y += (targetY - f.y) * Math.min(1, dt * 3.5);
      f.acc += dt;
      while (f.acc > 0.06) {
        f.acc -= 0.06;
        const a = Math.random() * Math.PI * 2;
        const r = 0.5 + Math.random() * 1.5;
        this.particles.emit(
          f.x + Math.cos(a) * r, f.y + (Math.random() - 0.5) * 1.2, f.z + Math.sin(a) * r,
          (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.25,
          0.05 + Math.random() * 0.025, 1.2 + Math.random() * 0.9,
          MC.Atlas.index.torch_top, 1, 0.95, 0.45, 0);
      }
      const p = this.player.pos;
      if (Math.hypot(f.x - p[0], f.z - p[2]) > 30) { this.endFireflies(); return; }
      if (f.traveled >= 46) this.finishFireflies();
    }

    finishFireflies() {
      const f = this.fireflies;
      if (!f) return;
      for (let i = 0; i < 30; i++) {
        const a = i / 30 * Math.PI * 2;
        this.particles.emit(f.x + Math.cos(a) * 2.4, f.y + Math.sin(i * 1.7) * 0.45,
          f.z + Math.sin(a) * 2.4, 0, 0.03, 0, 0.055, 2.6,
          MC.Atlas.index.torch_top, 1, 0.96, 0.52, 0);
      }
      this.sfx.tone(1320, 0.35, 0.022, 'sine', 1.6);
      this.sfx.tone(880, 0.5, 0.018, 'sine', 1.4);
      this.fireflies = null;
      this.markSeen('fireflies');
      if (this.hooks.read) this.hooks.read({
        title: '萤火围成的圈',
        text: '萤火慢下来，围成一个圈。\n\n圈里是一片被压平的草，和一小块还没化开的霜。\n\n它们停了很久。\n\n然后一起散开，像谁把一把碎光撒回林子里。'
      });
    }

    endFireflies() {
      if (!this.fireflies) return;
      this.fireflies = null;
      this.sfx.tone(980, 0.5, 0.012, 'sine', 0.7);
    }

    /* ---------- 拍照：它替你留下了一张 ---------- */
    inFrame(x, y, z, spread) {
      const p = this.player;
      const eye = p.eye();
      const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
      const dist = Math.hypot(dx, dy, dz) || 1;
      if (dist > 90) return false;
      const cp = Math.cos(p.pitch);
      const lx = -Math.sin(p.yaw) * cp, ly = Math.sin(p.pitch), lz = -Math.cos(p.yaw) * cp;
      return (dx * lx + dy * ly + dz * lz) / dist > (spread || 0.86);
    }

    photoTaken() {
      const f = this.shutter;
      if (!f) return null;
      if (!this.inFrame(f.x, f.y + 1.6, f.z, 0.84)) return null;
      const photo = this.mysteryPhoto();
      this.markSeen('shutter');
      this.vanishShutter(true);
      if (this.hooks.toast) this.hooks.toast('相册里多了一张不是你拍的照片');
      return photo;
    }

    mysteryPhoto() {
      const w = 640, h = 360;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h + 54;
      const ctx = cv.getContext('2d');
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#070b16');
      sky.addColorStop(0.55, '#121b31');
      sky.addColorStop(1, '#2b3552');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 110; i++) {
        const x = Math.random() * w, y = Math.random() * (h * 0.6);
        ctx.fillStyle = 'rgba(218,230,255,' + (0.2 + Math.random() * 0.6) + ')';
        ctx.fillRect(x, y, 1.3, 1.3);
      }
      // 远山
      ctx.fillStyle = '#0a1120';
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h * 0.62);
      ctx.quadraticCurveTo(w * 0.18, h * 0.44, w * 0.36, h * 0.6);
      ctx.quadraticCurveTo(w * 0.55, h * 0.78, w * 0.72, h * 0.55);
      ctx.quadraticCurveTo(w * 0.88, h * 0.4, w, h * 0.58);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      // 地面
      ctx.fillStyle = '#080d17';
      ctx.fillRect(0, h * 0.86, w, h * 0.14);
      // 画面里是你：背对着它，站在前景。
      const cx = w * 0.56, base = h * 0.97, headY = h * 0.52, headR = 20;
      ctx.fillStyle = '#0b1018';
      ctx.beginPath();
      ctx.arc(cx, headY, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 30, headY + headR * 0.8);
      ctx.lineTo(cx + 30, headY + headR * 0.8);
      ctx.lineTo(cx + 24, base);
      ctx.lineTo(cx - 24, base);
      ctx.closePath();
      ctx.fill();
      // 一点点冷色轮廓光，好让人形从黑里浮出来。
      ctx.strokeStyle = 'rgba(150,180,230,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, headY, headR, -Math.PI * 0.7, Math.PI * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 26, headY + 22);
      ctx.lineTo(cx + 21, base - 8);
      ctx.stroke();
      // 左下角那一闪。
      const flash = ctx.createRadialGradient(w * 0.16, h * 0.78, 2, w * 0.16, h * 0.78, 130);
      flash.addColorStop(0, 'rgba(255,255,255,0.85)');
      flash.addColorStop(0.35, 'rgba(220,235,255,0.25)');
      flash.addColorStop(1, 'rgba(220,235,255,0)');
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, w, h);
      // 和别的照片一样，底部留一条米色边。
      ctx.fillStyle = '#f5efe0';
      ctx.fillRect(0, h, w, 54);
      const clock = this.clockText();
      ctx.fillStyle = '#244537';
      ctx.font = 'bold 17px sans-serif';
      ctx.fillText('你  ·  ' + clock, 17, h + 34);
      ctx.textAlign = 'right';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('栖野  /  WILD STUDIO', w - 17, h + 32);
      return {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        title: '你',
        clock,
        url: cv.toDataURL('image/jpeg', .8)
      };
    }

    /* ---------- 每帧 ---------- */
    update(dt) {
      if (this.shutter) this.updateShutter(dt);
      if (this.fireflies) this.updateFireflies(dt);
      this.acc += dt;
      if (this.acc < 0.5) return;
      const step = this.acc;
      this.acc = 0;
      this.ambient(step);
      this.checkShutter();
      this.checkFireflies();
      this.easelGlow();
    }

    easelGlow() {
      const site = this.siteOf('easel');
      if (!site || !this.flags.easelLamp || !this.isNight()) return;
      if (!this.particles.enabled || Math.random() > 0.45) return;
      this.particles.emit(site.x + (Math.random() - 0.5) * 2.4, site.y + 2.4,
        site.z + (Math.random() - 0.5) * 0.8,
        0, 0.06, 0, 0.04, 1.5, MC.Atlas.index.torch_top, 1, 0.94, 0.74, 0);
    }

    collect(out) {
      const f = this.shutter;
      if (!f) return;
      const M = MC.MobMat;
      const tiles = { top: MC.Atlas.index.shade, side: MC.Atlas.index.shade, bottom: MC.Atlas.index.shade };
      const root = M.mul(M.trs(f.x, f.y, f.z), M.ry(f.yaw));
      const add = (dx, dy, dz, sx, sy, sz) => {
        out.push({ m: M.mul(root, M.mul(M.trs(dx, dy, dz), M.scl(sx, sy, sz))), tiles, flash: 0 });
      };
      add(0, 1.36, 0, 0.42, 1.05, 0.32);
      add(0, 2.06, 0, 0.34, 0.36, 0.34);
      add(-0.36, 1.44, 0, 0.15, 0.95, 0.2);
      add(0.36, 1.44, 0, 0.15, 0.95, 0.2);
      add(-0.15, 0.4, 0, 0.16, 0.82, 0.2);
      add(0.15, 0.4, 0, 0.16, 0.82, 0.2);
      // 举在脸前的相机。
      add(0, 1.94, -0.34, 0.3, 0.2, 0.18);
    }

    ambient(step) {
      this.ambientAt -= step;
      if (this.ambientAt > 0) return;
      this.ambientAt = 7 + Math.random() * 12;
      const p = this.player;
      const biome = this.world.biomeAtPlayer(p.pos[0], p.pos[1], p.pos[2]);
      const h = this.world.heightAt(Math.floor(p.pos[0]), Math.floor(p.pos[2]));
      if (p.pos[1] < h - 5) return;
      const clock = this.clock();
      if (clock >= 5.5 && clock < 18) {
        for (let i = 0; i < 2 + ((Math.random() * 2) | 0); i++) {
          setTimeout(() => this.sfx.tone(1250 + Math.random() * 900, 0.07,
            0.012 + Math.random() * 0.012, 'sine', 0.8), i * 120);
        }
      } else {
        for (let i = 0; i < 3; i++) {
          setTimeout(() => this.sfx.noise(2600, 0.05, 8, 0.008, 1), i * 95);
        }
      }
      if (biome === 'ocean' || biome === 'frozen_ocean' || h <= MC.WORLD.SEA + 2) {
        this.sfx.noise(520, 0.7, 0.8, 0.012, 0.6);
      } else if (biome === 'snow' || biome === 'mountain') {
        this.sfx.noise(700, 0.8, 0.5, 0.008, 0.4);
      }
    }

    /* ---------- 调试与验收 ---------- */
    trigger(id) {
      if (id === 'shutter') {
        this.shutterNight = -1;
        this.state.time = DAY * 0.55;
        return this.checkShutter(true);
      }
      if (id === 'fireflies') {
        this.fireflyNight = -1;
        this.state.time = DAY * 0.45;
        return this.checkFireflies(true);
      }
      const site = this.siteOf(id);
      if (!site) return null;
      this.ensureSite(site);
      return this.use(id);
    }

    list() {
      return Object.keys(EGGS).map(id => ({
        id, name: EGGS[id], seen: !!this.seen[id]
      }));
    }
  }

  MC.Secrets = Secrets;
})();

/* mobs.js — 动物盒子模型、简单 AI、生成与动画 */
(function () {
  'use strict';
  const MC = window.MC;
  const T = MC.MOB_TILES;

  /* ---------------- 矩阵小工具（列主序） ---------------- */
  function I() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }
  function trs(x, y, z) { const m = I(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function scl(x, y, z) { const m = I(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function ry(a) { const m = I(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
  function rx(a) { const m = I(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
  function rz(a) { const m = I(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }

  /* 预生成局部矩阵 */
  const LEG_TURNS = [1, -1, -1, 1];

  /* ---------------- 通用碰撞 ---------------- */
  function hits(world, px, py, pz, r, h) {
    const e = 1e-3;
    const x0 = Math.floor(px - r + e), x1 = Math.floor(px + r - e);
    const y0 = Math.floor(py + e), y1 = Math.floor(py + h - e);
    const z0 = Math.floor(pz - r + e), z1 = Math.floor(pz + r - e);
    const out = [];
    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) {
          if (MC.Block.isSolid(world.getBlock(bx, by, bz))) out.push(bx, by, bz);
        }
      }
    }
    return out.length ? out : null;
  }

  /* ---------------- 生物 ---------------- */
  class Mob {
    constructor(type, x, y, z) {
      this.type = type;
      this.pos = [x, y, z];
      this.vel = [0, 0, 0];
      this.yaw = Math.random() * Math.PI * 2;
      this.phase = Math.random() * 6;
      this.think = 0;
      this.mode = 'idle';
      this.onGround = false;
      this.blocked = false;
      this.age = 0;
      if (type === 'sheep') {
        this.w = 0.62; this.h = 1.35; this.r = 0.55;
        this.speed = 1.15;
        this.sway = 0.62;
        this.health = 8;
      } else if (type === 'cow') {
        this.w = 0.78; this.h = 1.62; this.r = 0.57;
        this.speed = 0.95; this.sway = 0.48; this.health = 12;
      } else if (type === 'pig') {
        this.w = 0.58; this.h = 1.12; this.r = 0.48;
        this.speed = 1.15; this.sway = 0.62; this.health = 8;
      } else if (type === 'rabbit') {
        this.w = 0.32; this.h = 0.82; this.r = 0.25;
        this.speed = 1.75; this.sway = 0.95; this.health = 3;
      } else {
        this.w = 0.36; this.h = 1.05; this.r = 0.30;
        this.speed = 1.35;
        this.sway = 0.9;
        this.health = 4;
      }
      this.hurtTime = 0;
      this.deathTime = 0;
      this.dying = false;
    }

    inWater(world) {
      return MC.Block.isLiquid(world.getBlock(
        Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.2), Math.floor(this.pos[2])));
    }

    moveAxis(axis, delta) {
      if (delta === 0) return;
      const steps = Math.min(24, Math.max(1, Math.ceil(Math.abs(delta) / 0.2)));
      const step = delta / steps;
      for (let i = 0; i < steps; i++) {
        this.pos[axis] += step;
        const hs = hits(this.world, this.pos[0], this.pos[1], this.pos[2], this.r, this.h);
        if (!hs) {
          const player = this.player;
          if (player && axis !== 1 &&
              this.pos[1] + this.h > player.pos[1] && this.pos[1] < player.pos[1] + player.height) {
            const other = axis === 0 ? 2 : 0;
            const previous = this.pos[axis] - step;
            if (Math.abs(this.pos[other] - player.pos[other]) < this.r + player.radius &&
                Math.abs(this.pos[axis] - player.pos[axis]) < this.r + player.radius &&
                step * (player.pos[axis] - previous) >= 0) {
              this.pos[axis] = player.pos[axis] - Math.sign(step) * (this.r + player.radius + 1e-3);
              this.vel[axis] = 0;
              this.blocked = true;
              break;
            }
          }
          if (axis !== 1 && this.neighbors) {
            let stopped = false;
            for (const otherMob of this.neighbors) {
              if (otherMob === this || otherMob.dead || otherMob.dying ||
                  this.pos[1] + this.h <= otherMob.pos[1] || this.pos[1] >= otherMob.pos[1] + otherMob.h) continue;
              const other = axis === 0 ? 2 : 0;
              const previous = this.pos[axis] - step;
              if (Math.abs(this.pos[other] - otherMob.pos[other]) >= this.r + otherMob.r ||
                  Math.abs(this.pos[axis] - otherMob.pos[axis]) >= this.r + otherMob.r ||
                  step * (otherMob.pos[axis] - previous) < 0) continue;
              this.pos[axis] = otherMob.pos[axis] - Math.sign(step) * (this.r + otherMob.r + 1e-3);
              this.vel[axis] = 0;
              this.blocked = true;
              stopped = true;
              break;
            }
            if (stopped) break;
          }
          continue;
        }
        let snap = this.pos[axis];
        if (axis === 0) {
          if (step > 0) { let m = Infinity; for (let k = 0; k < hs.length; k += 3) m = Math.min(m, hs[k]); snap = m - this.r - 1e-3; }
          else { let m = -Infinity; for (let k = 0; k < hs.length; k += 3) m = Math.max(m, hs[k] + 1); snap = m + this.r + 1e-3; }
          this.blocked = true;
        } else if (axis === 1) {
          if (step > 0) { let m = Infinity; for (let k = 0; k < hs.length; k += 3) m = Math.min(m, hs[k + 1]); snap = m - this.h - 1e-3; }
          else { let m = -Infinity; for (let k = 0; k < hs.length; k += 3) m = Math.max(m, hs[k + 1] + 1); snap = m + 1e-3; this.onGround = true; }
        } else {
          if (step > 0) { let m = Infinity; for (let k = 0; k < hs.length; k += 3) m = Math.min(m, hs[k + 2]); snap = m - this.r - 1e-3; }
          else { let m = -Infinity; for (let k = 0; k < hs.length; k += 3) m = Math.max(m, hs[k + 2] + 1); snap = m + this.r + 1e-3; }
          this.blocked = true;
        }
        this.pos[axis] = snap;
        this.vel[axis] = 0;
        break;
      }
    }

    update(dt, world) {
      this.world = world;
      this.age += dt;
      this.hurtTime = Math.max(0, this.hurtTime - dt);
      if (this.dying) {
        this.deathTime -= dt;
        if (this.deathTime <= 0) this.dead = true;
        return;
      }
      const water = this.inWater(world);

      this.think -= dt;
      if (this.think <= 0) {
        this.think = 1.4 + Math.random() * 3.2;
        if (Math.random() < 0.55) {
          this.mode = 'walk';
          this.yaw = Math.random() * Math.PI * 2;
        } else {
          this.mode = 'idle';
        }
      }

      let speed = this.mode === 'walk' ? this.speed : 0;
      if (water) speed *= 0.5;

      // 前方一格：悬崖或深水时掉头
      if (this.mode === 'walk' && this.onGround && Math.random() < 0.02) {
        const fx = Math.floor(this.pos[0] - Math.sin(this.yaw) * 0.9);
        const fz = Math.floor(this.pos[2] - Math.cos(this.yaw) * 0.9);
        const below = world.getBlock(fx, Math.floor(this.pos[1]) - 1, fz);
        if (!MC.Block.isSolid(below) || MC.Block.isLiquid(below)) {
          this.yaw += Math.PI * (0.6 + Math.random() * 0.6);
        }
      }

      const k = Math.min(1, dt * 7);
      this.vel[0] += (-Math.sin(this.yaw) * speed - this.vel[0]) * k;
      this.vel[2] += (-Math.cos(this.yaw) * speed - this.vel[2]) * k;

      if (water) {
        this.vel[1] = Math.min(this.vel[1] + 18 * dt, 1.4);
      } else {
        this.vel[1] -= 30 * dt;
        if (this.vel[1] < -50) this.vel[1] = -50;
      }

      this.blocked = false;
      this.onGround = false;
      this.moveAxis(1, this.vel[1] * dt);
      this.moveAxis(0, this.vel[0] * dt);
      this.moveAxis(2, this.vel[2] * dt);

      // 撞墙就跳一下
      if (this.blocked && this.onGround && Math.random() < 0.25) this.vel[1] = 7.2;

      const hs = Math.hypot(this.vel[0], this.vel[2]);
      if (hs > 0.1) this.phase += dt * (4 + hs * 4);
      if (this.pos[1] < -8) this.dead = true;
    }

    hurt(damage, dx, dz) {
      if (this.dead || this.dying) return false;
      this.health -= damage;
      this.hurtTime = 0.24;
      this.vel[0] += dx * 4;
      this.vel[2] += dz * 4;
      this.vel[1] = Math.max(this.vel[1], 2.5);
      this.mode = 'idle';
      this.think = 0.6;
      if (this.health <= 0) {
        this.dying = true;
        this.deathTime = 0.24;
      }
      return this.dying;
    }

    /** 把自身的模型盒子塞进渲染列表 */
    collect(out) {
      const first = out.length;
      const root = mul(trs(this.pos[0], this.pos[1], this.pos[2]), ry(this.yaw));
      const walk = Math.sin(this.phase) * this.sway;
      const bob = Math.abs(Math.sin(this.phase)) * 0.02;

      if (this.type === 'sheep') {
        const body = mul(trs(0, 0.9 + bob, 0), scl(1.0, 0.8, 1.35));
        out.push({ m: mul(root, body), tiles: { top: T.wool, side: T.wool, bottom: T.wool } });

        const head = mul(trs(0, 1.05 + bob, -0.76), scl(0.55, 0.55, 0.55));
        out.push({ m: mul(root, head), tiles: { top: T.wool, side: T.wool, bottom: T.wool, front: T.sheepFace } });

        const hips = [[-0.3, -0.44], [0.3, -0.44], [-0.3, 0.44], [0.3, 0.44]];
        for (let i = 0; i < 4; i++) {
          const ang = walk * LEG_TURNS[i];
          const leg = mul(mul(trs(hips[i][0], 0.5, hips[i][1]), rx(ang)), mul(trs(0, -0.24, 0), scl(0.24, 0.48, 0.24)));
          out.push({ m: mul(root, leg), tiles: { top: T.sheepLeg, side: T.sheepLeg, bottom: T.sheepLeg } });
        }
      } else if (this.type === 'cow' || this.type === 'pig') {
        const cow = this.type === 'cow';
        const skin = cow ? T.cowHide : T.pigBody;
        const face = cow ? T.cowFace : T.pigFace;
        const hoof = cow ? T.cowHoof : T.pigBody;
        const bodyY = cow ? 1.03 : 0.69;
        const body = mul(trs(0, bodyY + bob, 0.03), scl(cow ? 0.92 : 0.75, cow ? 0.87 : 0.58, cow ? 1.45 : 1.08));
        out.push({ m: mul(root, body), tiles: { top: skin, side: skin, bottom: skin } });
        const head = mul(trs(0, cow ? 1.24 + bob : 0.79 + bob, cow ? -0.84 : -0.61),
          scl(cow ? 0.66 : 0.53, cow ? 0.65 : 0.48, cow ? 0.59 : 0.5));
        out.push({ m: mul(root, head), tiles: { top: skin, side: skin, bottom: skin, front: face } });
        if (cow) {
          for (const side of [-1, 1]) {
            const horn = mul(trs(side * 0.27, 1.64 + bob, -0.81), scl(0.12, 0.18, 0.12));
            out.push({ m: mul(root, horn), tiles: { top: T.wool, side: T.wool, bottom: T.wool } });
          }
        } else {
          for (const side of [-1, 1]) {
            const ear = mul(trs(side * 0.23, 1.05 + bob, -0.65), scl(0.16, 0.19, 0.12));
            out.push({ m: mul(root, ear), tiles: { top: skin, side: skin, bottom: skin } });
          }
        }
        for (const x of [-0.27, 0.27]) for (const z of [-0.43, 0.43]) {
          const turn = walk * (x * z > 0 ? 1 : -1);
          const leg = mul(mul(trs(x, cow ? 0.61 : 0.40, z), rx(turn)),
            mul(trs(0, cow ? -0.27 : -0.18, 0), scl(cow ? 0.22 : 0.19, cow ? 0.54 : 0.36, cow ? 0.22 : 0.19)));
          out.push({ m: mul(root, leg), tiles: { top: skin, side: skin, bottom: hoof } });
        }
      } else if (this.type === 'rabbit') {
        const body = mul(trs(0, 0.38 + bob, 0.08), scl(0.4, 0.4, 0.58));
        out.push({ m: mul(root, body), tiles: { top: T.rabbitFur, side: T.rabbitFur, bottom: T.rabbitFur } });
        const head = mul(trs(0, 0.59 + bob, -0.30), scl(0.33, 0.32, 0.31));
        out.push({ m: mul(root, head), tiles: { top: T.rabbitFur, side: T.rabbitFur, bottom: T.rabbitFur, front: T.rabbitFace } });
        for (const side of [-1, 1]) {
          const ear = mul(trs(side * 0.11, 0.84 + bob, -0.30), scl(0.10, 0.30, 0.11));
          out.push({ m: mul(root, ear), tiles: { top: T.rabbitFur, side: T.rabbitEar, bottom: T.rabbitFur, front: T.rabbitEar } });
          const foot = mul(mul(trs(side * 0.14, 0.20, 0.19), rx(walk * side * 0.5)), scl(0.16, 0.24, 0.24));
          out.push({ m: mul(root, foot), tiles: { top: T.rabbitFur, side: T.rabbitFur, bottom: T.rabbitFur } });
        }
        const tail = mul(trs(0, 0.39 + bob, 0.39), scl(0.17, 0.17, 0.17));
        out.push({ m: mul(root, tail), tiles: { top: T.wool, side: T.wool, bottom: T.wool } });
      } else {
        const body = mul(trs(0, 0.5 + bob, 0), scl(0.45, 0.4, 0.55));
        out.push({ m: mul(root, body), tiles: { top: T.chickenBody, side: T.chickenBody, bottom: T.chickenBody } });

        const head = mul(trs(0, 0.79 + bob, -0.28), scl(0.3, 0.3, 0.3));
        out.push({ m: mul(root, head), tiles: { top: T.chickenBody, side: T.chickenBody, bottom: T.chickenBody, front: T.chickenFace } });

        const beak = mul(trs(0, 0.75 + bob, -0.47), scl(0.14, 0.1, 0.16));
        out.push({ m: mul(root, beak), tiles: { top: T.beak, side: T.beak, bottom: T.beak, front: T.beak } });

        const comb = mul(trs(0, 0.98 + bob, -0.28), scl(0.06, 0.13, 0.22));
        out.push({ m: mul(root, comb), tiles: { top: T.comb, side: T.comb, bottom: T.comb } });

        for (const s of [-1, 1]) {
          const wing = mul(mul(trs(s * 0.245, 0.53 + bob, 0), rz(s * 0.12)), scl(0.07, 0.3, 0.38));
          out.push({ m: mul(root, wing), tiles: { top: T.chickenBody, side: T.chickenBody, bottom: T.chickenBody } });
        }
        for (const s of [-1, 1]) {
          const ang = walk * s * 0.8;
          const leg = mul(mul(trs(s * 0.12, 0.3, 0.02), rx(ang)), mul(trs(0, -0.15, 0), scl(0.08, 0.3, 0.08)));
          out.push({ m: mul(root, leg), tiles: { top: T.chickenLeg, side: T.chickenLeg, bottom: T.chickenLeg } });
        }
      }
      const flash = this.dying ? 1 : this.hurtTime > 0 ? 0.8 : 0;
      for (let i = first; i < out.length; i++) {
        out[i].flash = flash;
        if (this.moonlit) out[i].glow = 1;
      }
    }
  }

  /* ---------------- 管理：生成 / 回收 ---------------- */
  class MobManager {
    constructor(world) {
      this.world = world;
      this.mobs = [];
      this.timer = 1.5;
      this.max = 14;
      this.spawned = 0;
    }

    count(type) {
      let n = 0;
      for (const m of this.mobs) if (m.type === type) n++;
      return n;
    }

    update(dt, player, active) {
      const playerPos = player.pos;
      for (let i = this.mobs.length - 1; i >= 0; i--) {
        const m = this.mobs[i];
        m.player = player;
        m.neighbors = this.mobs;
        m.update(dt, this.world);
        const dx = m.pos[0] - playerPos[0], dz = m.pos[2] - playerPos[2];
        if (m.dead || dx * dx + dz * dz > 110 * 110) this.mobs.splice(i, 1);
      }
      for (const m of this.mobs) {
        if (m.dead || m.dying || player.pos[1] + player.height <= m.pos[1] ||
            player.pos[1] >= m.pos[1] + m.h) continue;
        const dx = player.pos[0] - m.pos[0], dz = player.pos[2] - m.pos[2];
        const overlapX = player.radius + m.r - Math.abs(dx);
        const overlapZ = player.radius + m.r - Math.abs(dz);
        if (overlapX <= 0 || overlapZ <= 0) continue;
        const axis = overlapX < overlapZ ? 0 : 2;
        const sign = axis === 0 ? (dx < 0 ? -1 : 1) : (dz < 0 ? -1 : 1);
        player.moveAxis(axis, sign * ((axis === 0 ? overlapX : overlapZ) + 1e-3));
        if (Math.abs(player.pos[axis] - m.pos[axis]) < player.radius + m.r - 1e-3) {
          m.moveAxis(axis, -sign * ((axis === 0 ? overlapX : overlapZ) + 1e-3));
        }
      }
      if (!active) return;

      this.timer -= dt;
      if (this.timer > 0) return;
      this.timer = 1.6;
      if (this.mobs.length >= this.max) return;
      this.trySpawn(playerPos);
    }

    raycast(ox, oy, oz, dx, dy, dz, maxDist) {
      let best = null, nearest = maxDist;
      for (const mob of this.mobs) {
        if (mob.dead || mob.dying) continue;
        const r = mob.r + 0.03;
        const min = [mob.pos[0] - r, mob.pos[1], mob.pos[2] - r];
        const max = [mob.pos[0] + r, mob.pos[1] + mob.h, mob.pos[2] + r];
        const origin = [ox, oy, oz], dir = [dx, dy, dz];
        let enter = 0, exit = nearest;
        for (let axis = 0; axis < 3; axis++) {
          if (Math.abs(dir[axis]) < 1e-8) {
            if (origin[axis] < min[axis] || origin[axis] > max[axis]) { enter = Infinity; break; }
            continue;
          }
          const a = (min[axis] - origin[axis]) / dir[axis];
          const b = (max[axis] - origin[axis]) / dir[axis];
          enter = Math.max(enter, Math.min(a, b));
          exit = Math.min(exit, Math.max(a, b));
          if (enter > exit) break;
        }
        if (enter <= exit && enter < nearest) { nearest = enter; best = mob; }
      }
      return best ? { mob: best, t: nearest } : null;
    }

    attack(mob, damage, dx, dz) {
      if (!this.mobs.includes(mob) || mob.dead || mob.dying) return false;
      return mob.hurt(damage, dx, dz);
    }

    trySpawn(playerPos) {
      const W = this.world;
      for (let i = 0; i < 8; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 22 + Math.random() * 26;
        const x = Math.floor(playerPos[0] + Math.cos(ang) * dist);
        const z = Math.floor(playerPos[2] + Math.sin(ang) * dist);
        const chunk = W.getChunk(x >> 4, z >> 4);
        if (!chunk || !chunk.generated) continue;

        let top = -1;
        for (let y = MC.WORLD.HEIGHT - 3; y > 1; y--) {
          if (MC.Block.isSolid(W.getBlock(x, y, z))) { top = y; break; }
        }
        if (top < 0) continue;
        const ground = W.getBlock(x, top, z);
        if (ground !== MC.Block.GRASS && ground !== MC.Block.SNOW && ground !== MC.Block.SAND) continue;
        if (W.getBlock(x, top + 1, z) !== 0 || W.getBlock(x, top + 2, z) !== 0) continue;
        if (MC.Block.isLiquid(W.getBlock(x, top + 1, z))) continue;

        const biome = W.biomeAt(x, z, top);
        const choices = ground === MC.Block.SNOW || biome === 'snow' || biome === 'mountain' ?
          ['rabbit', 'rabbit', 'sheep', 'cow'] :
          ground === MC.Block.SAND ? ['chicken', 'rabbit'] :
          ['sheep', 'chicken', 'cow', 'pig', 'cow', 'pig'];
        const available = choices.filter(type => this.count(type) < 4);
        if (!available.length) continue;
        const type = available[(Math.random() * available.length) | 0];
        const radius = type === 'cow' ? 0.57 : type === 'sheep' ? 0.55 : type === 'pig' ? 0.48 : type === 'rabbit' ? 0.25 : 0.30;
        if (this.mobs.some(m => !m.dead && Math.abs(m.pos[1] - (top + 1)) < 1.5 &&
            Math.abs(m.pos[0] - (x + 0.5)) < m.r + radius + 0.2 &&
            Math.abs(m.pos[2] - (z + 0.5)) < m.r + radius + 0.2)) continue;
        const mob = new Mob(type, x + 0.5, top + 1, z + 0.5);
        this.mobs.push(mob);
        return mob;
      }
      return null;
    }

    populate(pos, n) {
      let made = 0;
      for (let i = 0; i < n * 2 && made < n; i++) {
        if (this.trySpawn(pos)) made++;
      }
    }

    collect(out) {
      for (const m of this.mobs) m.collect(out);
    }
  }

  MC.Mob = Mob;
  MC.MobManager = MobManager;
  MC.MobMat = { mul, trs, scl, ry, rx, rz };
})();

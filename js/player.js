/* player.js — 第一人称控制、AABB 碰撞、水中/飞行、体素射线拾取 */
(function () {
  'use strict';
  const MC = window.MC;

  const GRAVITY = 30;
  const JUMP_V = 8.7;
  const EPS = 1e-3;

  class Player {
    constructor(world) {
      this.world = world;
      this.pos = [world.spawn.x, world.spawn.y, world.spawn.z];
      this.vel = [0, 0, 0];
      this.yaw = world.spawn.yaw === undefined ? 0.7 : world.spawn.yaw;
      this.pitch = world.spawn.pitch === undefined ? -0.12 : world.spawn.pitch;
      this.radius = 0.3;
      this.height = 1.8;
      this.eyeH = 1.62;
      this.onGround = false;
      this.flying = false;
      this.inWater = false;
      this.sprinting = false;
      this.bobPhase = 0;
      this.bobAmount = 0;
      this.stepTimer = 0;
      this._eye = [0, 0, 0];
      this._hits = [];
      this.mobs = null;
    }

    unstuck() {
      for (let i = 0; i < 80 && this.collides(); i++) this.pos[1] += 0.25;
      this.vel[0] = this.vel[1] = this.vel[2] = 0;
    }

    collides() {
      const [x, y, z] = this.pos;
      const x0 = Math.floor(x - this.radius + EPS), x1 = Math.floor(x + this.radius - EPS);
      const y0 = Math.floor(y + EPS), y1 = Math.floor(y + this.height - EPS);
      const z0 = Math.floor(z - this.radius + EPS), z1 = Math.floor(z + this.radius - EPS);
      for (let by = y0; by <= y1; by++) {
        for (let bz = z0; bz <= z1; bz++) {
          for (let bx = x0; bx <= x1; bx++) {
            if (MC.Block.isSolid(this.world.getBlock(bx, by, bz))) return true;
          }
        }
      }
      return false;
    }

    hits() {
      const out = this._hits;
      out.length = 0;
      const [x, y, z] = this.pos;
      const x0 = Math.floor(x - this.radius + EPS), x1 = Math.floor(x + this.radius - EPS);
      const y0 = Math.floor(y + EPS), y1 = Math.floor(y + this.height - EPS);
      const z0 = Math.floor(z - this.radius + EPS), z1 = Math.floor(z + this.radius - EPS);
      for (let by = y0; by <= y1; by++) {
        for (let bz = z0; bz <= z1; bz++) {
          for (let bx = x0; bx <= x1; bx++) {
            if (MC.Block.isSolid(this.world.getBlock(bx, by, bz))) out.push(bx, by, bz);
          }
        }
      }
      return out.length ? out : null;
    }

    moveAxis(axis, delta) {
      if (delta === 0) return;
      const steps = Math.min(32, Math.max(1, Math.ceil(Math.abs(delta) / 0.2)));
      const step = delta / steps;
      for (let i = 0; i < steps; i++) {
        this.pos[axis] += step;
        const hits = this.hits();
        if (!hits) {
          if (axis === 1 && this.mobs) {
            let stopped = false;
            for (const mob of this.mobs) {
              if (mob.dead || mob.dying ||
                  Math.abs(this.pos[0] - mob.pos[0]) >= this.radius + mob.r ||
                  Math.abs(this.pos[2] - mob.pos[2]) >= this.radius + mob.r) continue;
              const previous = this.pos[1] - step;
              if (step < 0 && previous >= mob.pos[1] + mob.h - EPS && this.pos[1] < mob.pos[1] + mob.h) {
                this.pos[1] = mob.pos[1] + mob.h + EPS;
                this.vel[1] = 0;
                this.onGround = true;
                stopped = true;
              } else if (step > 0 && previous + this.height <= mob.pos[1] + EPS &&
                         this.pos[1] + this.height > mob.pos[1]) {
                this.pos[1] = mob.pos[1] - this.height - EPS;
                this.vel[1] = 0;
                stopped = true;
              }
              if (stopped) break;
            }
            if (stopped) break;
          } else if (axis !== 1 && this.mobs) {
            let stopped = false;
            for (const mob of this.mobs) {
              if (mob.dead || mob.dying ||
                  this.pos[1] + this.height <= mob.pos[1] || this.pos[1] >= mob.pos[1] + mob.h) continue;
              const other = axis === 0 ? 2 : 0;
              if (Math.abs(this.pos[other] - mob.pos[other]) >= this.radius + mob.r) continue;
              const previous = this.pos[axis] - step;
              if (step * (mob.pos[axis] - previous) < 0 ||
                  Math.abs(this.pos[axis] - mob.pos[axis]) >= this.radius + mob.r) continue;
              this.pos[axis] = mob.pos[axis] - Math.sign(step) * (this.radius + mob.r + EPS);
              this.vel[axis] = 0;
              stopped = true;
              break;
            }
            if (stopped) break;
          }
          continue;
        }
        let snap = this.pos[axis];
        if (axis === 0) {
          if (step > 0) {
            let m = Infinity;
            for (let k = 0; k < hits.length; k += 3) if (hits[k] < m) m = hits[k];
            snap = m - this.radius - EPS;
          } else {
            let m = -Infinity;
            for (let k = 0; k < hits.length; k += 3) if (hits[k] + 1 > m) m = hits[k] + 1;
            snap = m + this.radius + EPS;
          }
        } else if (axis === 1) {
          if (step > 0) {
            let m = Infinity;
            for (let k = 0; k < hits.length; k += 3) if (hits[k + 1] < m) m = hits[k + 1];
            snap = m - this.height - EPS;
          } else {
            let m = -Infinity;
            for (let k = 0; k < hits.length; k += 3) if (hits[k + 1] + 1 > m) m = hits[k + 1] + 1;
            snap = m + EPS;
            this.onGround = true;
          }
        } else {
          if (step > 0) {
            let m = Infinity;
            for (let k = 0; k < hits.length; k += 3) if (hits[k + 2] < m) m = hits[k + 2];
            snap = m - this.radius - EPS;
          } else {
            let m = -Infinity;
            for (let k = 0; k < hits.length; k += 3) if (hits[k + 2] + 1 > m) m = hits[k + 2] + 1;
            snap = m + this.radius + EPS;
          }
        }
        this.pos[axis] = snap;
        this.vel[axis] = 0;
        break;
      }
    }

    toggleFly() {
      this.flying = !this.flying;
      this.vel[1] = 0;
      return this.flying;
    }

    update(dt, input) {
      const w = this.world;
      const fx = Math.floor(this.pos[0]), fz = Math.floor(this.pos[2]);
      const bodyY = Math.floor(this.pos[1] + 1.0);
      const feetY = Math.floor(this.pos[1] + 0.15);
      this.inWater = MC.Block.isLiquid(w.getBlock(fx, bodyY, fz)) ||
                     MC.Block.isLiquid(w.getBlock(fx, feetY, fz));

      // 键盘是 8 个方向；触屏摇杆直接给出一个长度 0–1 的向量。
      let mx = input.moveX || 0, mz = input.moveZ || 0;
      if (input.forward) { mx -= Math.sin(this.yaw); mz -= Math.cos(this.yaw); }
      if (input.back) { mx += Math.sin(this.yaw); mz += Math.cos(this.yaw); }
      if (input.left) { mx -= Math.cos(this.yaw); mz += Math.sin(this.yaw); }
      if (input.right) { mx += Math.cos(this.yaw); mz -= Math.sin(this.yaw); }
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }

      this.sprinting = !!input.sprint && len > 0.12;
      let speed = this.sprinting ? 6.1 : 4.4;
      if (this.flying) speed = this.sprinting ? 20 : 10.5;
      else if (this.inWater) speed *= 0.62;

      const accel = this.flying ? 9 : (this.onGround ? 16 : 3.0);
      const k = 1 - Math.exp(-accel * dt);
      this.vel[0] += (mx * speed - this.vel[0]) * k;
      this.vel[2] += (mz * speed - this.vel[2]) * k;

      if (this.flying) {
        let vy = 0;
        if (input.jump) vy += 1;
        if (input.descend) vy -= 1;
        this.vel[1] += (vy * speed - this.vel[1]) * (1 - Math.exp(-9 * dt));
      } else if (this.inWater) {
        this.vel[1] -= 9 * dt;
        this.vel[1] *= Math.max(0, 1 - 3.2 * dt);
        if (input.jump) this.vel[1] = Math.min(this.vel[1] + 26 * dt, 4.0);
        if (this.vel[1] < -4.5) this.vel[1] = -4.5;
      } else {
        this.vel[1] -= GRAVITY * dt;
        if (this.vel[1] < -58) this.vel[1] = -58;
        if (input.jump && this.onGround) {
          this.vel[1] = JUMP_V;
          this.onGround = false;
        }
      }

      this.onGround = false;
      this.moveAxis(1, this.vel[1] * dt);
      this.moveAxis(0, this.vel[0] * dt);
      this.moveAxis(2, this.vel[2] * dt);
      if (this.pos[1] < -20) {
        this.pos[0] = this.world.spawn.x;
        this.pos[1] = this.world.spawn.y + 4;
        this.pos[2] = this.world.spawn.z;
        this.vel[0] = this.vel[1] = this.vel[2] = 0;
      }

      const hs = Math.hypot(this.vel[0], this.vel[2]);
      const moving = this.onGround && hs > 0.6 && !this.flying;
      if (moving) this.bobPhase += dt * hs * 1.9;
      this.bobAmount += ((moving ? Math.min(1, hs / 4.4) : 0) - this.bobAmount) * Math.min(1, dt * 8);

      this.stepTimer -= dt;
      if (moving && this.stepTimer <= 0) {
        this.stepTimer = 0.36;
        this.wantStep = true;
      } else {
        this.wantStep = false;
      }
    }

    eye() {
      const bob = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
      this._eye[0] = this.pos[0];
      this._eye[1] = this.pos[1] + this.eyeH + bob;
      this._eye[2] = this.pos[2];
      return this._eye;
    }
  }

  function raycast(world, ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
    const tDeltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
    const tDeltaZ = dz === 0 ? Infinity : 1 / Math.abs(dz);
    let tMaxX = dx === 0 ? Infinity : (dx > 0 ? x + 1 - ox : ox - x) / Math.abs(dx);
    let tMaxY = dy === 0 ? Infinity : (dy > 0 ? y + 1 - oy : oy - y) / Math.abs(dy);
    let tMaxZ = dz === 0 ? Infinity : (dz > 0 ? z + 1 - oz : oz - z) / Math.abs(dz);

    const first = world.getBlock(x, y, z);
    if (first !== 0 && !MC.Block.isLiquid(first)) {
      return { x, y, z, nx: 0, ny: 1, nz: 0, id: first, t: 0 };
    }

    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 200; i++) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX;
        nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY;
        nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ;
        nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDist) break;
      const id = world.getBlock(x, y, z);
      if (id !== 0 && !MC.Block.isLiquid(id)) {
        return { x, y, z, nx, ny, nz, id, t };
      }
    }
    return null;
  }

  MC.Player = Player;
  MC.raycast = raycast;
})();

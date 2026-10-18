/* particles.js — 固定容量的 CPU 粒子池，WebGL2 点精灵单次绘制 */
(function () {
  'use strict';
  const MC = window.MC;
  const LIMIT = 512;
  const STRIDE = 12;

  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in float aSize;
layout(location=2) in vec4 aUV;
layout(location=3) in vec4 aColor;
uniform mat4 uVP;
uniform float uPointScale;
out vec4 vUV;
out vec4 vColor;
void main() {
  gl_Position = uVP * vec4(aPos, 1.0);
  gl_PointSize = clamp(aSize * uPointScale / max(0.05, gl_Position.w), 2.0, 24.0);
  vUV = aUV;
  vColor = aColor;
}`;
  const FS = `#version 300 es
precision mediump float;
in vec4 vUV;
in vec4 vColor;
uniform sampler2D uTex;
out vec4 fragColor;
void main() {
  vec2 uv = mix(vUV.xy, vUV.zw, gl_PointCoord.xy);
  vec4 texel = texture(uTex, uv);
  if (texel.a < 0.08) discard;
  fragColor = vec4(texel.rgb * vColor.rgb, texel.a * vColor.a);
}`;

  function program(gl) {
    function shader(type, source) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.deleteShader(vs); gl.deleteShader(fs);
    return p;
  }

  class Particles {
    constructor(renderer) {
      this.gl = renderer.gl;
      this.enabled = true;
      this.activeCount = 0;
      this.cursor = 0;
      this.pool = Array.from({ length: LIMIT }, () => ({ alive: false }));
      this.data = new Float32Array(LIMIT * STRIDE);
      const gl = this.gl;
      this.prog = program(gl);
      this.uVP = gl.getUniformLocation(this.prog, 'uVP');
      this.uPointScale = gl.getUniformLocation(this.prog, 'uPointScale');
      this.uTex = gl.getUniformLocation(this.prog, 'uTex');
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      const bytes = STRIDE * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, bytes, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, bytes, 16);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, bytes, 32);
      gl.bindVertexArray(null);
    }

    setEnabled(value) {
      this.enabled = !!value;
      if (!this.enabled) {
        for (const p of this.pool) p.alive = false;
        this.activeCount = 0;
      }
    }

    emit(x, y, z, vx, vy, vz, size, life, tile, r, g, b, gravity) {
      if (!this.enabled || this.activeCount >= LIMIT) return false;
      for (let n = 0; n < LIMIT; n++) {
        const i = (this.cursor + n) % LIMIT, p = this.pool[i];
        if (p.alive) continue;
        this.cursor = (i + 1) % LIMIT;
        p.alive = true;
        p.x = x; p.y = y; p.z = z;
        p.vx = vx; p.vy = vy; p.vz = vz;
        p.size = size; p.life = life; p.maxLife = life;
        p.gravity = gravity === undefined ? 1 : gravity;
        p.uv = MC.Atlas.uv(tile); p.r = r; p.g = g; p.b = b;
        this.activeCount++;
        return true;
      }
      return false;
    }

    burst(x, y, z, id, count, kind) {
      const block = MC.BLOCKS[id] || MC.BLOCKS[MC.Block.STONE];
      const tile = block.tex ? block.tex.side : MC.BLOCKS[MC.Block.STONE].tex.side;
      const splash = kind === 'water', hit = kind === 'hit', dust = kind === 'dust';
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 0.7 + Math.random() * 1.7;
        this.emit(x + (Math.random() - 0.5) * 0.6,
          y + (Math.random() - 0.5) * 0.5,
          z + (Math.random() - 0.5) * 0.6,
          Math.cos(a) * speed * (dust ? 0.25 : 1),
          dust ? 0.25 + Math.random() * 0.4 : splash ? 1.8 + Math.random() * 1.5 : 1.1 + Math.random() * 1.4,
          Math.sin(a) * speed * (dust ? 0.25 : 1),
          0.055 + Math.random() * 0.085, dust ? 0.25 : 0.35 + Math.random() * 0.45,
          tile, hit ? 1 : splash ? 0.68 : 1,
          hit ? 0.16 : splash ? 0.84 : 1,
          hit ? 0.16 : 1);
      }
    }

    update(dt, world) {
      if (!this.enabled || !this.activeCount) return;
      const step = Math.min(dt, 0.06);
      for (const p of this.pool) {
        if (!p.alive) continue;
        p.life -= step;
        p.vy -= 8.5 * step * (p.gravity === undefined ? 1 : p.gravity);
        p.x += p.vx * step; p.y += p.vy * step; p.z += p.vz * step;
        if (p.life <= 0 || p.y < 0 || MC.Block.isSolid(world.getBlock(
          Math.floor(p.x), Math.floor(p.y - p.size * 0.4), Math.floor(p.z)))) {
          p.alive = false;
          this.activeCount--;
        }
      }
    }

    render(renderer, cam) {
      if (!this.enabled || !this.activeCount) return;
      let count = 0;
      const data = this.data;
      for (const p of this.pool) {
        if (!p.alive) continue;
        const o = count * STRIDE, uv = p.uv;
        data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z;
        data[o + 3] = p.size;
        data[o + 4] = uv[0]; data[o + 5] = uv[1]; data[o + 6] = uv[2]; data[o + 7] = uv[3];
        data[o + 8] = p.r; data[o + 9] = p.g; data[o + 10] = p.b;
        data[o + 11] = Math.min(0.95, p.life / p.maxLife);
        count++;
      }
      const gl = this.gl;
      gl.useProgram(this.prog);
      gl.uniformMatrix4fv(this.uVP, false, renderer.vp);
      gl.uniform1f(this.uPointScale, renderer.canvas.height /
        (2 * Math.tan((cam.fov || 65) * Math.PI / 360)));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, renderer.texture);
      gl.uniform1i(this.uTex, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * STRIDE);
      gl.bindVertexArray(this.vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
  }

  MC.Particles = Particles;
})();

/* renderer.js — 原生 WebGL2 渲染器：区块批次 / 天空云层 / 方块高亮 / 手持方块 */
(function () {
  'use strict';
  const MC = window.MC;
  const UNDERWATER_FOG = [0.07, 0.29, 0.55];
  const SHADOW_SIZE = 2048;
  const DAY_LENGTH = 1200;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  function lightingAt(time) {
    const angle = Math.PI * (0.5 + 2 * (time / DAY_LENGTH));
    const sx = Math.cos(angle) * 0.94, sy = Math.sin(angle), sz = 0.30;
    const length = Math.hypot(sx, sy, sz);
    const sun = [sx / length, sy / length, sz / length];
    const height = sun[1];
    const day = smooth(-0.12, 0.22, height);
    const twilight = (1 - smooth(0.04, 0.42, Math.abs(height))) * smooth(-0.30, -0.06, height);
    const light = height >= 0 ? sun : sun.map(v => -v);
    const moon = smooth(0.0, 0.35, -height);
    const highSun = smooth(0.0, 0.55, height);
    const ambient = mix3([0.24, 0.29, 0.40], [0.70, 0.69, 0.65], day);
    const direct = mix3([0.22 * moon, 0.24 * moon, 0.32 * moon],
      [0.42, 0.40, 0.36], day * (0.35 + 0.65 * highSun));
    const warm = twilight * day;
    direct[0] += warm * 0.12;
    direct[1] -= warm * 0.11;
    direct[2] -= warm * 0.18;
    for (let i = 0; i < 3; i++) direct[i] = Math.max(0, direct[i]);
    const zenith = mix3([0.015, 0.025, 0.075], [0.46, 0.64, 0.85], day);
    const horizon = mix3([0.045, 0.075, 0.15], [0.68, 0.78, 0.86], day);
    horizon[0] += twilight * 0.27;
    horizon[1] += twilight * 0.075;
    horizon[2] -= twilight * 0.07;
    return { sun, light, day, twilight, ambient, direct, zenith, horizon,
      shadow: Math.abs(height) > 0.09 && (height > 0 || moon > 0.2) };
  }

  /* ---------------- 矩阵 ---------------- */
  const M4 = {
    create() { return new Float32Array(16); },
    identity(o) {
      o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
      o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
      o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
      o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
      return o;
    },
    perspective(o, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2);
      const nf = 1 / (near - far);
      o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
      o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
      o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1;
      o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0;
      return o;
    },
    ortho(o, l, r, b, t, n, f) {
      o[0] = 2 / (r - l); o[1] = 0; o[2] = 0; o[3] = 0;
      o[4] = 0; o[5] = 2 / (t - b); o[6] = 0; o[7] = 0;
      o[8] = 0; o[9] = 0; o[10] = -2 / (f - n); o[11] = 0;
      o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
      return o;
    },
    lookAt(o, eye, center, up) {
      let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
      let len = Math.hypot(zx, zy, zz) || 1;
      zx /= len; zy /= len; zz /= len;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      len = Math.hypot(xx, xy, xz) || 1;
      xx /= len; xy /= len; xz /= len;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
      o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
      o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      o[15] = 1;
      return o;
    },
    mul(o, a, b) {
      const t = M4._tmp;
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          t[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
      }
      for (let i = 0; i < 16; i++) o[i] = t[i];
      return o;
    },
    invert(o, a) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      const b00 = a00 * a11 - a01 * a10;
      const b01 = a00 * a12 - a02 * a10;
      const b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11;
      const b04 = a01 * a13 - a03 * a11;
      const b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30;
      const b07 = a20 * a32 - a22 * a30;
      const b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31;
      const b10 = a21 * a33 - a23 * a31;
      const b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return null;
      det = 1 / det;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },
    _tmp: new Float32Array(16)
  };

  function viewMatrix(out, cam) {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const rx = cy, ry = 0, rz = -sy;
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
    const ex = cam.x, ey = cam.y, ez = cam.z;
    // 注意：列主序 —— 每一「行」的 3 个分量分别写到 r、4+r、8+r
    out[0] = rx; out[4] = ry; out[8] = rz; out[3] = 0;
    out[1] = ux; out[5] = uy; out[9] = uz; out[7] = 0;
    out[2] = -fx; out[6] = -fy; out[10] = -fz; out[11] = 0;
    out[12] = -(rx * ex + ry * ey + rz * ez);
    out[13] = -(ux * ex + uy * ey + uz * ez);
    out[14] = (fx * ex + fy * ey + fz * ez);
    out[15] = 1;
    return out;
  }

  /* ---------------- 着色器 ---------------- */
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function makeProgram(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  const VS_MAIN = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aLight;
layout(location=3) in vec3 aNormal;
layout(location=4) in float aBlockLight;
uniform mat4 uVP;
uniform mat4 uModel;
uniform vec3 uCamPos;
out vec2 vUV;
out float vLight;
out float vDist;
out vec3 vWorld;
out vec3 vNormal;
out float vBlockLight;
flat out float vFarMaterial;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  gl_Position = uVP * wp;
  vUV = aUV;
  vLight = aLight;
  vDist = distance(wp.xyz, uCamPos);
  vWorld = wp.xyz;
  vNormal = mat3(uModel) * aNormal;
  vBlockLight = aBlockLight;
  vFarMaterial = aBlockLight;
}`;

  const FS_MAIN = `#version 300 es
precision mediump float;
in vec2 vUV;
in float vLight;
in float vDist;
in vec3 vWorld;
in vec3 vNormal;
in float vBlockLight;
flat in float vFarMaterial;
uniform sampler2D uTex;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlpha;
uniform mat4 uShadowVP;
uniform sampler2D uShadowMap;
uniform float uShadowTexel;
uniform float uShadowOn;
uniform vec3 uLightDir;
uniform vec3 uAmbient;
uniform vec3 uDirect;
uniform float uHitFlash;
uniform float uFlicker;
uniform float uMobLight;
uniform float uGlow;
uniform float uFarPass;
uniform sampler2D uNearMask;
uniform highp vec2 uNearOrigin;
uniform vec3 uFarTiles;
uniform float uAtlasGrid;
uniform highp vec3 uCamPos;
out vec4 fragColor;

float shadowAt(vec3 wp, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sp = uShadowVP * vec4(wp + n * 0.035, 1.0);
  vec3 p = sp.xyz / sp.w * 0.5 + 0.5;
  if (p.x < 0.002 || p.x > 0.998 || p.y < 0.002 || p.y > 0.998 || p.z < 0.0 || p.z > 1.0) return 1.0;
  float lit = 0.0;
  float bias = 0.00065 + (1.0 - max(dot(n, uLightDir), 0.0)) * 0.0009;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float d = texture(uShadowMap, p.xy + vec2(float(x), float(y)) * uShadowTexel * 1.25).r;
      lit += (p.z - bias > d) ? 0.0 : 1.0;
    }
  }
  return lit / 9.0;
}

vec3 farTexture(float tile, vec2 p) {
  vec2 origin = vec2(mod(tile, uAtlasGrid), floor(tile / uAtlasGrid));
  return texture(uTex, (origin + 0.015625 + fract(p * 0.125) * 0.96875) / uAtlasGrid).rgb;
}

void main() {
  // 已绘制的真实区块接管对应区域，远山不覆盖建筑、水面和挖出的洞穴。
  if (uFarPass > 0.5) {
    vec2 cell = floor(vWorld.xz / 16.0) - uNearOrigin;
    if (all(greaterThanEqual(cell, vec2(0.0))) && all(lessThan(cell, vec2(32.0))) &&
        texelFetch(uNearMask, ivec2(cell), 0).r > 0.5) discard;
  }
  vec4 c = uFarPass > 0.5 ? vec4(1.0) : texture(uTex, vUV);
  if (c.a < 0.02) discard;
  vec3 normal = normalize(vNormal);
  float sh = uFarPass > 0.5 ? 1.0 : shadowAt(vWorld, normal);
  float diffuse = 0.44 + 0.56 * max(dot(normal, uLightDir), 0.0);
  vec3 sun = uAmbient + uDirect * diffuse * mix(0.12, 1.0, sh);
  vec3 torch = vec3(1.14, 0.79, 0.44) * max(vBlockLight, uMobLight) * uFlicker;
  vec3 surface = c.rgb;
  if (uFarPass > 0.5) {
    if (vFarMaterial < -3.5) surface = vec3(0.92, 0.95, 0.96);
    else if (vFarMaterial < -2.5) surface = vec3(0.65, 0.38, 0.27);
    else if (vFarMaterial < -1.5) surface = vec3(0.83, 0.76, 0.53);
    else if (vFarMaterial < -0.5) surface = vec3(0.35, 0.62, 0.75);
    else if (vWorld.y > 31.0) {
      // 远景复用像素图集，以世界坐标贴图，移动时纹理不会跟着镜头滑动。
      float steep = smoothstep(0.10, 0.47, 1.0 - normal.y);
      vec2 plane = vWorld.xz;
      if (steep > 0.6) plane = abs(normal.x) > abs(normal.z) ? vWorld.zy : vWorld.xy;
      float rock = max(steep, smoothstep(58.0, 70.0, vWorld.y));
      surface = mix(farTexture(uFarTiles.x, plane), farTexture(uFarTiles.y, plane), rock);
      float snowPatch = sin(floor(vWorld.x * 0.25) * 1.7 + floor(vWorld.z * 0.25) * 2.3);
      float snow = smoothstep(77.0, 89.0, vWorld.y + snowPatch * 4.0) * (1.0 - steep * 0.65);
      surface = mix(surface, farTexture(uFarTiles.z, plane), snow);
    }
  }
  vec3 col = surface * vLight * max(sun, torch);
  float f = smoothstep(uFogNear, uFogFar, vDist);
  col = mix(col, uFogColor, f);
  col = mix(col, vec3(1.0, 0.18, 0.18), uHitFlash * 0.72);
  col = mix(col, vec3(0.72, 0.84, 1.0), uGlow * 0.42);
  fragColor = vec4(col, c.a * uAlpha);
}`;

  const VS_SKY = `#version 300 es
layout(location=0) in vec2 aNdc;
uniform mat4 uInvVP;
uniform vec3 uCam;
out vec3 vDir;
void main() {
  vec4 p = uInvVP * vec4(aNdc, 1.0, 1.0);
  vDir = p.xyz / p.w - uCam;
  gl_Position = vec4(aNdc, 1.0, 1.0);
}`;

  const FS_SKY = `#version 300 es
precision highp float;
in vec3 vDir;
uniform float uTime;
uniform float uCloudY;
uniform vec3 uCam;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uDay;
uniform float uTwilight;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float cloudMask(vec2 worldXZ) {
  vec2 p = worldXZ * 0.038;
  float mass = vnoise(p * 0.75 + 3.7);
  float detail = vnoise(p * 2.1 + 19.3);
  float wisps = vnoise(p * 4.6 + 41.8);
  return smoothstep(0.49, 0.60, mass * 0.73 + detail * 0.23 + wisps * 0.04);
}
void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.65));
  if (h < 0.0) col = mix(uHorizon, uHorizon * 0.78, clamp(-h * 3.0, 0.0, 1.0));

  float sd = max(dot(dir, uSunDir), 0.0);
  float sunVisible = smoothstep(-0.10, 0.05, uSunDir.y);
  col += vec3(1.0, 0.80, 0.52) * pow(sd, 24.0) * (0.12 + uTwilight * 0.28) * sunVisible;
  col += vec3(1.0, 0.94, 0.76) * smoothstep(0.99965, 0.99986, sd) * 0.95 * sunVisible;

  float night = (1.0 - uDay) * smoothstep(0.05, 0.25, h);
  vec2 starCoord = vec2(atan(dir.z, dir.x), asin(clamp(h, -1.0, 1.0))) * 115.0;
  vec2 starCell = floor(starCoord);
  float starSeed = hash21(starCell);
  float star = step(0.995, starSeed) * (1.0 - smoothstep(0.08, 0.22, length(fract(starCoord) - 0.5)));
  col += vec3(0.75, 0.85, 1.0) * star * night * 0.85;
  float md = max(dot(dir, -uSunDir), 0.0);
  float moonVisible = smoothstep(-0.08, 0.08, -uSunDir.y) * (1.0 - uDay);
  col += vec3(0.52, 0.65, 0.89) * pow(md, 80.0) * 0.18 * moonVisible;
  col += vec3(0.82, 0.88, 1.0) * smoothstep(0.9995, 0.9998, md) * 0.80 * moonVisible;

  if (abs(h) > 0.025) {
    float tBottom = (uCloudY - uCam.y) / h;
    float tTop = (uCloudY + 0.8 - uCam.y) / h;
    float tNear = max(0.0, min(tBottom, tTop));
    float tFar = max(tBottom, tTop);
    if (tFar > 0.0 && tNear < 720.0) {
      vec2 wind = vec2(uTime * 0.38, uTime * 0.11);
      float face = cloudMask(uCam.xz + dir.xz * tNear + wind);
      float farFace = cloudMask(uCam.xz + dir.xz * tFar + wind);
      float side = max(farFace - face, 0.0);
      float above = step(uCloudY + 0.8, uCam.y);
      vec3 underside = mix(vec3(0.13, 0.17, 0.28), vec3(0.62, 0.69, 0.81), uDay);
      vec3 topFace = mix(vec3(0.21, 0.26, 0.37), vec3(0.89, 0.93, 0.98), uDay);
      vec3 sideFace = mix(vec3(0.17, 0.21, 0.32), vec3(0.77, 0.83, 0.92), uDay);
      vec3 cloud = mix(sideFace, mix(underside, topFace, above), face);
      cloud = mix(cloud, vec3(0.94, 0.70, 0.59), uTwilight * 0.25);
      float fade = 1.0 - smoothstep(420.0, 720.0, tNear);
      col = mix(col, cloud, max(face, side) * fade);
    }
  }
  fragColor = vec4(col, 1.0);
}`;

  const VS_MIST = `#version 300 es
layout(location=0) in vec2 aNdc;
uniform mat4 uVP;
uniform vec3 uCenter;
uniform vec3 uRight;
uniform float uRadius;
uniform float uHeight;
uniform float uVertical;
out vec2 vWorldXZ;
out vec2 vLocal;
void main() {
  vLocal = aNdc;
  vec3 p = uVertical > 0.5 ?
    uCenter + aNdc.x * uRight * uRadius + vec3(0.0, aNdc.y * uHeight, 0.0) :
    vec3(uCenter.x + aNdc.x * uRadius, uHeight, uCenter.z + aNdc.y * uRadius);
  vWorldXZ = p.xz;
  gl_Position = uVP * vec4(p, 1.0);
}`;

  const FS_MIST = `#version 300 es
precision highp float;
in vec2 vWorldXZ;
in vec2 vLocal;
uniform float uTime;
uniform float uDay;
uniform float uTwilight;
uniform float uStrength;
uniform float uVertical;
out vec4 fragColor;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
}
void main() {
  vec2 wind = vec2(uTime * 0.014, uTime * 0.006);
  float broad = noise2(vWorldXZ * 0.025 + wind);
  float detail = noise2(vWorldXZ * 0.075 - wind * 1.7 + vLocal.y * vec2(0.8, -1.3));
  float cloud = uVertical > 0.5 ?
    mix(0.42, 1.0, smoothstep(0.18, 0.78, broad * 0.65 + detail * 0.35)) :
    smoothstep(0.37, 0.66, broad * 0.7 + detail * 0.3);
  vec2 warped = vLocal + vec2(0.0, sin(vLocal.x * 3.5 + broad * 4.0 + uTime * 0.03) * 0.10);
  float edge = 1.0 - smoothstep(uVertical > 0.5 ? 0.45 : 0.64,
    uVertical > 0.5 ? 1.03 : 0.99, length(warped));
  float alpha = uStrength * cloud * edge;
  if (alpha < 0.01) discard;
  vec3 shade = mix(vec3(0.49, 0.60, 0.77), vec3(0.88, 0.93, 1.0), uDay);
  shade = mix(shade, vec3(1.0, 0.78, 0.70), uTwilight * 0.30);
  shade += uDay * smoothstep(-0.6, 0.9, vLocal.y) * 0.045;
  fragColor = vec4(shade, alpha);
}`;

  const VS_SHADOW = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
uniform mat4 uLightVP;
uniform mat4 uModel;
out vec2 vUV;
void main() {
  gl_Position = uLightVP * (uModel * vec4(aPos, 1.0));
  vUV = aUV;
}`;

  const FS_SHADOW = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 fragColor;
void main() {
  if (texture(uTex, vUV).a < 0.1) discard;
  fragColor = vec4(1.0);
}`;

  const VS_LINE = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
uniform vec3 uOffset;
uniform float uScale;
uniform vec4 uColor;
out vec4 vColor;
void main() {
  gl_Position = uVP * vec4(aPos * uScale + uOffset, 1.0);
  vColor = uColor;
}`;

  const FS_LINE = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 fragColor;
void main() { fragColor = vColor; }`;

  /* ---------------- 生物盒子 ---------------- */
  const MOB_FACES = [
    { n: [1, 0, 0], v: [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]], uv: [[0, 1], [0, 0], [1, 0], [1, 1]], shade: 0.84, key: 'side' },
    { n: [-1, 0, 0], v: [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]], uv: [[0, 1], [0, 0], [1, 0], [1, 1]], shade: 0.84, key: 'side' },
    { n: [0, 1, 0], v: [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]], shade: 1.0, key: 'top' },
    { n: [0, -1, 0], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], shade: 0.58, key: 'bottom' },
    { n: [0, 0, 1], v: [[0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, -0.5, 0.5]], uv: [[0, 1], [0, 0], [1, 0], [1, 1]], shade: 0.92, key: 'side' },
    { n: [0, 0, -1], v: [[-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, -0.5, -0.5]], uv: [[0, 1], [0, 0], [1, 0], [1, 1]], shade: 0.92, key: 'front' }
  ];

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', {
        antialias: false, alpha: false, depth: true, stencil: false,
        powerPreference: 'high-performance', preserveDrawingBuffer: false
      });
      if (!gl) throw new Error('当前浏览器不支持 WebGL2');
      this.gl = gl;

      this.progMain = makeProgram(gl, VS_MAIN, FS_MAIN);
      this.progSky = makeProgram(gl, VS_SKY, FS_SKY);
      this.progMist = makeProgram(gl, VS_MIST, FS_MIST);
      this.progLine = makeProgram(gl, VS_LINE, FS_LINE);
      this.progShadow = makeProgram(gl, VS_SHADOW, FS_SHADOW);
      this.uShadowProg = this.uniforms(this.progShadow, ['uLightVP', 'uModel', 'uTex']);

      this.uMain = this.uniforms(this.progMain, ['uVP', 'uModel', 'uCamPos', 'uTex', 'uFogColor', 'uFogNear', 'uFogFar', 'uAlpha', 'uShadowVP', 'uShadowMap', 'uShadowTexel', 'uShadowOn', 'uLightDir', 'uAmbient', 'uDirect', 'uHitFlash', 'uFlicker', 'uMobLight', 'uGlow', 'uFarPass', 'uNearMask', 'uNearOrigin', 'uFarTiles', 'uAtlasGrid']);
      this.uSky = this.uniforms(this.progSky, ['uInvVP', 'uCam', 'uTime', 'uCloudY', 'uSunDir', 'uZenith', 'uHorizon', 'uDay', 'uTwilight']);
      this.uMist = this.uniforms(this.progMist, ['uVP', 'uCenter', 'uRight', 'uRadius', 'uHeight', 'uVertical', 'uTime', 'uDay', 'uTwilight', 'uStrength']);
      this.uLine = this.uniforms(this.progLine, ['uVP', 'uOffset', 'uScale', 'uColor']);

      this.texture = this.makeTexture();
      this.resolutionScale = 1;
      this.nearMask = new Uint8Array(32 * 32);
      this.previousNearMask = new Uint8Array(32 * 32);
      this.nearMaskTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.nearMaskTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 32, 32, 0, gl.RED, gl.UNSIGNED_BYTE, this.nearMask);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // 天空全屏四边形
      this.skyVAO = gl.createVertexArray();
      gl.bindVertexArray(this.skyVAO);
      const skyBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      // 高亮线框（单位立方体 12 条边）
      this.lineVAO = gl.createVertexArray();
      gl.bindVertexArray(this.lineVAO);
      const lineBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(UNIT_EDGES), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      // 阴影贴图
      this.shadowEnabled = true;
      this.shadowSize = SHADOW_SIZE;
      this.shadowTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.shadowFBO = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) console.warn('shadow FBO incomplete', fbStatus);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this.lightView = M4.create();
      this.lightProj = M4.create();
      this.lightVP = M4.create();

      this.view = M4.create();
      this.proj = M4.create();
      this.vp = M4.create();
      this.invVP = M4.create();
      this.identity = M4.identity(M4.create());
      this.viewModel = new MC.ViewModel(this);

      this.fog = [0.60, 0.79, 0.97];
      this.fogNear = 70;
      this.fogFar = 130;
      this.mobCache = new Map();
      this.mistWorld = null;
      this.mistLayout = [];
      this.planes = [];
      for (let i = 0; i < 6; i++) this.planes.push(new Float32Array(4));
      this.shadowPlanes = [];
      for (let i = 0; i < 6; i++) this.shadowPlanes.push(new Float32Array(4));
      this.stats = { drawn: 0, faces: 0 };
      this._t = 0;

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      gl.clearColor(this.fog[0], this.fog[1], this.fog[2], 1);
    }

    uniforms(prog, names) {
      const gl = this.gl, out = {};
      for (const n of names) out[n] = gl.getUniformLocation(prog, n);
      return out;
    }

    makeTexture() {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, MC.Atlas.canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }

    updateNearMask(chunks, cam) {
      const gl = this.gl;
      const x = Math.floor(cam.x / 16) - 16, z = Math.floor(cam.z / 16) - 16;
      this.nearMask.fill(0);
      for (const chunk of chunks) {
        const cx = chunk.cx - x, cz = chunk.cz - z;
        if (chunk.gpu && cx >= 0 && cx < 32 && cz >= 0 && cz < 32)
          this.nearMask[cz * 32 + cx] = 255;
      }
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.nearMaskTexture);
      // 位图只有 1KB，内容发生变化时才上传。
      for (let i = 0; i < this.nearMask.length; i++) if (this.nearMask[i] !== this.previousNearMask[i]) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 32, 32, gl.RED, gl.UNSIGNED_BYTE, this.nearMask);
        this.previousNearMask.set(this.nearMask);
        break;
      }
      gl.uniform1i(this.uMain.uNearMask, 2);
      gl.uniform2f(this.uMain.uNearOrigin, x, z);
      gl.activeTexture(gl.TEXTURE0);
    }

    resize() {
      const c = this.canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.resolutionScale;
      const w = Math.max(1, Math.floor(c.clientWidth * dpr));
      const h = Math.max(1, Math.floor(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        return true;
      }
      return false;
    }

    /* ---------- 生物立方体缓存 ---------- */
    getMobCube(tiles) {
      const front = tiles.front === undefined ? -1 : tiles.front;
      const key = tiles.top + ',' + tiles.side + ',' + tiles.bottom + ',' + front;
      if (this.mobCache.has(key)) return this.mobCache.get(key);
      const verts = [], idx = [];
      for (const F of MOB_FACES) {
        const t = (F.key === 'front' && front >= 0) ? front :
                  (F.key === 'top' ? tiles.top : F.key === 'bottom' ? tiles.bottom : tiles.side);
        const uv = MC.Atlas.uv(t);
        const du = uv[2] - uv[0], dv = uv[3] - uv[1];
        const base = verts.length / 10;
        for (let k = 0; k < 4; k++) {
          verts.push(F.v[k][0], F.v[k][1], F.v[k][2],
            uv[0] + F.uv[k][0] * du, uv[1] + F.uv[k][1] * dv, F.shade,
            F.n[0], F.n[1], F.n[2], 0);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const mesh = this.makeMesh({ verts: new Float32Array(verts), idx: new Uint32Array(idx) });
      this.mobCache.set(key, mesh);
      return mesh;
    }

    /* ---------- 区块 GPU 资源 ---------- */
    makeMesh(data) {
      if (!data || data.idx.length === 0) return null;
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data.verts, gl.STATIC_DRAW);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.idx, gl.STATIC_DRAW);
      const stride = 40;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 24);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 36);
      gl.bindVertexArray(null);
      return { vao, vbo, ibo, count: data.idx.length };
    }

    disposeMesh(m) {
      if (!m) return;
      const gl = this.gl;
      gl.deleteVertexArray(m.vao);
      gl.deleteBuffer(m.vbo);
      gl.deleteBuffer(m.ibo);
    }

    uploadChunk(chunk, mesh) {
      this.disposeChunk(chunk);
      chunk.gpu = {
        opaque: this.makeMesh(mesh.opaque),
        transparent: this.makeMesh(mesh.transparent)
      };
      chunk.faces = mesh.faces;
    }

    disposeChunk(chunk) {
      if (!chunk.gpu) return;
      this.disposeMesh(chunk.gpu.opaque);
      this.disposeMesh(chunk.gpu.transparent);
      chunk.gpu = null;
    }

    /* ---------- 视锥 ---------- */
    setFrustum(m, p = this.planes) {
      const rows = [
        [m[0], m[4], m[8], m[12]],
        [m[1], m[5], m[9], m[13]],
        [m[2], m[6], m[10], m[14]],
        [m[3], m[7], m[11], m[15]]
      ];
      const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];
      const set = (dst, a, b, sign) => {
        dst[0] = a[0] + sign * b[0];
        dst[1] = a[1] + sign * b[1];
        dst[2] = a[2] + sign * b[2];
        dst[3] = a[3] + sign * b[3];
        const len = Math.hypot(dst[0], dst[1], dst[2]) || 1;
        dst[0] /= len; dst[1] /= len; dst[2] /= len; dst[3] /= len;
      };
      set(p[0], r3, r0, 1);   // left
      set(p[1], r3, r0, -1);  // right
      set(p[2], r3, r1, 1);   // bottom
      set(p[3], r3, r1, -1);  // top
      set(p[4], r3, r2, 1);   // near
      set(p[5], r3, r2, -1);  // far
    }

    boxVisible(minX, minY, minZ, maxX, maxY, maxZ, p = this.planes) {
      for (let i = 0; i < 6; i++) {
        const pl = p[i];
        const x = pl[0] > 0 ? maxX : minX;
        const y = pl[1] > 0 ? maxY : minY;
        const z = pl[2] > 0 ? maxZ : minZ;
        if (pl[0] * x + pl[1] * y + pl[2] * z + pl[3] < 0) return false;
      }
      return true;
    }

    /* ---------- 阴影贴图 ---------- */
    renderShadow(chunks, mobBoxes, cam, lightDir) {
      const gl = this.gl;
      const cx = cam.x, cy = cam.y - 1, cz = cam.z;
      const eye = [cx + lightDir[0] * 90, cy + lightDir[1] * 90, cz + lightDir[2] * 90];
      M4.lookAt(this.lightView, eye, [cx, cy, cz], [0, 1, 0]);
      M4.ortho(this.lightProj, -48, 48, -48, 48, 1, 210);
      M4.mul(this.lightVP, this.lightProj, this.lightView);
      // 把投影原点吸附到阴影纹素，移动镜头时减少阴影边缘抖动。
      const ox = this.lightVP[12] * SHADOW_SIZE * 0.5;
      const oy = this.lightVP[13] * SHADOW_SIZE * 0.5;
      this.lightProj[12] += (Math.round(ox) - ox) * 2 / SHADOW_SIZE;
      this.lightProj[13] += (Math.round(oy) - oy) * 2 / SHADOW_SIZE;
      M4.mul(this.lightVP, this.lightProj, this.lightView);
      this.setFrustum(this.lightVP, this.shadowPlanes);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.progShadow);
      gl.uniformMatrix4fv(this.uShadowProg.uLightVP, false, this.lightVP);
      gl.uniformMatrix4fv(this.uShadowProg.uModel, false, this.identity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(this.uShadowProg.uTex, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.0, 1.0);

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if (!c.gpu || !c.gpu.opaque) continue;
        if (Math.abs(c.cx * 16 + 8 - cam.x) > 72 || Math.abs(c.cz * 16 + 8 - cam.z) > 72) continue;
        if (!this.boxVisible(c.cx * 16, 0, c.cz * 16,
          c.cx * 16 + 16, MC.WORLD.HEIGHT, c.cz * 16 + 16, this.shadowPlanes)) continue;
        gl.bindVertexArray(c.gpu.opaque.vao);
        gl.drawElements(gl.TRIANGLES, c.gpu.opaque.count, gl.UNSIGNED_INT, 0);
      }
      if (mobBoxes) {
        for (let i = 0; i < mobBoxes.length; i++) {
          const b = mobBoxes[i];
          const cube = this.getMobCube(b.tiles);
          if (!cube) continue;
          gl.uniformMatrix4fv(this.uShadowProg.uModel, false, b.m);
          gl.bindVertexArray(cube.vao);
          gl.drawElements(gl.TRIANGLES, cube.count, gl.UNSIGNED_INT, 0);
        }
        gl.uniformMatrix4fv(this.uShadowProg.uModel, false, this.identity);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    buildMistLayout(world) {
      const layout = [];
      if (!world.peaks || !world.heightAt) return layout;
      const seed = world.seed || 0;
      const rand = (n) => {
        const v = Math.sin(n * 127.1 + seed * 0.00013) * 43758.5453;
        return v - Math.floor(v);
      };
      for (let peakIndex = 0; peakIndex < world.peaks.length; peakIndex++) {
        const peak = world.peaks[peakIndex];
        const cx = peak[0], cz = peak[1];
        const summit = world.heightAt(Math.round(cx), Math.round(cz));
        const baseRadius = Math.min(peak[2], peak[3]);
        for (let ring = 0; ring < 1; ring++) {
          const count = 8;
          for (let j = 0; j < count; j++) {
            const key = peakIndex * 100 + ring * 37 + j;
            if (rand(key + 13) < (ring ? 0.20 : 0.10)) continue;
            const angle = (j + ring * 0.31) * Math.PI * 2 / count +
              (rand(key + 29) - 0.5) * 0.27;
            const r = baseRadius * 0.72 + (rand(key + 43) - 0.5) * 13;
            const x = cx + Math.cos(angle) * r;
            const z = cz + Math.sin(angle) * r;
            const halfWidth = 12 + rand(key + 59) * 13;
            const wisp = rand(key + 73) < 0.22;
            const halfHeight = (7 + rand(key + 83) * 7) * (wisp ? 0.60 : 1);
            const ground = world.heightAt(Math.round(x), Math.round(z));
            const y = Math.max(summit - (ring ? 54 : 42) + (rand(key + 97) - 0.5) * 15,
              ground + halfHeight * 0.68);
            layout.push({ x, y, z, peakX: cx, peakZ: cz, vertical: true,
              radius: halfWidth * (wisp ? 1.3 : 1), halfHeight,
              strength: (0.16 + rand(key + 109) * 0.12) * (wisp ? 0.72 : 1),
              phase: rand(key + 127) * Math.PI * 2 });
          }
        }
      }
      return layout;
    }

    /* ---------- 帧渲染 ---------- */
    render(world, cam, chunks, hit, time, mobBoxes, hand, particles) {
      const gl = this.gl;
      this.resize();
      const W = this.canvas.width, H = this.canvas.height;
      gl.viewport(0, 0, W, H);

      const aspect = W / H;
      M4.perspective(this.proj, (cam.fov || 65) * Math.PI / 180, aspect, 0.08, 820);
      viewMatrix(this.view, cam);
      M4.mul(this.vp, this.proj, this.view);
      M4.invert(this.invVP, this.vp);
      this.setFrustum(this.vp);

      // 雾随视距；水下换成短距离蓝雾
      const under = !!cam.underwater;
      const nether = !!cam.nether;
      const light = lightingAt(time);
      if (nether) {
        light.ambient = [0.50, 0.31, 0.31];
        light.direct = [0.16, 0.09, 0.07];
        light.horizon = [0.26, 0.065, 0.075];
        light.shadow = false;
      }
      const fogCol = under ? UNDERWATER_FOG : light.horizon;
      const fogFar = under ? 20 : (cam.fogFar || 130);
      this.fogNear = under ? 0.8 : fogFar * 0.68;
      this.fogFar = fogFar;

      const shadowActive = this.shadowEnabled && light.shadow && !under;
      if (shadowActive) this.renderShadow(chunks, mobBoxes, cam, light.light);
      gl.viewport(0, 0, W, H);

      gl.clearColor(fogCol[0], fogCol[1], fogCol[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      /* --- 不透明区块 --- */
      gl.useProgram(this.progMain);
      const u = this.uMain;
      gl.uniformMatrix4fv(u.uVP, false, this.vp);
      gl.uniformMatrix4fv(u.uModel, false, this.identity);
      gl.uniform3f(u.uCamPos, cam.x, cam.y, cam.z);
      gl.uniform3f(u.uFogColor, fogCol[0], fogCol[1], fogCol[2]);
      gl.uniform1f(u.uFogNear, this.fogNear);
      gl.uniform1f(u.uFogFar, this.fogFar);
      gl.uniform1f(u.uAlpha, 1);
      gl.uniform1f(u.uHitFlash, 0);
      gl.uniform1f(u.uFlicker, 0.97 + 0.03 * Math.sin(time * 19.7));
      gl.uniform1f(u.uMobLight, 0);
      gl.uniform1f(u.uFarPass, 0);
      gl.uniform3fv(u.uLightDir, light.light);
      gl.uniform3fv(u.uAmbient, under ? [0.29, 0.47, 0.60] : light.ambient);
      gl.uniform3fv(u.uDirect, under ? [0.08, 0.11, 0.14] : light.direct);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(u.uTex, 0);
      gl.uniformMatrix4fv(u.uShadowVP, false, this.lightVP);
      gl.uniform1f(u.uShadowTexel, 1 / this.shadowSize);
      gl.uniform1f(u.uShadowOn, shadowActive ? 1 : 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.uniform1i(u.uShadowMap, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.disable(gl.BLEND);

      let faces = 0, drawn = 0;
      const transparent = [];
      if (!under && !nether && this.horizonMesh) {
        this.updateNearMask(chunks, cam);
        gl.uniform3f(u.uFarTiles, MC.BLOCKS[MC.Block.GRASS].tex.top,
          MC.BLOCKS[MC.Block.STONE].tex.top, MC.BLOCKS[MC.Block.SNOW].tex.top);
        gl.uniform1f(u.uAtlasGrid, MC.Atlas.grid);
        gl.uniform1f(u.uFarPass, 1);
        gl.uniform1f(u.uShadowOn, 0);
        gl.bindVertexArray(this.horizonMesh.vao);
        gl.drawElements(gl.TRIANGLES, this.horizonMesh.count, gl.UNSIGNED_INT, 0);
        gl.uniform1f(u.uFarPass, 0);
        gl.uniform1f(u.uShadowOn, shadowActive ? 1 : 0);
        drawn++;
      }
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if (!c.gpu) continue;
        const bx = c.cx * 16, bz = c.cz * 16;
        if (!this.boxVisible(bx, 0, bz, bx + 16, MC.WORLD.HEIGHT, bz + 16)) continue;
        if (c.gpu.opaque) {
          gl.bindVertexArray(c.gpu.opaque.vao);
          gl.drawElements(gl.TRIANGLES, c.gpu.opaque.count, gl.UNSIGNED_INT, 0);
          drawn++;
        }
        if (c.gpu.transparent) transparent.push(c);
        faces += c.faces;
      }

      /* --- 生物 --- */
      if (mobBoxes && mobBoxes.length) {
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        for (let i = 0; i < mobBoxes.length; i++) {
          const b = mobBoxes[i];
          const cube = this.getMobCube(b.tiles);
          if (!cube) continue;
          gl.uniform1f(u.uHitFlash, b.flash || 0);
          gl.uniform1f(u.uGlow, b.glow || 0);
          gl.uniform1f(u.uMobLight, world.getLight(
            Math.floor(b.m[12]), Math.floor(b.m[13]), Math.floor(b.m[14])) / 14);
          gl.uniformMatrix4fv(u.uModel, false, b.m);
          gl.bindVertexArray(cube.vao);
          gl.drawElements(gl.TRIANGLES, cube.count, gl.UNSIGNED_INT, 0);
          drawn++;
        }
        gl.uniformMatrix4fv(u.uModel, false, this.identity);
        gl.uniform1f(u.uHitFlash, 0);
        gl.uniform1f(u.uGlow, 0);
        gl.uniform1f(u.uMobLight, 0);
      }

      /* --- 天空只填没有地形的像素，避免被山体覆盖的云仍全屏计算。 --- */
      if (!under && !nether) {
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        gl.useProgram(this.progSky);
        gl.uniformMatrix4fv(this.uSky.uInvVP, false, this.invVP);
        gl.uniform3f(this.uSky.uCam, cam.x, cam.y, cam.z);
        gl.uniform1f(this.uSky.uTime, time);
        gl.uniform1f(this.uSky.uCloudY, 160);
        gl.uniform3fv(this.uSky.uSunDir, light.sun);
        gl.uniform3fv(this.uSky.uZenith, light.zenith);
        gl.uniform3fv(this.uSky.uHorizon, light.horizon);
        gl.uniform1f(this.uSky.uDay, light.day);
        gl.uniform1f(this.uSky.uTwilight, light.twilight);
        gl.bindVertexArray(this.skyVAO);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.depthMask(true);
        gl.depthFunc(gl.LESS);
        gl.enable(gl.CULL_FACE);
        gl.useProgram(this.progMain);
      }

      /* --- 透明区块（远到近） --- */
      if (transparent.length) {
        const cx = cam.x, cz = cam.z;
        transparent.sort((a, b) => {
          const ax = a.cx * 16 + 8 - cx, az = a.cz * 16 + 8 - cz;
          const bx = b.cx * 16 + 8 - cx, bz = b.cz * 16 + 8 - cz;
          return (bx * bx + bz * bz) - (ax * ax + az * az);
        });
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);           // 水面/玻璃双面可见
        for (const c of transparent) {
          gl.bindVertexArray(c.gpu.transparent.vao);
          gl.drawElements(gl.TRIANGLES, c.gpu.transparent.count, gl.UNSIGNED_INT, 0);
          drawn++;
        }
        gl.enable(gl.CULL_FACE);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      /* --- Snowy mountain waist: visible side-facing cloud banks --- */
      if (!under && world.peaks) {
        if (this.mistWorld !== world) {
          this.mistWorld = world;
          this.mistLayout = this.buildMistLayout(world);
        }
        const layers = [];
        for (const bank of this.mistLayout) {
          if (Math.hypot(cam.x - bank.peakX, cam.z - bank.peakZ) > this.fogFar + 120) continue;
          const x = bank.x + (bank.vertical ? Math.sin(time * 0.047 + bank.phase) * 2.5 : 0);
          const z = bank.z + (bank.vertical ? Math.cos(time * 0.039 + bank.phase) * 1.8 : 0);
          const y = bank.y + (bank.vertical ? Math.sin(time * 0.071 + bank.phase) * 0.7 : 0);
          const distance = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
          if (distance > this.fogFar + (bank.vertical ? 22 : bank.radius)) continue;
          const towardX = cam.x - x, towardZ = cam.z - z;
          const towardLength = Math.hypot(towardX, towardZ) || 1;
          layers.push({ ...bank, x, y, z, distance,
            rightX: towardZ / towardLength, rightZ: -towardX / towardLength,
            strength: bank.strength * (1 - smooth(this.fogFar * 0.86, this.fogFar + 24, distance) * 0.55) });
        }
        if (layers.length) {
          layers.sort((a, b) => b.distance - a.distance);
          gl.useProgram(this.progMist);
          gl.uniformMatrix4fv(this.uMist.uVP, false, this.vp);
          gl.uniform1f(this.uMist.uTime, time);
          gl.uniform1f(this.uMist.uDay, light.day);
          gl.uniform1f(this.uMist.uTwilight, light.twilight);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
          gl.disable(gl.CULL_FACE);
          gl.bindVertexArray(this.skyVAO);
          for (const layer of layers) {
            gl.uniform3f(this.uMist.uCenter, layer.x, layer.y, layer.z);
            gl.uniform3f(this.uMist.uRight, layer.vertical ? layer.rightX : 1, 0,
              layer.vertical ? layer.rightZ : 0);
            gl.uniform1f(this.uMist.uRadius, layer.radius);
            gl.uniform1f(this.uMist.uHeight, layer.halfHeight);
            gl.uniform1f(this.uMist.uVertical, layer.vertical ? 1 : 0);
            gl.uniform1f(this.uMist.uStrength, layer.strength);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          }
          gl.enable(gl.CULL_FACE);
          gl.depthMask(true);
          gl.disable(gl.BLEND);
        }
      }

      /* --- 粒子与地形共用深度，只提交一次点精灵批次 --- */
      if (particles) particles.render(this, cam);

      /* --- 选中方块线框 --- */
      if (hit) {
        gl.useProgram(this.progLine);
        gl.uniformMatrix4fv(this.uLine.uVP, false, this.vp);
        gl.uniform3f(this.uLine.uOffset, hit.x - 0.002, hit.y - 0.002, hit.z - 0.002);
        gl.uniform1f(this.uLine.uScale, 1.006);
        gl.uniform4f(this.uLine.uColor, 0.96, 1.0, 0.92, 0.5);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(this.lineVAO);
        gl.drawArrays(gl.LINES, 0, 24);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);

      // 手臂使用独立投影与深度，贴近墙面时也不会被世界几何截断。
      if (hand) this.viewModel.render(hand, aspect, light, under);

      this.stats.drawn = drawn;
      this.stats.faces = faces;
      this._t = time;
    }
  }

  const UNIT_EDGES = (() => {
    const p = [
      [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
      [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]
    ];
    const e = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    const out = [];
    for (const [a, b] of e) out.push(p[a][0], p[a][1], p[a][2], p[b][0], p[b][1], p[b][2]);
    return out;
  })();

  MC.Renderer = Renderer;
  MC.M4 = M4;
  MC.DAY_LENGTH = DAY_LENGTH;
  MC.lightingAt = lightingAt;
})();

/* mesher.js — 区块网格化：面剔除 + 环境光遮蔽 + 天空深度变暗 */
(function () {
  'use strict';
  const MC = window.MC;

  const AO = [0.78, 0.89, 0.96, 1.0];

  const FACES = [
    { n: [1, 0, 0], verts: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uvs: [[0, 1], [0, 0], [1, 0], [1, 1]], shade: 0.84, key: 'side' },
    { n: [-1, 0, 0], verts: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uvs: [[0, 1], [0, 0], [1, 0], [1, 1]], shade: 0.84, key: 'side' },
    { n: [0, 1, 0], verts: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uvs: [[0, 0], [0, 1], [1, 1], [1, 0]], shade: 1.0, key: 'top', ky: 1 },
    { n: [0, -1, 0], verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], shade: 0.56, key: 'bottom', ky: -1 },
    { n: [0, 0, 1], verts: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], uvs: [[0, 1], [0, 0], [1, 0], [1, 1]], shade: 0.91, key: 'side' },
    { n: [0, 0, -1], verts: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], uvs: [[0, 1], [0, 0], [1, 0], [1, 1]], shade: 0.91, key: 'side' }
  ];

  function visible(a, b) {
    if (b === 0) return true;
    const NB = MC.BLOCKS[b];
    if (NB.opaque) return false;
    if (b === a) return false;
    if (NB.liquid && MC.BLOCKS[a].liquid) return false;
    return true;
  }

  function build(world, chunk) {
    const CHUNK = MC.WORLD.CHUNK;
    const HEIGHT = MC.WORLD.HEIGHT;
    const BLOCKS = MC.BLOCKS;
    const blocks = chunk.blocks;
    const bx = chunk.cx * CHUNK, bz = chunk.cz * CHUNK;

    const opa = { verts: [], idx: [] };
    const tra = { verts: [], idx: [] };

    // 每列最高的不透明方块（用于给地下/洞穴一点深度衰减）
    const skyTop = new Uint8Array(CHUNK * CHUNK);
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        let y = HEIGHT - 1;
        while (y > 0) {
          const id = blocks[(y * CHUNK + z) * CHUNK + x];
          if (id !== 0 && BLOCKS[id].opaque) break;
          y--;
        }
        skyTop[z * CHUNK + x] = y + 1;
      }
    }

    const get = (wx, wy, wz) => {
      if (wy < 0 || wy >= HEIGHT) return 0;
      if (wx >= bx && wx < bx + CHUNK && wz >= bz && wz < bz + CHUNK) {
        return blocks[(wy * CHUNK + (wz - bz)) * CHUNK + (wx - bx)];
      }
      return world.getBlock(wx, wy, wz);
    };

    const occ = (wx, wy, wz) => {
      const id = get(wx, wy, wz);
      return id !== 0 && BLOCKS[id].opaque ? 1 : 0;
    };

    function torchQuad(wx, y, wz, a, b, out) {
      const uv = MC.Atlas.uv(BLOCKS[MC.Block.TORCH].tex.side);
      const base = out.verts.length / 10;
      for (const p of [a[0], a[1], b[1], b[0]]) {
        out.verts.push(wx + p[0], y + p[1], wz + p[2],
          uv[0] + p[3] * (uv[2] - uv[0]), uv[1] + p[4] * (uv[3] - uv[1]),
          1, 0, 1, 0, 1);
      }
      out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3,
        base + 2, base + 1, base, base + 3, base + 2, base);
    }

    for (let y = 0; y < HEIGHT; y++) {
      for (let z = 0; z < CHUNK; z++) {
        for (let x = 0; x < CHUNK; x++) {
          const id = blocks[(y * CHUNK + z) * CHUNK + x];
          if (id === 0) continue;
          const B = BLOCKS[id];
          const wx = bx + x, wz = bz + z;
          if (id === MC.Block.TORCH) {
            // 交叉的透明像素面片形成细柄与火焰，不占满一格。
            torchQuad(wx, y, wz,
              [[0.27, 0, 0.27, 0, 1], [0.27, 0.85, 0.27, 0, 0]],
              [[0.73, 0, 0.73, 1, 1], [0.73, 0.85, 0.73, 1, 0]], opa);
            torchQuad(wx, y, wz,
              [[0.27, 0, 0.73, 0, 1], [0.27, 0.85, 0.73, 0, 0]],
              [[0.73, 0, 0.27, 1, 1], [0.73, 0.85, 0.27, 1, 0]], opa);
            continue;
          }
          const depth = skyTop[z * CHUNK + x] - (y + 1);
          const skyDim = B.liquid ? 1 : Math.min(1, Math.max(0.72, 1 - depth * 0.009));

          for (let f = 0; f < 6; f++) {
            if (id === MC.Block.PINK_PETALS && f !== 2) continue;
            const F = FACES[f];
            const nid = get(wx + F.n[0], y + F.n[1], wz + F.n[2]);
            if (!visible(id, nid)) continue;

            if (y === 0 && F.ky === -1) continue;
            const out = B.transparent ? tra : opa;
            const uv = MC.Atlas.uv(B.tex[F.key]);
            const u0 = uv[0], v0 = uv[1], du = uv[2] - uv[0], dv = uv[3] - uv[1];
            const base = out.verts.length / 10;
            const lv = [0, 0, 0, 0];
            const blockLight = world.getLight(wx + F.n[0], y + F.n[1], wz + F.n[2]) / 14;

            for (let k = 0; k < 4; k++) {
              const V = F.verts[k];
              let light = F.shade;
              if (!B.liquid) {
                // AO：取面外侧两个切向邻居 + 角邻居
                const n = F.n;
                let ax0 = -1, s0 = 0, ax1 = -1, s1 = 0;
                for (let a = 0; a < 3; a++) {
                  if (n[a] !== 0) continue;
                  if (ax0 < 0) { ax0 = a; s0 = V[a] ? 1 : -1; }
                  else { ax1 = a; s1 = V[a] ? 1 : -1; }
                }
                const px = [wx + n[0], y + n[1], wz + n[2]];
                px[ax0] += s0;
                const o1 = occ(px[0], px[1], px[2]);
                px[ax0] -= s0; px[ax1] += s1;
                const o2 = occ(px[0], px[1], px[2]);
                px[ax0] += s0;
                const oc = occ(px[0], px[1], px[2]);
                const lvl = (o1 && o2) ? 0 : 3 - (o1 + o2 + oc);
                light *= AO[lvl] * skyDim;
              }

              lv[k] = light;
              const uu = F.uvs[k];
              out.verts.push(
                wx + V[0], y + V[1] - (id === MC.Block.PINK_PETALS ? 0.94 : 0), wz + V[2],
                u0 + uu[0] * du, v0 + uu[1] * dv,
                light,
                F.n[0], F.n[1], F.n[2], blockLight
              );
            }
            // 根据 AO 选择更平顺的对角线，避免暗角被切成明显的三角形
            if (lv[0] + lv[2] > lv[1] + lv[3]) {
              out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            } else {
              out.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            }
          }
        }
      }
    }

    return {
      opaque: { verts: new Float32Array(opa.verts), idx: new Uint32Array(opa.idx) },
      transparent: { verts: new Float32Array(tra.verts), idx: new Uint32Array(tra.idx) },
      faces: (opa.idx.length + tra.idx.length) / 6
    };
  }

  MC.meshChunk = build;
})();

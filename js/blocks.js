/* blocks.js — 16×16 原版风格像素纹理图集 + 方块定义 + 等距图标 + 生物贴图 */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const N = MC.Noise;

  const TS = 16;          // 单块纹理像素（原版尺寸）
  const GRID = 16;        // 图集 16x16
  const SIZE = TS * GRID; // 256

  const painters = {};
  const order = [];
  function tile(name, fn) { painters[name] = fn; order.push(name); }

  /* ---------- 绘制小工具 ---------- */
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

  function set(d, x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = (y * TS + x) * 4;
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
    d[i + 3] = a === undefined ? 255 : clamp(a);
  }

  function fill(d, c, a) {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) set(d, x, y, c[0], c[1], c[2], a);
  }

  /* 随机小色块（保持像素画的大色块感） */
  function punch(d, x0, y0, w, h) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px2 = x0 + x, py2 = y0 + y;
        if (px2 < 0 || py2 < 0 || px2 >= TS || py2 >= TS) continue;
        d[(py2 * TS + px2) * 4 + 3] = 0;
      }
    }
  }

  function punchHoles(d, rng, count) {
    for (let i = 0; i < count; i++) {
      const x = 1 + ((rng() * 14) | 0);
      const y = 1 + ((rng() * 14) | 0);
      punch(d, x, y, 1, 1);
      if (rng() < 0.25) punch(d, x + 1, y, 1, 1);
    }
  }

  function specks(d, rng, colors, count, maxW, maxH) {
    for (let i = 0; i < count; i++) {
      const c = colors[(rng() * colors.length) | 0];
      const w = 1 + ((rng() * (maxW || 2)) | 0);
      const h = 1 + ((rng() * (maxH || 2)) | 0);
      const x0 = (rng() * TS) | 0, y0 = (rng() * TS) | 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        set(d, (x0 + x) % TS, (y0 + y) % TS, c[0], c[1], c[2]);
      }
    }
  }

  const P = {
    grass: [[104, 155, 78], [91, 139, 67], [121, 169, 89], [78, 124, 61]],
    dirt: [[134, 96, 67], [120, 85, 58], [150, 110, 78], [107, 75, 51]],
    stone: [[125, 125, 125], [112, 112, 112], [138, 138, 138], [99, 99, 99]],
    sand: [[226, 214, 164], [212, 199, 148], [240, 231, 190], [200, 187, 136]],
    snow: [[243, 248, 255], [226, 235, 247], [255, 255, 255], [211, 223, 240]],
    brick: [[160, 82, 60], [143, 70, 50], [176, 96, 70], [128, 60, 43]],
    water: [[55, 126, 158], [45, 112, 145], [75, 145, 176], [38, 98, 131]]
  };

  /* ---------- 地形纹理 ---------- */
  tile('grass_top', (d, rng) => {
    fill(d, P.grass[0]);
    specks(d, rng, P.grass.slice(1), 22, 2, 2);
    // 竖向草叶纹路
    for (let i = 0; i < 10; i++) {
      const x = (rng() * TS) | 0, y = (rng() * 12) | 0;
      set(d, x, y, P.grass[3][0], P.grass[3][1], P.grass[3][2]);
      set(d, x, y + 1, P.grass[0][0], P.grass[0][1], P.grass[0][2]);
    }
  });

  tile('grass_side', (d, rng) => {
    const edge = [];
    for (let x = 0; x < TS; x++) edge[x] = 3 + ((rng() * 3) | 0); // 3~5
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        if (y < edge[x] - 1) {
          set(d, x, y, P.grass[0][0], P.grass[0][1], P.grass[0][2]);
        } else if (y < edge[x]) {
          set(d, x, y, P.grass[3][0], P.grass[3][1], P.grass[3][2]);
        } else {
          set(d, x, y, P.dirt[0][0], P.dirt[0][1], P.dirt[0][2]);
        }
      }
    }
    specks(d, rng, [P.dirt[1], P.dirt[2]], 14, 2, 1);
    for (let i = 0; i < 4; i++) {
      const x = (rng() * TS) | 0;
      set(d, x, edge[x], P.grass[3][0], P.grass[3][1], P.grass[3][2]);
    }
  });

  tile('dirt', (d, rng) => {
    fill(d, P.dirt[0]);
    specks(d, rng, [P.dirt[1], P.dirt[2], P.dirt[3]], 30, 2, 2);
  });

  function paintStone(d, rng) {
    fill(d, P.stone[0]);
    specks(d, rng, [P.stone[1], P.stone[3]], 20, 2, 2);
    specks(d, rng, [P.stone[2]], 10, 2, 1);
    for (let i = 0; i < 3; i++) {
      const x = 2 + ((rng() * 10) | 0), y = 2 + ((rng() * 10) | 0);
      set(d, x, y, 105, 105, 105); set(d, x + 1, y, 105, 105, 105);
      set(d, x, y + 1, 105, 105, 105); set(d, x + 1, y + 1, 105, 105, 105);
    }
  }
  tile('stone', paintStone);

  tile('cobble', (d, rng) => {
    fill(d, [86, 86, 86]);
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        const x0 = gx * 4 + ((rng() * 2) | 0) - 1;
        const y0 = gy * 4 + ((rng() * 2) | 0) - 1;
        const w = 3 + ((rng() * 2) | 0), h = 3 + ((rng() * 2) | 0);
        const base = 108 + ((rng() * 34) | 0);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let v = base + ((rng() - 0.5) * 10);
          if (y === 0 || x === 0) v += 14;
          if (y === h - 1 || x === w - 1) v -= 20;
          set(d, x0 + x, y0 + y, v, v, v);
        }
      }
    }
  });

  tile('sand', (d, rng) => {
    fill(d, P.sand[0]);
    specks(d, rng, [P.sand[1], P.sand[3]], 26, 2, 1);
    specks(d, rng, [P.sand[2]], 10, 1, 1);
  });

  tile('water', (d, rng) => {
    // 极低对比度：大面积水面在 NEAREST 采样下不会出现摩尔纹
    fill(d, P.water[0], 190);
    for (let i = 0; i < 14; i++) {
      const x = (rng() * TS) | 0, y = (rng() * TS) | 0;
      const v = rng() < 0.5 ? 2 : -2;
      set(d, x, y, P.water[0][0] + v, P.water[0][1] + v, P.water[0][2] + v * 2, 190);
    }
  });

  tile('torch_side', (d) => {
    for (let y = 2; y < 16; y++) for (let x = 6; x <= 9; x++) {
      const c = y < 6 ? [75, 63, 52] : (x < 8 ? [137, 93, 49] : [96, 65, 38]);
      set(d, x, y, c[0], c[1], c[2]);
    }
    for (let y = 0; y < 5; y++) for (let x = 5 + (y > 2 ? 1 : 0); x <= 10 - (y > 2 ? 1 : 0); x++) {
      const c = y < 2 ? [255, 230, 113] : [255, 153, 39];
      set(d, x, y, c[0], c[1], c[2]);
    }
    set(d, 7, 0, 255, 251, 186); set(d, 8, 0, 255, 251, 186);
  });
  tile('torch_top', (d) => {
    fill(d, [255, 196, 67]);
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) set(d, x, y, 255, 239, 143);
  });

  tile('log_side', (d, rng) => {
    for (let x = 0; x < TS; x++) {
      const shade = ((rng() - 0.5) * 16) | 0;
      for (let y = 0; y < TS; y++) {
        let v = shade + ((rng() - 0.5) * 8);
        set(d, x, y, 104 + v, 78 + v * 0.8, 49 + v * 0.6);
      }
    }
    for (const x of [2, 3, 9, 12]) {
      for (let y = 0; y < TS; y++) {
        if (rng() < 0.85) set(d, x, y, 78, 57, 34);
      }
    }
    set(d, 6, 6, 76, 55, 33); set(d, 7, 6, 76, 55, 33);
    set(d, 6, 7, 84, 62, 38); set(d, 7, 7, 76, 55, 33);
  });

  tile('log_top', (d, rng) => {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const dx = x - 7.5, dy = y - 7.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 6.6) {
          const v = (rng() - 0.5) * 14;
          set(d, x, y, 98 + v, 73 + v, 46 + v);
        } else {
          const ring = (Math.sin(dist * 1.35) > 0) ? 1 : 0;
          const v = (rng() - 0.5) * 8;
          const base = ring ? 201 : 168;
          set(d, x, y, base + v, base * 0.80 + v, base * 0.52 + v);
        }
      }
    }
    set(d, 7, 7, 120, 88, 54); set(d, 8, 7, 120, 88, 54);
    set(d, 7, 8, 120, 88, 54); set(d, 8, 8, 120, 88, 54);
  });

  tile('leaves', (d, rng) => {
    // 深色底 + 叶簇，比纯噪点更像原版树叶
    fill(d, [52, 96, 34]);
    const clumps = [[74, 132, 48], [88, 148, 56], [96, 160, 62]];
    for (let i = 0; i < 16; i++) {
      const x = (rng() * 14) | 0, y = (rng() * 14) | 0;
      const w = 2 + ((rng() * 2) | 0), h = 1 + ((rng() * 2) | 0);
      const c = clumps[(rng() * clumps.length) | 0];
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        if (rng() < 0.18) continue;
        set(d, x + xx, y + yy, c[0], c[1], c[2]);
      }
    }
    for (let i = 0; i < 12; i++) {
      const x = (rng() * 15) | 0, y = (rng() * 15) | 0;
      set(d, x, y, 38, 72, 26);
      if (rng() < 0.5) set(d, x + 1, y + 1, 34, 64, 24);
    }
    for (let i = 0; i < 5; i++) {
      const x = (rng() * 13) | 0, y = (rng() * 13) | 0;
      set(d, x, y, 122, 180, 78);
    }
    punchHoles(d, rng, 13);
  });

  tile('spruce_leaves', (d, rng) => {
    fill(d, [40, 78, 52]);
    for (let i = 0; i < 18; i++) {
      const x = (rng() * 15) | 0, y = (rng() * 15) | 0;
      const c = rng() < 0.5 ? [52, 98, 62] : [62, 114, 70];
      set(d, x, y, c[0], c[1], c[2]);
      set(d, x, y + 1, c[0] * 0.9, c[1] * 0.9, c[2] * 0.9);
    }
    for (let i = 0; i < 10; i++) {
      const x = (rng() * 15) | 0, y = (rng() * 15) | 0;
      set(d, x, y, 32, 62, 42);
    }
    for (let i = 0; i < 4; i++) {
      const x = (rng() * 14) | 0, y = (rng() * 14) | 0;
      set(d, x, y, 76, 128, 80);
    }
    punchHoles(d, rng, 11);
  });

  tile('birch_leaves', (d, rng) => {
    fill(d, [96, 148, 58]);
    for (let i = 0; i < 18; i++) {
      const x = (rng() * 14) | 0, y = (rng() * 14) | 0;
      const c = rng() < 0.5 ? [118, 172, 70] : [134, 188, 82];
      set(d, x, y, c[0], c[1], c[2]);
      set(d, x + 1, y, c[0] - 8, c[1] - 8, c[2] - 6);
    }
    for (let i = 0; i < 9; i++) {
      const x = (rng() * 15) | 0, y = (rng() * 15) | 0;
      set(d, x, y, 82, 128, 48);
    }
    punchHoles(d, rng, 12);
  });

  tile('spruce_log', (d, rng) => {
    for (let x = 0; x < TS; x++) {
      const shade = ((rng() - 0.5) * 14) | 0;
      for (let y = 0; y < TS; y++) {
        const v = shade + ((rng() - 0.5) * 8);
        set(d, x, y, 74 + v, 52 + v * 0.8, 34 + v * 0.6);
      }
    }
    for (const x of [3, 8, 13]) for (let y = 0; y < TS; y++) {
      if (rng() < 0.8) set(d, x, y, 54, 38, 24);
    }
  });

  tile('birch_log', (d, rng) => {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const v = (rng() - 0.5) * 14;
      set(d, x, y, 224 + v, 224 + v, 214 + v);
    }
    for (let i = 0; i < 7; i++) {
      const x = (rng() * 12) | 0, y = (rng() * 15) | 0;
      const w = 2 + ((rng() * 3) | 0);
      for (let k = 0; k < w; k++) set(d, x + k, y, 48, 44, 40);
    }
    for (let i = 0; i < 5; i++) {
      const x = (rng() * 15) | 0, y = (rng() * 15) | 0;
      set(d, x, y, 196, 196, 186);
    }
  });

  tile('planks', (d, rng) => {
    for (let y = 0; y < TS; y++) {
      const shade = ((rng() - 0.5) * 8) | 0;
      for (let x = 0; x < TS; x++) {
        let v = shade + ((rng() - 0.5) * 10);
        set(d, x, y, 176 + v, 138 + v * 0.9, 87 + v * 0.75);
      }
      set(d, 0, y, 150, 115, 70);
    }
    for (const y of [3, 7, 11, 15]) {
      for (let x = 0; x < TS; x++) set(d, x, y, 150, 116, 70);
    }
    for (let i = 0; i < 4; i++) {
      const x = ((rng() * 14) | 0) + 1, y = ((rng() * 3) | 0) + (i * 4) % 16;
      set(d, x, y, 145, 110, 66); set(d, x, y + 1, 145, 110, 66);
    }
  });

  tile('glass', (d) => {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const border = x === 0 || y === 0 || x === TS - 1 || y === TS - 1;
        if (border) set(d, x, y, 214, 236, 246, 190);
        else set(d, x, y, 224, 244, 252, 26);
      }
    }
    for (let i = 0; i < 4; i++) set(d, 2 + i, 8 - i, 240, 250, 255, 90);
    for (let i = 0; i < 3; i++) set(d, 2 + i, 2, 240, 250, 255, 110);
  });

  tile('brick', (d, rng) => {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const row = (y / 4) | 0;
        const shift = (row % 2) * 4;
        const ly = y % 4, lx = (x + shift) % 8;
        if (ly === 0 || lx === 0) {
          set(d, x, y, 194, 183, 165);
        } else {
          const v = (rng() - 0.5) * 14;
          let c = P.brick[0];
          if (ly === 3) c = P.brick[1];
          if (ly === 1 && rng() < 0.5) c = P.brick[2];
          set(d, x, y, c[0] + v, c[1] + v, c[2] + v);
        }
      }
    }
  });

  tile('snow', (d, rng) => {
    fill(d, P.snow[0]);
    specks(d, rng, [P.snow[1], P.snow[3]], 18, 2, 2);
    specks(d, rng, [P.snow[2]], 8, 1, 1);
  });

  tile('bedrock', (d, rng) => {
    fill(d, [74, 74, 79]);
    specks(d, rng, [[56, 56, 61], [90, 90, 96], [45, 45, 50]], 26, 3, 3);
  });

  /* ---------- 矿石 / 合成台 ---------- */
  function orePainter(color, darkColor) {
    return (d, rng) => {
      paintStone(d, rng);
      for (let i = 0; i < 8; i++) {
        const x = 1 + ((rng() * 12) | 0), y = 1 + ((rng() * 12) | 0);
        const w = 1 + ((rng() * 3) | 0), h = 1 + ((rng() * 2) | 0);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
          const c = (xx === 0 && yy === 0) ? color : darkColor;
          set(d, x + xx, y + yy, c[0], c[1], c[2]);
        }
      }
    };
  }
  tile('coal_ore', orePainter([48, 48, 52], [32, 32, 36]));
  tile('iron_ore', orePainter([214, 178, 148], [184, 148, 122]));
  tile('gold_ore', orePainter([244, 214, 84], [214, 176, 52]));
  tile('diamond_ore', orePainter([96, 226, 220], [58, 186, 186]));
  tile('redstone_ore', orePainter([218, 58, 52], [172, 40, 38]));

  tile('table_top', (d, rng) => {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const v = (rng() - 0.5) * 10;
      set(d, x, y, 176 + v, 138 + v * 0.9, 87 + v * 0.75);
    }
    for (const x of [1, 5, 10, 14]) for (let y = 1; y < TS; y++) set(d, x, y, 118, 86, 50);
    for (const y of [1, 5, 10, 14]) for (let x = 1; x < TS; x++) set(d, x, y, 118, 86, 50);
  });
  tile('table_side', (d, rng) => {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const v = (rng() - 0.5) * 10;
      set(d, x, y, 158 + v, 122 + v * 0.9, 76 + v * 0.75);
    }
    for (let x = 0; x < TS; x++) { set(d, x, 0, 108, 78, 44); set(d, x, 15, 100, 72, 40); }
    for (let y = 0; y < TS; y++) { set(d, 0, y, 108, 78, 44); set(d, 15, y, 100, 72, 40); }
    for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) {
      const v = (rng() - 0.5) * 8;
      set(d, x, y, 148 + v, 112 + v, 66 + v);
    }
    for (let x = 3; x < 13; x++) set(d, x, 4, 196, 160, 100);
  });

  /* ---------- 仙人掌 / 冰 ---------- */
  tile('cactus_side', (d, rng) => {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const v = (rng() - 0.5) * 10;
      set(d, x, y, 70 + v, 128 + v, 56 + v * 0.6);
    }
    for (const x of [2, 7, 12]) {
      for (let y = 0; y < TS; y++) set(d, x, y, 54, 104, 42);
      set(d, x + 1, 3, 44, 88, 34); set(d, x + 1, 10, 44, 88, 34);
    }
    for (let i = 0; i < 6; i++) {
      const x = (rng() * 14) | 0, y = (rng() * 14) | 0;
      set(d, x, y, 214, 232, 140);
    }
  });
  tile('cactus_top', (d, rng) => {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const v = (rng() - 0.5) * 8;
      set(d, x, y, 78 + v, 140 + v, 60 + v * 0.6);
    }
    for (let i = 0; i < 4; i++) {
      const x = 3 + ((rng() * 9) | 0), y = 3 + ((rng() * 9) | 0);
      set(d, x, y, 214, 232, 140);
    }
  });
  tile('ice', (d, rng) => {
    fill(d, [148, 196, 236], 178);
    for (let i = 0; i < 10; i++) {
      const x = (rng() * 13) | 0, y = (rng() * 13) | 0;
      set(d, x, y, 190, 224, 248, 200);
      set(d, x + 1, y, 190, 224, 248, 190);
      if (rng() < 0.5) set(d, x, y + 1, 178, 214, 244, 190);
    }
    for (let i = 0; i < 6; i++) {
      const x = (rng() * 12) | 0, y = (rng() * 12) | 0;
      set(d, x, y, 112, 164, 214, 200);
    }
  });

  /* ---------- 新群系：樱花林、恶地、繁茂/溶洞 ---------- */
  function rockyTile(base, flecks) {
    return (d, rng) => { fill(d, base); specks(d, rng, flecks, 28, 2, 2); };
  }
  tile('cherry_log', (d, rng) => {
    fill(d, [100, 66, 64]);
    for (let x = 1; x < TS; x += 4) for (let y = 0; y < TS; y++) {
      const v = (rng() - 0.5) * 12;
      set(d, x, y, 72 + v, 44 + v, 47 + v);
    }
    specks(d, rng, [[130, 85, 78], [80, 49, 51]], 18, 1, 3);
  });
  tile('cherry_top', (d, rng) => {
    fill(d, [109, 72, 67]);
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (r < 6.3) {
        const v = Math.sin(r * 1.6) > 0 ? 12 : -8;
        set(d, x, y, 210 + v, 157 + v, 145 + v);
      }
    }
  });
  tile('cherry_leaves', (d, rng) => {
    fill(d, [177, 83, 121]);
    specks(d, rng, [[239, 163, 191], [220, 128, 163], [245, 194, 207], [133, 67, 101]], 70, 3, 2);
    punchHoles(d, rng, 13);
  });
  tile('cherry_planks', (d, rng) => {
    fill(d, [221, 158, 155]);
    specks(d, rng, [[235, 176, 170], [200, 135, 135]], 24, 3, 1);
    for (const y of [3, 7, 11, 15]) for (let x = 0; x < TS; x++) set(d, x, y, 166, 105, 107);
  });
  tile('pink_petals', (d, rng) => {
    fill(d, [111, 166, 64], 0);
    for (let i = 0; i < 24; i++) {
      const x = (rng() * 15) | 0, y = (rng() * 15) | 0;
      const c = rng() < 0.5 ? [246, 180, 207] : [222, 123, 167];
      set(d, x, y, c[0], c[1], c[2]);
      if (rng() < 0.6) set(d, x + 1, y, c[0], c[1], c[2]);
    }
  });
  tile('red_sand', rockyTile([195, 100, 61], [[214, 119, 70], [172, 80, 49], [226, 143, 88]]));
  tile('terracotta', rockyTile([172, 103, 79], [[187, 119, 91], [151, 86, 69]]));
  tile('orange_terracotta', rockyTile([187, 94, 58], [[206, 112, 66], [165, 73, 45]]));
  tile('yellow_terracotta', rockyTile([201, 155, 91], [[218, 174, 106], [180, 134, 74]]));
  tile('white_terracotta', rockyTile([216, 188, 163], [[229, 204, 178], [197, 166, 147]]));
  tile('moss', rockyTile([74, 117, 48], [[89, 142, 55], [55, 91, 38], [109, 155, 70]]));
  tile('clay', rockyTile([156, 168, 176], [[175, 185, 191], [137, 150, 162]]));
  tile('dripstone', rockyTile([151, 117, 91], [[177, 140, 109], [118, 91, 73], [193, 154, 122]]));

  /* ---------- 生物贴图 ---------- */
  tile('wool', (d, rng) => {
    fill(d, [234, 233, 229]);
    specks(d, rng, [[212, 212, 206], [250, 250, 247]], 30, 3, 2);
    for (let i = 0; i < 8; i++) {
      const x = (rng() * 14) | 0, y = (rng() * 14) | 0;
      set(d, x, y, 214, 214, 210);
      set(d, x + 1, y + 1, 250, 250, 248);
    }
  });

  tile('sheep_face', (d, rng) => {
    fill(d, [232, 228, 220]);
    specks(d, rng, [[219, 214, 204]], 10, 2, 2);
    for (const ex of [3, 10]) {
      set(d, ex, 5, 36, 32, 30); set(d, ex + 1, 5, 36, 32, 30);
      set(d, ex, 6, 36, 32, 30); set(d, ex + 1, 6, 36, 32, 30);
      set(d, ex, 4, 60, 54, 50);
    }
    for (let x = 6; x <= 9; x++) set(d, x, 10, 108, 96, 88);
    set(d, 7, 11, 108, 96, 88); set(d, 8, 11, 108, 96, 88);
    set(d, 7, 12, 150, 138, 128); set(d, 8, 12, 150, 138, 128);
  });

  tile('sheep_leg', (d, rng) => {
    fill(d, [214, 210, 202]);
    specks(d, rng, [[198, 194, 186]], 8, 2, 2);
    for (let y = 12; y < TS; y++) set(d, 7, y, 190, 186, 178);
  });

  tile('chicken_body', (d, rng) => {
    fill(d, [246, 245, 241]);
    specks(d, rng, [[224, 222, 216], [255, 255, 255]], 26, 2, 2);
    for (let i = 0; i < 5; i++) {
      const y = 3 + i * 2;
      set(d, 2 + i, y, 226, 224, 218);
      set(d, 12 - i, y, 226, 224, 218);
    }
  });

  tile('chicken_face', (d) => {
    fill(d, [250, 249, 245]);
    for (const ex of [3, 10]) {
      set(d, ex, 5, 32, 30, 28); set(d, ex + 1, 5, 32, 30, 28);
      set(d, ex, 6, 32, 30, 28); set(d, ex + 1, 6, 32, 30, 28);
    }
    for (let x = 6; x <= 9; x++) set(d, x, 10, 226, 170, 74);
  });

  tile('beak', (d, rng) => {
    fill(d, [232, 168, 62]);
    specks(d, rng, [[214, 148, 48]], 6, 2, 1);
    for (let x = 0; x < TS; x++) set(d, x, 8, 200, 140, 44);
  });

  tile('comb', (d, rng) => {
    fill(d, [196, 58, 44]);
    specks(d, rng, [[168, 44, 34], [218, 78, 62]], 10, 2, 2);
  });

  tile('chicken_leg', (d, rng) => {
    fill(d, [222, 168, 58]);
    specks(d, rng, [[200, 148, 48]], 6, 1, 1);
  });

  tile('cow_hide', (d, rng) => {
    fill(d, [226, 221, 208]);
    for (let i = 0; i < 5; i++) {
      const x = (rng() * 13) | 0, y = (rng() * 13) | 0;
      for (let dz = 0; dz < 2 + ((rng() * 3) | 0); dz++)
        for (let dx = 0; dx < 2 + ((rng() * 3) | 0); dx++) set(d, x + dx, y + dz, 49, 47, 43);
    }
  });
  tile('cow_face', (d) => {
    fill(d, [224, 217, 201]);
    for (const x of [3, 11]) {
      set(d, x, 5, 30, 28, 25); set(d, x + 1, 5, 30, 28, 25);
      set(d, x, 6, 30, 28, 25); set(d, x + 1, 6, 30, 28, 25);
    }
    for (let y = 10; y < 15; y++) for (let x = 3; x < 13; x++) set(d, x, y, 181, 124, 117);
    for (const x of [5, 10]) { set(d, x, 12, 91, 67, 64); set(d, x + 1, 12, 91, 67, 64); }
  });
  tile('cow_hoof', (d, rng) => { fill(d, [61, 56, 50]); specks(d, rng, [[47, 43, 39]], 10, 2, 2); });
  tile('pig_body', (d, rng) => { fill(d, [224, 147, 151]); specks(d, rng, [[237, 166, 168], [204, 125, 133]], 20, 2, 2); });
  tile('pig_face', (d) => {
    fill(d, [228, 153, 157]);
    for (const x of [3, 11]) { set(d, x, 5, 38, 31, 33); set(d, x + 1, 5, 38, 31, 33); }
    for (let y = 9; y < 14; y++) for (let x = 4; x < 12; x++) set(d, x, y, 242, 171, 177);
    for (const x of [6, 10]) { set(d, x, 11, 145, 80, 88); set(d, x, 12, 145, 80, 88); }
  });
  tile('rabbit_fur', (d, rng) => { fill(d, [225, 216, 199]); specks(d, rng, [[244, 236, 219], [202, 191, 171]], 24, 2, 2); });
  tile('rabbit_face', (d) => {
    fill(d, [232, 223, 207]);
    for (const x of [3, 11]) { set(d, x, 6, 64, 42, 41); set(d, x + 1, 6, 64, 42, 41); }
    set(d, 7, 10, 194, 119, 128); set(d, 8, 10, 194, 119, 128);
  });
  tile('rabbit_ear', (d, rng) => { fill(d, [230, 216, 204]); for (let y = 2; y < 14; y++) for (let x = 5; x < 11; x++) set(d, x, y, 207, 146, 155); });

  /* ---------- 第一人称手臂 ---------- */
  tile('arm_skin', (d, rng) => {
    fill(d, [183, 133, 104]);
    specks(d, rng, [[177, 126, 98], [192, 143, 113], [187, 137, 107]], 18, 3, 2);
  });
  tile('arm_end', (d, rng) => {
    fill(d, [194, 144, 113]);
    specks(d, rng, [[184, 134, 104], [201, 151, 119]], 9, 3, 2);
  });
  tile('arm_sleeve', (d, rng) => {
    fill(d, [30, 157, 172]);
    specks(d, rng, [[24, 146, 161], [37, 166, 178]], 16, 4, 2);
    for (let x = 0; x < TS; x++) {
      set(d, x, 0, 22, 136, 151);
      set(d, x, 1, 28, 147, 162);
    }
  });

  /* ---------- 合成图集 ---------- */
  const atlas = document.createElement('canvas');
  atlas.width = atlas.height = SIZE;
  const actx = atlas.getContext('2d');
  const tileIndex = {};

  order.forEach((name, i) => {
    const img = actx.createImageData(TS, TS);
    painters[name](img.data, N.mulberry32(0x5eed + i * 7919));
    actx.putImageData(img, (i % GRID) * TS, Math.floor(i / GRID) * TS);
    tileIndex[name] = i;
  });

  function addTile(name, painter) {
    if (tileIndex[name] !== undefined) return tileIndex[name];
    const idx = order.length;
    if (idx >= GRID * GRID) throw new Error('图集已满');
    order.push(name);
    painters[name] = painter;
    const img = actx.createImageData(TS, TS);
    painter(img.data, N.mulberry32(0x5eed + idx * 7919));
    actx.putImageData(img, (idx % GRID) * TS, Math.floor(idx / GRID) * TS);
    tileIndex[name] = idx;
    return idx;
  }
  MC.addTile = addTile;

  const uvCache = new Map();
  function uv(t) {
    if (uvCache.has(t)) return uvCache.get(t);
    const col = t % GRID, row = (t / GRID) | 0;
    const pad = 0.5 / SIZE;
    const r = [col / GRID + pad, row / GRID + pad, (col + 1) / GRID - pad, (row + 1) / GRID - pad];
    uvCache.set(t, r);
    return r;
  }

  /* ---------- 方块定义 ---------- */
  const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, COBBLE = 4, SAND = 5, WATER = 6,
        LOG = 7, LEAVES = 8, PLANKS = 9, GLASS = 10, BRICK = 11, SNOW = 12, BEDROCK = 13,
        COAL_ORE = 14, IRON_ORE = 15, GOLD_ORE = 16, DIAMOND_ORE = 17, REDSTONE_ORE = 18, TABLE = 19, WOOL = 20, CACTUS = 21, ICE = 22,
        SPRUCE_LOG = 23, SPRUCE_LEAVES = 24, BIRCH_LOG = 25, BIRCH_LEAVES = 26,
        CHERRY_LOG = 27, CHERRY_LEAVES = 28, CHERRY_PLANKS = 29, PINK_PETALS = 30,
        RED_SAND = 31, TERRACOTTA = 32, ORANGE_TERRACOTTA = 33,
        YELLOW_TERRACOTTA = 34, WHITE_TERRACOTTA = 35, MOSS = 36, CLAY = 37, DRIPSTONE = 38, TORCH = 39;

  const DEFS = [
    { name: '空气' },
    { name: '草方块', solid: 1, opaque: 1, tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' } },
    { name: '泥土', solid: 1, opaque: 1, tex: { all: 'dirt' } },
    { name: '石头', solid: 1, opaque: 1, tex: { all: 'stone' } },
    { name: '圆石', solid: 1, opaque: 1, tex: { all: 'cobble' } },
    { name: '沙子', solid: 1, opaque: 1, tex: { all: 'sand' } },
    { name: '水', solid: 0, opaque: 0, liquid: 1, transparent: 1, tex: { all: 'water' } },
    { name: '原木', solid: 1, opaque: 1, tex: { top: 'log_top', side: 'log_side', bottom: 'log_top' } },
    { name: '树叶', solid: 1, opaque: 0, tex: { all: 'leaves' } },
    { name: '木板', solid: 1, opaque: 1, tex: { all: 'planks' } },
    { name: '玻璃', solid: 1, opaque: 0, transparent: 1, tex: { all: 'glass' } },
    { name: '砖块', solid: 1, opaque: 1, tex: { all: 'brick' } },
    { name: '雪块', solid: 1, opaque: 1, tex: { all: 'snow' } },
    { name: '基岩', solid: 1, opaque: 1, tex: { all: 'bedrock' } },
    { name: '煤矿石', solid: 1, opaque: 1, tex: { all: 'coal_ore' } },
    { name: '铁矿石', solid: 1, opaque: 1, tex: { all: 'iron_ore' } },
    { name: '金矿石', solid: 1, opaque: 1, tex: { all: 'gold_ore' } },
    { name: '钻石矿石', solid: 1, opaque: 1, tex: { all: 'diamond_ore' } },
    { name: '红石矿石', solid: 1, opaque: 1, tex: { all: 'redstone_ore' } },
    { name: '合成台', solid: 1, opaque: 1, tex: { top: 'table_top', side: 'table_side', bottom: 'planks' } },
    { name: '羊毛', solid: 1, opaque: 1, tex: { all: 'wool' } },
    { name: '仙人掌', solid: 1, opaque: 1, tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' } },
    { name: '冰', solid: 1, opaque: 1, tex: { all: 'ice' } },
    { name: '云杉原木', solid: 1, opaque: 1, tex: { top: 'log_top', side: 'spruce_log', bottom: 'log_top' } },
    { name: '云杉树叶', solid: 1, opaque: 0, tex: { all: 'spruce_leaves' } },
    { name: '白桦原木', solid: 1, opaque: 1, tex: { top: 'log_top', side: 'birch_log', bottom: 'log_top' } },
    { name: '白桦树叶', solid: 1, opaque: 0, tex: { all: 'birch_leaves' } },
    { name: '樱花原木', solid: 1, opaque: 1, tex: { top: 'cherry_top', side: 'cherry_log', bottom: 'cherry_top' } },
    { name: '樱花树叶', solid: 1, opaque: 0, tex: { all: 'cherry_leaves' } },
    { name: '樱花木板', solid: 1, opaque: 1, tex: { all: 'cherry_planks' } },
    { name: '粉红花瓣', solid: 0, opaque: 0, transparent: 1, tex: { all: 'pink_petals' } },
    { name: '红沙', solid: 1, opaque: 1, tex: { all: 'red_sand' } },
    { name: '陶瓦', solid: 1, opaque: 1, tex: { all: 'terracotta' } },
    { name: '橙色陶瓦', solid: 1, opaque: 1, tex: { all: 'orange_terracotta' } },
    { name: '黄色陶瓦', solid: 1, opaque: 1, tex: { all: 'yellow_terracotta' } },
    { name: '白色陶瓦', solid: 1, opaque: 1, tex: { all: 'white_terracotta' } },
    { name: '苔藓块', solid: 1, opaque: 1, tex: { all: 'moss' } },
    { name: '黏土', solid: 1, opaque: 1, tex: { all: 'clay' } },
    { name: '滴水石块', solid: 1, opaque: 1, tex: { all: 'dripstone' } },
    { name: '火把', solid: 0, opaque: 0, light: 14, tex: { top: 'torch_top', side: 'torch_side', bottom: 'torch_side' } }
  ];

  const BLOCKS = DEFS.map((d, id) => {
    const b = {
      id, name: d.name,
      solid: !!d.solid, opaque: !!d.opaque, liquid: !!d.liquid, transparent: !!d.transparent,
      light: d.light || 0
    };
    if (d.tex) {
      const top = d.tex.all || d.tex.top || d.tex.side;
      const side = d.tex.all || d.tex.side || d.tex.top;
      const bottom = d.tex.all || d.tex.bottom || d.tex.side || top;
      b.tex = { top: tileIndex[top], side: tileIndex[side], bottom: tileIndex[bottom] };
      b.placeable = id !== BEDROCK;
    }
    return b;
  });

  const isSolid = (id) => id !== 0 && BLOCKS[id].solid;
  const isOpaque = (id) => id !== 0 && BLOCKS[id].opaque;
  const isLiquid = (id) => id !== 0 && BLOCKS[id].liquid;

  /* ---------- 等距图标绘制 ---------- */
  function drawIcon(canvas, id, size) {
    const B = BLOCKS[id];
    const ctx = canvas.getContext('2d');
    const S = size || canvas.width;
    canvas.width = canvas.height = S;
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = false;
    if (!B || !B.tex) return;

    if (id === TORCH) {
      const t = B.tex.side;
      const col = (t % GRID) * TS, row = ((t / GRID) | 0) * TS;
      ctx.drawImage(atlas, col, row, TS, TS, S * 0.12, S * 0.04, S * 0.76, S * 0.92);
      return;
    }

    const w = S * 0.8;
    const ox = (S - w) / 2, oy = S * 0.09;
    const h = w * 0.5;
    const top = B.tex.top, side = B.tex.side;

    function face(t, oxx, oyy, ux, uy, vx, vy, shade) {
      const col = (t % GRID) * TS, row = ((t / GRID) | 0) * TS;
      ctx.save();
      ctx.setTransform(ux / TS, uy / TS, vx / TS, vy / TS, oxx, oyy);
      ctx.drawImage(atlas, col, row, TS, TS, 0, 0, TS, TS);
      ctx.restore();
      if (shade > 0) {
        ctx.beginPath();
        ctx.moveTo(oxx, oyy);
        ctx.lineTo(oxx + ux, oyy + uy);
        ctx.lineTo(oxx + ux + vx, oyy + uy + vy);
        ctx.lineTo(oxx + vx, oyy + vy);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,' + shade + ')';
        ctx.fill();
      }
    }

    face(top, ox + w / 2, oy, w / 2, w * 0.25, -w / 2, w * 0.25, 0);
    face(side, ox, oy + w * 0.25, w / 2, w * 0.25, 0, h, 0.30);
    face(side, ox + w / 2, oy + h, w / 2, -w * 0.25, 0, h, 0.14);
  }

  MC.Atlas = { canvas: atlas, size: SIZE, tile: TS, grid: GRID, uv, index: tileIndex };
  MC.BLOCKS = BLOCKS;
  MC.Block = {
    isSolid, isOpaque, isLiquid,
    AIR, GRASS, DIRT, STONE, COBBLE, SAND, WATER, LOG, LEAVES, PLANKS, GLASS, BRICK, SNOW, BEDROCK,
    COAL_ORE, IRON_ORE, GOLD_ORE, DIAMOND_ORE, REDSTONE_ORE, TABLE, WOOL, CACTUS, ICE, SPRUCE_LOG, SPRUCE_LEAVES, BIRCH_LOG, BIRCH_LEAVES,
    CHERRY_LOG, CHERRY_LEAVES, CHERRY_PLANKS, PINK_PETALS, RED_SAND, TERRACOTTA, ORANGE_TERRACOTTA,
    YELLOW_TERRACOTTA, WHITE_TERRACOTTA, MOSS, CLAY, DRIPSTONE, TORCH
  };
  MC.MOB_TILES = {
    wool: tileIndex.wool,
    sheepFace: tileIndex.sheep_face,
    sheepLeg: tileIndex.sheep_leg,
    chickenBody: tileIndex.chicken_body,
    chickenFace: tileIndex.chicken_face,
    beak: tileIndex.beak,
    comb: tileIndex.comb,
    chickenLeg: tileIndex.chicken_leg,
    cowHide: tileIndex.cow_hide,
    cowFace: tileIndex.cow_face,
    cowHoof: tileIndex.cow_hoof,
    pigBody: tileIndex.pig_body,
    pigFace: tileIndex.pig_face,
    rabbitFur: tileIndex.rabbit_fur,
    rabbitFace: tileIndex.rabbit_face,
    rabbitEar: tileIndex.rabbit_ear
  };
  // 硬度（秒，裸手基准）/ 适配工具 / 掉落
  const MINE = {
    1: { hard: 0.6, tool: 'shovel', drop: 2 },
    2: { hard: 0.5, tool: 'shovel' },
    3: { hard: 1.5, tool: 'pickaxe', drop: 4 },
    4: { hard: 2.0, tool: 'pickaxe' },
    5: { hard: 0.5, tool: 'shovel' },
    6: { hard: -1 },
    7: { hard: 2.0, tool: 'axe' },
    8: { hard: 0.2, tool: 'axe' },
    9: { hard: 2.0, tool: 'axe' },
    10: { hard: 0.3, tool: 'pickaxe' },
    11: { hard: 2.0, tool: 'pickaxe' },
    12: { hard: 0.4, tool: 'shovel' },
    13: { hard: -1 },
    14: { hard: 3.0, tool: 'pickaxe', dropItem: 'coal' },
    15: { hard: 3.0, tool: 'pickaxe', dropItem: 'iron_ingot' },
    16: { hard: 3.0, tool: 'pickaxe', dropItem: 'gold_ingot' },
    17: { hard: 3.0, tool: 'pickaxe', dropItem: 'diamond' },
    18: { hard: 3.0, tool: 'pickaxe', dropItem: 'redstone' },
    19: { hard: 2.5, tool: 'axe' },
    20: { hard: 0.8, tool: 'shears' },
    21: { hard: 0.4, tool: null },
    22: { hard: 0.5, tool: 'pickaxe' },
    23: { hard: 2.0, tool: 'axe' },
    24: { hard: 0.2, tool: 'axe' },
    25: { hard: 2.0, tool: 'axe' },
    26: { hard: 0.2, tool: 'axe' },
    27: { hard: 2.0, tool: 'axe' },
    28: { hard: 0.2, tool: 'axe' },
    29: { hard: 2.0, tool: 'axe' },
    30: { hard: 0.1 },
    31: { hard: 0.5, tool: 'shovel' },
    32: { hard: 1.25, tool: 'pickaxe' },
    33: { hard: 1.25, tool: 'pickaxe' },
    34: { hard: 1.25, tool: 'pickaxe' },
    35: { hard: 1.25, tool: 'pickaxe' },
    36: { hard: 0.1, tool: 'hoe' },
    37: { hard: 0.6, tool: 'shovel' },
    38: { hard: 1.5, tool: 'pickaxe' },
    39: { hard: 0.1, tool: null }
  };
  MC.MINE = MINE;

  MC.drawBlockIcon = drawIcon;
  MC.PLACEABLE = [GRASS, DIRT, STONE, COBBLE, SAND, LOG, PLANKS, LEAVES, GLASS, BRICK, SNOW, WATER,
                  COAL_ORE, IRON_ORE, GOLD_ORE, DIAMOND_ORE, REDSTONE_ORE, TABLE, WOOL, CACTUS, ICE,
                  SPRUCE_LOG, SPRUCE_LEAVES, BIRCH_LOG, BIRCH_LEAVES,
                  CHERRY_LOG, CHERRY_LEAVES, CHERRY_PLANKS, PINK_PETALS, RED_SAND,
                  TERRACOTTA, ORANGE_TERRACOTTA, YELLOW_TERRACOTTA, WHITE_TERRACOTTA,
                  MOSS, CLAY, DRIPSTONE, TORCH];
})();

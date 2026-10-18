/* items.js — 物品注册表：程序化画稿，经 64×64 图集输出 */
(function () {
  'use strict';
  const MC = window.MC;
  const TS = 16;
  const addTile = MC.addTile;

  const ITEMS = [];
  const KEY = {};
  function def(o) { ITEMS[o.id] = o; if (o.key) KEY[o.key] = o.id; }

  /* ---------- 16×16 像素小工具 ---------- */
  function px(d, x, y, c) {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = (y * TS + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  function rect(d, x0, y0, w, h, c) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(d, x0 + x, y0 + y, c);
  }
  function line(d, x0, y0, x1, y1, c, thick) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / n);
      const y = Math.round(y0 + (y1 - y0) * i / n);
      px(d, x, y, c);
      if (thick) px(d, x + 1, y, thick);
    }
  }

  /* ---------- 方块物品（id 与方块 id 一致） ---------- */
  for (let id = 1; id < MC.BLOCKS.length; id++) {
    const b = MC.BLOCKS[id];
    if (!b || !b.tex) continue;
    def({ id, name: b.name, key: 'block_' + id, kind: 'block', block: id });
  }

  /* ---------- 材料图标 ---------- */
  const wood = [124, 86, 48], woodL = [158, 114, 66], woodD = [86, 58, 30];

  addTile('item_stick', (d) => {
    line(d, 4, 12, 11, 5, woodL);
    line(d, 4, 13, 11, 6, wood);
    px(d, 12, 4, woodL);
  });
  def({ id: 100, key: 'stick', name: '木棍', kind: 'material', sprite: MC.Atlas.index.item_stick });

  addTile('item_coal', (d, rng) => {
    rect(d, 5, 6, 7, 6, [42, 42, 46]);
    rect(d, 6, 5, 5, 2, [54, 54, 58]);
    px(d, 7, 7, [80, 80, 84]); px(d, 9, 8, [80, 80, 84]);
    px(d, 6, 10, [30, 30, 34]); px(d, 10, 11, [30, 30, 34]);
  });
  def({ id: 101, key: 'coal', name: '煤炭', kind: 'material', sprite: MC.Atlas.index.item_coal });

  function ingot(name) {
    addTile('item_' + name, (d) => {
      const c = name === 'iron' ? [206, 206, 212] : [236, 196, 72];
      const cl = name === 'iron' ? [238, 238, 244] : [255, 226, 118];
      const cd = name === 'iron' ? [150, 150, 158] : [188, 146, 38];
      rect(d, 4, 6, 8, 5, c);
      rect(d, 5, 5, 6, 1, cl);
      rect(d, 4, 10, 8, 1, cd);
      px(d, 3, 7, c); px(d, 12, 7, c);
      px(d, 3, 8, cd); px(d, 12, 8, cd);
    });
    return MC.Atlas.index['item_' + name];
  }
  def({ id: 102, key: 'iron_ingot', name: '铁锭', kind: 'material', sprite: ingot('iron') });
  def({ id: 103, key: 'gold_ingot', name: '金锭', kind: 'material', sprite: ingot('gold') });

  addTile('item_diamond', (d) => {
    const c = [92, 222, 214], cl = [168, 246, 240], cd = [46, 168, 164];
    const rows = [4, 6, 8, 8, 6, 4, 2];
    for (let i = 0; i < rows.length; i++) {
      const w = rows[i], x = 8 - (w >> 1), y = 4 + i;
      for (let k = 0; k < w; k++) px(d, x + k, y, (k === 0 ? cl : (k === w - 1 ? cd : c)));
    }
    px(d, 7, 6, [255, 255, 255]); px(d, 8, 5, [255, 255, 255]);
  });
  def({ id: 104, key: 'diamond', name: '钻石', kind: 'material', sprite: MC.Atlas.index.item_diamond });

  addTile('item_redstone', (d, rng) => {
    for (let i = 0; i < 26; i++) {
      const x = 3 + ((rng() * 10) | 0), y = 4 + ((rng() * 9) | 0);
      px(d, x, y, rng() < 0.5 ? [214, 44, 40] : [166, 26, 26]);
    }
  });
  def({ id: 105, key: 'redstone', name: '红石', kind: 'material', sprite: MC.Atlas.index.item_redstone });

  addTile('item_flint', (d, rng) => {
    const c = [66, 66, 72], cl = [96, 96, 104];
    for (let i = 0; i < 8; i++) {
      const w = 8 - i;
      for (let k = 0; k < w; k++) px(d, 4 + k + (i >> 1), 4 + i, k === 0 ? cl : c);
    }
  });
  def({ id: 106, key: 'flint', name: '打火石', kind: 'material', sprite: MC.Atlas.index.item_flint });

  addTile('item_string', (d) => {
    const c = [232, 232, 224];
    line(d, 4, 11, 7, 6, c);
    line(d, 7, 6, 10, 11, c);
    line(d, 10, 11, 13, 6, c);
    px(d, 13, 5, [200, 200, 192]);
  });
  def({ id: 107, key: 'string', name: '线', kind: 'material', sprite: MC.Atlas.index.item_string });

  addTile('item_feather', (d) => {
    line(d, 10, 11, 4, 5, [210, 210, 205]);
    for (let i = 0; i < 5; i++) {
      const x = 9 - i, y = 10 - i;
      px(d, x - 1, y, [244, 244, 240]);
      px(d, x - 2, y, [236, 236, 232]);
      px(d, x, y - 1, [244, 244, 240]);
    }
    px(d, 10, 12, [160, 160, 156]);
  });
  def({ id: 108, key: 'feather', name: '羽毛', kind: 'material', sprite: MC.Atlas.index.item_feather });

  addTile('item_leather', (d, rng) => {
    const c = [150, 98, 52], cl = [178, 124, 72];
    rect(d, 4, 5, 8, 7, c);
    rect(d, 4, 5, 8, 1, cl);
    for (let x = 5; x < 11; x += 2) px(d, x, 8, [110, 70, 36]);
    px(d, 4, 5, [184, 132, 80]); px(d, 11, 11, [110, 70, 36]);
  });
  def({ id: 109, key: 'leather', name: '皮革', kind: 'material', sprite: MC.Atlas.index.item_leather });

  addTile('item_paper', (d) => {
    const c = [244, 244, 238], cd = [206, 206, 200];
    rect(d, 4, 4, 8, 9, c);
    for (let y = 6; y < 12; y += 2) rect(d, 5, y, 6, 1, cd);
    px(d, 11, 4, [222, 222, 216]); px(d, 11, 5, [222, 222, 216]);
  });
  def({ id: 110, key: 'paper', name: '纸', kind: 'material', sprite: MC.Atlas.index.item_paper });

  /* ---------- 食物 ---------- */
  addTile('item_apple', (d) => {
    const c = [200, 40, 40], cl = [236, 76, 66], cd = [152, 26, 30];
    for (let y = 0; y < 8; y++) {
      const w = [4, 6, 8, 8, 8, 6, 4, 2][y];
      for (let k = 0; k < w; k++) px(d, 8 - (w >> 1) + k, 5 + y, k === 0 ? cl : (k === w - 1 ? cd : c));
    }
    line(d, 8, 5, 8, 3, [96, 66, 34]);
    px(d, 9, 3, [80, 160, 60]); px(d, 10, 3, [80, 160, 60]); px(d, 9, 2, [96, 180, 72]);
    px(d, 6, 7, [255, 220, 220]);
  });
  def({ id: 111, key: 'apple', name: '苹果', kind: 'food', sprite: MC.Atlas.index.item_apple });

  addTile('item_bread', (d, rng) => {
    const c = [186, 132, 66], cl = [216, 164, 92], cd = [150, 100, 46];
    for (let y = 0; y < 6; y++) {
      const w = [6, 8, 8, 8, 6, 4][y];
      for (let k = 0; k < w; k++) px(d, 8 - (w >> 1) + k, 5 + y, y === 0 ? cl : (y === 4 ? cd : c));
    }
    for (let i = 0; i < 3; i++) px(d, 6 + i * 2, 7, [130, 86, 40]);
    px(d, 7, 6, [206, 156, 86]);
  });
  def({ id: 112, key: 'bread', name: '面包', kind: 'food', sprite: MC.Atlas.index.item_bread });

  addTile('item_wheat', (d) => {
    const c = [214, 186, 88], cl = [240, 216, 128], cd = [176, 146, 60];
    for (const x0 of [5, 8, 11]) {
      line(d, x0, 13, x0 + 1, 4, c);
      for (let i = 0; i < 4; i++) {
        px(d, x0 - 1, 6 + i * 2, cl);
        px(d, x0 + 2, 7 + i * 2, cd);
      }
    }
  });
  def({ id: 113, key: 'wheat', name: '小麦', kind: 'food', sprite: MC.Atlas.index.item_wheat });

  function rawMeat(name, color, light, dark) {
    addTile('item_' + name, (d) => {
      rect(d, 4, 5, 8, 7, color);
      rect(d, 5, 4, 6, 2, light);
      rect(d, 4, 10, 7, 2, dark);
      rect(d, 6, 6, 2, 4, [237, 187, 170]);
      px(d, 10, 7, light); px(d, 5, 9, dark);
    });
    return MC.Atlas.index['item_' + name];
  }
  def({ id: 114, key: 'raw_beef', name: '生牛肉', kind: 'food', sprite: rawMeat('raw_beef', [164, 67, 68], [195, 93, 92], [126, 47, 51]) });
  def({ id: 115, key: 'raw_pork', name: '生猪肉', kind: 'food', sprite: rawMeat('raw_pork', [218, 130, 132], [242, 160, 158], [179, 96, 105]) });

  /* ---------- 只有彩蛋会给出的物品（没有数值加成） ---------- */
  addTile('item_broken_steel', (d) => {
    const steel = [198, 208, 214], steelD = [126, 137, 146], gold = [214, 178, 88], goldD = [166, 130, 52];
    // 断掉的剑身
    for (let i = 0; i < 6; i++) {
      px(d, 8 + i, 9 - i, steel);
      px(d, 9 + i, 9 - i, steelD);
    }
    px(d, 13, 3, steel); px(d, 14, 3, steelD); px(d, 13, 4, steelD);
    // 断口
    px(d, 8, 10, [92, 100, 108]); px(d, 9, 9, [92, 100, 108]);
    // 护手与握柄
    for (let i = 0; i < 5; i++) { px(d, 4 + i, 11, gold); px(d, 4 + i, 12, goldD); }
    for (let i = 0; i < 3; i++) { px(d, 3 + i, 13 - i, wood); px(d, 4 + i, 13 - i, woodL); }
    px(d, 4, 11, [244, 214, 124]);
  });
  def({ id: 116, key: 'broken_steel', name: '断钢', kind: 'material', sprite: MC.Atlas.index.item_broken_steel });

  addTile('item_moon_wool', (d) => {
    rect(d, 0, 0, 16, 16, [226, 231, 240]);
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
      if ((x + y) % 3 === 0) px(d, x, y, [246, 249, 255]);
      if ((x * 3 + y * 5) % 7 === 0) px(d, x, y, [199, 208, 226]);
    }
    // 一枚月牙
    for (let y = 3; y <= 12; y++) for (let x = 5; x <= 12; x++) {
      const dx = x - 10, dy = y - 8;
      const outer = dx * dx + dy * dy <= 20;
      const inner = (dx - 3) * (dx - 3) + dy * dy <= 18;
      if (outer && !inner) px(d, x, y, [255, 249, 210]);
    }
    for (let i = 0; i < 3; i++) px(d, 4 + i * 3, 2 + (i % 2) * 11, [255, 255, 255]);
  });
  def({ id: 117, key: 'moon_wool', name: '月光羊毛', kind: 'material', sprite: MC.Atlas.index.item_moon_wool });

  /* ---------- 工具 ---------- */
  const TIERS = [
    { key: 'wood', name: '木', speed: 2.5, durability: 59, c: [[150, 110, 64], [176, 136, 86], [112, 80, 44]] },
    { key: 'stone', name: '石', speed: 4.5, durability: 131, c: [[128, 128, 128], [158, 158, 158], [94, 94, 94]] },
    { key: 'iron', name: '铁', speed: 7, durability: 250, c: [[206, 206, 214], [238, 238, 246], [152, 152, 160]] },
    { key: 'gold', name: '金', speed: 12, durability: 32, c: [[236, 196, 72], [255, 226, 118], [184, 142, 38]] },
    { key: 'diamond', name: '钻石', speed: 9, durability: 1561, c: [[92, 222, 214], [158, 246, 240], [46, 168, 164]] }
  ];
  const TOOL_TYPES = [
    { key: 'pickaxe', name: '镐' },
    { key: 'axe', name: '斧' },
    { key: 'shovel', name: '锹' },
    { key: 'sword', name: '剑' },
    { key: 'hoe', name: '锄' }
  ];

  function paintTool(d, type, cols) {
    const [base, light, dark] = cols;
    const handle = [126, 88, 50], handleL = [158, 116, 66], handleD = [86, 58, 30];

    // 手柄（左下 → 右上）
    for (let i = 0; i < 9; i++) {
      const x = 2 + i, y = 14 - i;
      px(d, x, y, handleD);
      px(d, x + 1, y, handle);
      px(d, x + 1, y - 1, handleL);
    }

    if (type === 'pickaxe') {
      for (let x = 4; x <= 14; x++) {
        const t = (x - 9) / 5;
        const y = 3 + Math.round(t * t * 5);
        px(d, x, y, light);
        px(d, x, y + 1, base);
        px(d, x, y + 2, dark);
      }
      px(d, 9, 6, base); px(d, 10, 6, dark);
    } else if (type === 'axe') {
      for (let y = 1; y <= 8; y++) {
        for (let x = 9; x <= 14; x++) {
          if ((y === 1 || y === 8) && x > 12) continue;
          px(d, x, y, x >= 13 ? light : base);
        }
      }
      for (let x = 9; x <= 13; x++) { px(d, x, 9, dark); }
      px(d, 12, 2, [255, 255, 255, 120]);
    } else if (type === 'shovel') {
      for (let y = 2; y <= 7; y++) {
        const w = y < 6 ? 5 : 3;
        for (let k = 0; k < w; k++) px(d, 11 - (w >> 1) + k, y, k === 0 ? light : (k === w - 1 ? dark : base));
      }
      px(d, 10, 8, base); px(d, 11, 8, dark);
      px(d, 10, 1, light);
    } else if (type === 'sword') {
      // 剑身
      for (let i = 0; i < 8; i++) {
        const x = 6 + i, y = 10 - i;
        px(d, x, y, light); px(d, x + 1, y, base);
        px(d, x, y - 1, base); px(d, x + 1, y + 1, dark);
      }
      px(d, 13, 2, light); px(d, 14, 2, base); px(d, 13, 1, light);
      // 护手
      for (let i = 0; i < 4; i++) { px(d, 4 + i, 9 + i, base); px(d, 4 + i, 10 + i, dark); }
      // 握柄
      for (let i = 0; i < 3; i++) { px(d, 3 + i, 13 - i, handle); px(d, 4 + i, 13 - i, handleL); }
    } else if (type === 'hoe') {
      for (let x = 7; x <= 14; x++) { px(d, x, 2, light); px(d, x, 3, base); }
      for (let y = 3; y <= 7; y++) { px(d, 13, y, base); px(d, 14, y, dark); }
      px(d, 9, 4, base); px(d, 9, 5, dark);
    }
  }

  let toolId = 120;
  for (let ti = 0; ti < TIERS.length; ti++) {
    for (let yi = 0; yi < TOOL_TYPES.length; yi++) {
      const tier = TIERS[ti], tt = TOOL_TYPES[yi];
      const name = 'tool_' + tt.key + '_' + tier.key;
      addTile(name, (d) => paintTool(d, tt.key, tier.c));
      def({
        id: toolId++, key: name,
        name: tier.name + tt.name, kind: 'tool',
        sprite: MC.Atlas.index[name],
        tool: { type: tt.key, tier: tier.key, speed: tier.speed, maxDur: tier.durability }
      });
    }
  }

  /* ---------- 查询与图标 ---------- */
  function itemIcon(canvas, id, size) {
    const it = ITEMS[id];
    if (!it) return;
    if (it.block) return MC.drawBlockIcon(canvas, it.block, size);
    const S = size || canvas.width;
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const tile = it.sprite;
    const col = tile % MC.Atlas.grid, row = (tile / MC.Atlas.grid) | 0;
    const pad = S * 0.04;
    const atlasTile = MC.Atlas.tile;
    ctx.drawImage(MC.Atlas.canvas, col * atlasTile, row * atlasTile,
      atlasTile, atlasTile, pad, pad, S - pad * 2, S - pad * 2);
  }

  const byId = (id) => ITEMS[id] || null;
  const nameOf = (id) => (ITEMS[id] ? ITEMS[id].name : '');
  const blockOf = (id) => (ITEMS[id] && ITEMS[id].block) || 0;
  const toolOf = (id) => (ITEMS[id] && ITEMS[id].tool) || null;

  // 彩蛋方块与奖励不放进创造页，避免提前剧透。
  MC.SECRET_ITEMS = new Set([40, 41, 42, 43, 116, 117]);
  MC.ITEMS = ITEMS;
  MC.ITEM_KEY = KEY;
  MC.itemById = byId;
  MC.itemName = nameOf;
  MC.itemBlock = blockOf;
  MC.itemTool = toolOf;
  MC.itemIcon = itemIcon;
  MC.ALL_ITEMS = ITEMS.filter(Boolean);
})();

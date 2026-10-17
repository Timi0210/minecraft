/* crafting.js — 合成配方与 3×3 匹配（原版工具配方） */
(function () {
  'use strict';
  const MC = window.MC;

  const LOG = 7, PLANKS = 9, COBBLE = 4, TABLE = 19, WOOL = 20, STICK = 100,
        IRON = 102, GOLD = 103, DIAMOND = 104, WHEAT = 113, BREAD = 112;

  /* 工具：120 起，按 木/石/铁/金/钻石 × 镐/斧/锹/剑/锄 排列 */
  const TIER_MATS = [
    { mat: PLANKS, name: '木' },
    { mat: COBBLE, name: '石' },
    { mat: IRON, name: '铁' },
    { mat: GOLD, name: '金' },
    { mat: DIAMOND, name: '钻石' }
  ];
  const TOOL_PATTERNS = [
    { key: 'pickaxe', name: '镐', p: [[1, 1, 1], [0, 2, 0], [0, 2, 0]] },
    { key: 'axe', name: '斧', p: [[1, 1, 0], [1, 2, 0], [0, 2, 0]] },
    { key: 'shovel', name: '锹', p: [[0, 1, 0], [0, 2, 0], [0, 2, 0]] },
    { key: 'sword', name: '剑', p: [[0, 1, 0], [0, 1, 0], [0, 2, 0]] },
    { key: 'hoe', name: '锄', p: [[1, 1, 0], [0, 2, 0], [0, 2, 0]] }
  ];

  const RECIPES = [];

  function add(o) { RECIPES.push(o); }

  add({ name: '木板 ×4', shapeless: [LOG], out: { id: PLANKS, count: 4 } });
  add({ name: '木板 ×4（云杉）', shapeless: [23], out: { id: PLANKS, count: 4 } });
  add({ name: '木板 ×4（白桦）', shapeless: [25], out: { id: PLANKS, count: 4 } });
  add({ name: '樱花木板 ×4', shapeless: [27], out: { id: 29, count: 4 } });
  add({ name: '木棍 ×4（樱花）', pattern: [[29], [29]], out: { id: STICK, count: 4 } });
  add({ name: '合成台（樱花）', pattern: [[29, 29], [29, 29]], out: { id: TABLE, count: 1 } });
  add({ name: '木棍 ×4', pattern: [[PLANKS], [PLANKS]], out: { id: STICK, count: 4 } });
  add({ name: '合成台', pattern: [[PLANKS, PLANKS], [PLANKS, PLANKS]], out: { id: TABLE, count: 1 } });
  add({ name: '羊毛', pattern: [[107, 107], [107, 107]], out: { id: WOOL, count: 1 } });
  add({ name: '面包', pattern: [[WHEAT, WHEAT, WHEAT]], out: { id: BREAD, count: 1 } });
  add({ name: '火把 ×4', pattern: [[101], [STICK]], out: { id: MC.Block.TORCH, count: 4 } });

  let toolId = 120;
  for (let t = 0; t < TIER_MATS.length; t++) {
    for (let k = 0; k < TOOL_PATTERNS.length; k++) {
      const tp = TOOL_PATTERNS[k];
      const grid = tp.p.map(row => row.map(v => v === 1 ? TIER_MATS[t].mat : v === 2 ? STICK : 0));
      add({
        name: TIER_MATS[t].name + tp.name,
        pattern: grid,
        out: { id: toolId, count: 1 },
        tool: true
      });
      toolId++;
    }
  }

  /* ---------- 匹配 ---------- */
  function trim(rows) {
    let minR = 9, maxR = -1, minC = 9, maxC = -1;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    if (maxR < 0) return null;
    const out = [];
    for (let r = minR; r <= maxR; r++) out.push(rows[r].slice(minC, maxC + 1));
    return out;
  }

  function gridToRows(grid) {
    const rows = [];
    for (let r = 0; r < 3; r++) rows.push(grid.slice(r * 3, r * 3 + 3));
    return rows;
  }

  function sameRows(a, b) {
    if (a.length !== b.length) return false;
    for (let r = 0; r < a.length; r++) {
      if (a[r].length !== b[r].length) return false;
      for (let c = 0; c < a[r].length; c++) if (a[r][c] !== b[r][c]) return false;
    }
    return true;
  }

  function match(grid) {
    const rows = trim(gridToRows(grid));
    const items = grid.filter(Boolean).sort().join(',');
    for (const rec of RECIPES) {
      if (rec.shapeless) {
        const need = rec.shapeless.slice().sort().join(',');
        if (need === items) return rec;
        continue;
      }
      if (!rows) continue;
      const pat = trim(rec.pattern);
      if (sameRows(rows, pat)) return rec;
    }
    return null;
  }

  /** 配方 → 3×3 网格（用于一键摆放） */
  function fillGrid(rec) {
    const grid = new Array(9).fill(0);
    if (rec.shapeless) {
      rec.shapeless.forEach((id, i) => { grid[i] = id; });
      return grid;
    }
    for (let r = 0; r < rec.pattern.length; r++) {
      for (let c = 0; c < rec.pattern[r].length; c++) {
        grid[r * 3 + c] = rec.pattern[r][c] || 0;
      }
    }
    return grid;
  }

  MC.RECIPES = RECIPES;
  MC.craftMatch = match;
  MC.craftFill = fillGrid;
  MC.craftIngredients = (rec) => (rec.shapeless || rec.pattern.flat()).filter(Boolean);
})();

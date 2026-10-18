/* 浏览器验收：使用调用者提供的 Playwright 和 Chrome，不加入游戏依赖。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.MC_PLAYWRIGHT_PATH || 'playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.MC_CHROME_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 680 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href +
      '?auto=1&seed=2024&debug=1');
    await page.waitForFunction(() => window.__mc?.state.mode === 'playing', null, { timeout: 120000 });
    await page.waitForFunction(() => __mc.horizon.phase === 'idle' &&
      [...__mc.world.chunks.values()].filter(c => c.gpu).length >= 289, null, { timeout: 60000 });
    const initial = await page.evaluate(() => ({ fps: __mc.state.fps, faces: __mc.renderer.stats.faces,
      farTriangles: __mc.horizon.mesh.count / 3, glError: __mc.renderer.gl.getError() }));
    assert.equal(initial.glError, 0);
    if (process.env.MC_SCREENSHOT) await page.screenshot({ path: process.env.MC_SCREENSHOT });

    // 任务轨道已经拆掉：没有手册、没有罗盘、没有追踪目标。
    const removed = await page.evaluate(() => ({
      compass: !!document.querySelector('#compass'),
      journal: !!document.querySelector('#journal'),
      objective: !!document.querySelector('#objective'),
      tracked: 'tracked' in __mc.state,
      expedition: 'expedition' in __mc,
      eggs: __mc.secrets.list().length,
      touchMode: __mc.touchMode,
      touchDisplay: getComputedStyle(document.querySelector('#touch')).display
    }));
    assert.equal(removed.compass, false);
    assert.equal(removed.journal, false);
    assert.equal(removed.objective, false);
    assert.equal(removed.tracked, false);
    assert.equal(removed.expedition, false);
    assert(removed.eggs >= 12);
    assert.equal(removed.touchMode, false);
    assert.equal(removed.touchDisplay, 'none');

    // 走到原点，右键读石碑：打开纸质手记并记入存档。
    const origin = await page.evaluate(() => __mc.world.sites.find(s => s.type === 'origin'));
    await page.evaluate(({ origin }) => {
      const p = __mc.player;
      p.flying = true;
      p.pos = [origin.x + 0.5, origin.y + 2, origin.z + 4.5];
      p.yaw = 0; p.pitch = -0.5;
    }, { origin });
    await page.waitForFunction(({ origin }) => __mc.world.getBlock(origin.x, origin.y + 1, origin.z) ===
      window.MC.Block.TABLET, { origin }, { timeout: 30000 });
    await page.waitForTimeout(500);
    await page.mouse.move(500, 340);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(180);
    await page.mouse.up({ button: 'right' });
    await page.waitForFunction(() => __mc.state.mode === 'reading', null, { timeout: 5000 });
    const read = await page.evaluate(() => ({
      title: document.querySelector('#readTitle').textContent,
      seen: !!__mc.state.seen.origin,
      explored: __mc.state.explored.length
    }));
    assert(read.title.includes('原点'));
    assert.equal(read.seen, true);
    assert(read.explored >= 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 事件类彩蛋：远影、月圆羊、极光、流星、KONAMI。
    await page.evaluate(() => {
      const p = __mc.player, s = __mc.world.spawn;
      p.flying = true; p.pos = [s.x, s.y + 1, s.z]; p.yaw = 0; p.pitch = 0;
    });
    await page.waitForTimeout(2200);
    const events = await page.evaluate(() => {
      const figure = __mc.secrets.trigger('figure');
      const moon = __mc.secrets.trigger('moon');
      const aurora = __mc.secrets.trigger('aurora');
      const meteor = __mc.secrets.trigger('meteor');
      const konami = __mc.secrets.trigger('konami');
      return {
        figure, moon, aurora, meteor, konami,
        auroraClass: document.querySelector('#aurora').className,
        meteorClass: document.querySelector('#meteors').className,
        sheep: !!__mc.secrets.moonSheep,
        boxes: (() => { const a = []; __mc.secrets.collect(a); return a.length; })(),
        seenKonami: !!__mc.state.seen.konami
      };
    });
    assert.equal(events.figure, true);
    assert.equal(events.moon, true);
    assert.equal(events.sheep, true);
    assert.equal(events.aurora, true);
    assert.equal(events.meteor, true);
    assert.equal(events.konami, true);
    assert(events.auroraClass.includes('show'));
    assert(events.meteorClass.includes('show'));
    assert(events.boxes >= 6);
    assert.equal(events.seenKonami, true);

    // 结构类彩蛋：日志文本存在，调试入口能直接触发。
    const structures = await page.evaluate(() => {
      const out = {};
      for (const type of ['missing', 'sword', 'tablets', 'cabin', 'ship', 'sky', 'bench', 'cairn', 'cave']) {
        const lore = __mc.secrets.trigger(type);
        out[type] = !!lore && !!lore.title;
      }
      out.seenTablets = __mc.secrets.seenTablets();
      return out;
    });
    for (const [type, ok] of Object.entries(structures)) {
      if (type !== 'seenTablets') assert.equal(ok, true, type);
    }
    assert(structures.seenTablets >= 1);

    // 画面设置仍然独立持久化。
    await page.keyboard.press('Escape');
    await page.locator('.graphicsSettings summary').click();
    await page.selectOption('#viewDistance', '6');
    await page.selectOption('#resolution', '0.85');
    await page.locator('#fov').fill('85');
    await page.locator('#shadowBtn').click();
    await page.locator('#particleBtn').click();
    await page.waitForTimeout(300);
    const changed = await page.evaluate(() => ({ ...__mc.settings.values, width: __mc.renderer.canvas.width }));
    assert.equal(changed.width, 850);
    assert.equal(changed.distance, 6);
    assert.equal(changed.fov, 85);
    assert.equal(changed.shadows, false);
    assert.equal(changed.particles, false);
    await page.locator('#primary').click();
    await page.waitForFunction(() => __mc.state.mode === 'playing', null, { timeout: 10000 });
    await page.evaluate(() => {
      __mc.player.flying = true;
      __mc.player.pos[1] = 115;
      window.dispatchEvent(new Event('pagehide'));
    });
    await page.reload();
    await page.waitForFunction(() => window.__mc?.state.mode === 'playing', null, { timeout: 120000 });
    const restored = await page.evaluate(() => ({ ...__mc.settings.values,
      y: __mc.player.pos[1], flying: __mc.player.flying,
      originSeen: !!__mc.state.seen.origin, explored: __mc.state.explored.length,
      tracked: 'tracked' in __mc.state, eggs: __mc.secrets.list().length }));
    assert.equal(restored.fov, 85);
    assert.equal(restored.distance, 6);
    assert.equal(restored.shadows, false);
    assert.equal(restored.particles, false);
    assert.equal(restored.y, 115);
    assert.equal(restored.flying, true);
    assert.equal(restored.originSeen, true);
    assert(restored.explored >= 1);
    assert.equal(restored.tracked, false);
    assert(restored.eggs >= 12);

    // 跨过原点检查负区块坐标、旧区块卸载和新远景替换。
    await page.evaluate(() => { __mc.player.pos[0] = -50; __mc.player.pos[2] = -50; });
    await page.waitForFunction(() => __mc.horizon.phase === 'idle' && __mc.horizon.originX < -512 &&
      [...__mc.world.chunks.values()].filter(c => c.gpu).length >= 169, null, { timeout: 60000 });
    const moved = await page.evaluate(() => ({ chunks: __mc.world.chunks.size,
      mask: __mc.renderer.nearMask.some(v => v === 255), gl: __mc.renderer.gl.getError() }));
    assert(moved.chunks <= 289);
    assert(moved.mask);
    assert.equal(moved.gl, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ initial, removed, read, events, structures, changed, restored, moved, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

/* 栖野桌面浏览器验收。由调用者提供 Playwright 与 Chrome。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.MC_PLAYWRIGHT_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.MC_CHROME_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href + '?auto=1&seed=2024&debug');
    await page.waitForFunction(() => window.__mc?.state.mode === 'playing', null, { timeout: 120000 });

    assert.equal(await page.title(), '栖野 · 一座可以亲手布置的世界');
    assert.equal(await page.locator('#sceneDock button').count(), 4);
    assert.equal(await page.evaluate(() => __mc.touchMode), false);
    assert.equal(await page.evaluate(() => __mc.state.hotbar[0].id), 1);

    // 准星正中：桌面和手机共用同一套定位。
    const crosshair = await page.evaluate(() => {
      const b = document.getElementById('crosshair').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, vx: innerWidth / 2, vy: innerHeight / 2 };
    });
    assert(Math.abs(crosshair.x - crosshair.vx) < 0.6, '准星应在水平正中');
    assert(Math.abs(crosshair.y - crosshair.vy) < 0.6, '准星应在垂直正中');

    // 可见区块应合并进共享页：支持 multi-draw 时绘制命令远少于区块数。
    const batching = await page.evaluate(() => ({
      multi: !!__mc.renderer.multiDraw,
      pages: __mc.renderer.pages.length,
      batches: __mc.renderer.stats.batches,
      drawn: __mc.renderer.stats.drawn,
      gl: __mc.renderer.gl.getError()
    }));
    assert.equal(batching.gl, 0);
    if (batching.multi) assert(batching.batches < batching.drawn, '可见区块应合并成更少的绘制批次');

    await page.keyboard.press('e');
    assert.equal(await page.evaluate(() => __mc.state.mode), 'inventory');
    await page.locator('#paletteTabs button').filter({ hasText: '树木' }).click();
    await page.locator('#paletteGrid button').filter({ hasText: '樱花树叶' }).click();
    assert.equal(await page.evaluate(() => __mc.state.mode), 'playing');
    assert.equal(await page.evaluate(() => __mc.state.hotbar[0].id), 28);

    const before = await page.evaluate(() => __mc.state.time);
    await page.keyboard.press('t');
    assert(await page.evaluate(() => __mc.state.time) > before);

    await page.keyboard.press('p');
    assert.equal(await page.evaluate(() => __mc.state.mode), 'photo');
    await page.locator('#photoZoom').evaluate(input => {
      input.value = '45';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#photoShutter').click();
    await page.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem('mcweb.landscape.photos.2024') || '[]');
      return saved.length === 1 && saved[0].url.startsWith('data:image/jpeg;base64,');
    }, null, { timeout: 10000 });
    await page.locator('#photoClose').click();
    await page.keyboard.press('g');
    assert.equal(await page.locator('#galleryGrid .photoCard').count(), 1);
    await page.locator('#galleryClose').click();

    // 补给箱不再有「一键收下」：点哪一样拿哪一样。
    const chest = await page.evaluate(() => {
      __mc.debug.teleport(__mc.world.outpostChest.x + 0.5, __mc.world.outpostChest.y, __mc.world.outpostChest.z + 0.5);
      return __mc.world.outpostChest;
    });
    await page.waitForTimeout(1500);
    await page.keyboard.press('r');
    await page.waitForFunction(() => __mc.state.mode === 'loot', null, { timeout: 5000 });
    assert.equal(await page.locator('#lootTake').count(), 0);
    assert.equal(await page.locator('.lootItem').count(), 6);
    const firstBefore = await page.locator('.lootItem').first().innerText();
    await page.locator('.lootItem').first().click();
    const firstAfter = await page.locator('.lootItem').first().innerText();
    assert.notEqual(firstBefore, firstAfter);
    assert(await page.locator('.lootItem').first().isDisabled());
    assert.equal(await page.locator('.lootItem:not([disabled])').count(), 5);
    await page.locator('#lootClose').click();
    assert.equal(await page.evaluate(() => __mc.state.mode), 'playing');

    // 走进传送门就穿越，不再需要按钮。
    await page.evaluate(() => {
      const p = __mc.world.outpostPortal;
      __mc.player.flying = true;
      __mc.player.pos = [p.x + 1.5, p.y + 1.1, p.z + 0.5];
      __mc.player.vel.fill(0);
    });
    await page.waitForFunction(() => __mc.world.isNether(__mc.player.pos[0], __mc.player.pos[2]),
      null, { timeout: 8000 });
    assert(chest && await page.evaluate(() => __mc.world.isNether(__mc.player.pos[0], __mc.player.pos[2])));

    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload();
    await page.waitForFunction(() => window.__mc?.state.mode === 'playing', null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => __mc.state.hotbar[0].id), 28);
    await page.keyboard.press('g');
    assert.equal(await page.locator('#galleryGrid .photoCard').count(), 1);
    assert.deepEqual(errors, []);
    console.log('PASS: 桌面素材、时光、拍照、相册与重新载入');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

/* 栖野触屏布局验收。由调用者提供 Playwright 与 Chrome。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, devices } = require(process.env.MC_PLAYWRIGHT_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.MC_CHROME_PATH, headless: true });
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href + '?auto=1&seed=2025');
    await page.waitForFunction(() => window.__mc?.state.mode === 'playing', null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => __mc.touchMode), true);
    assert.equal(await page.locator('#touchMine').count(), 0);

    // 手机准星同样居中。
    const ch = await page.evaluate(() => {
      const b = document.getElementById('crosshair').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, vx: innerWidth / 2, vy: innerHeight / 2 };
    });
    assert(Math.abs(ch.x - ch.vx) < 1 && Math.abs(ch.y - ch.vy) < 1);

    // 浮动摇杆：手指落在左半屏哪里，摇杆就出现在哪里。
    const stickPt = await page.evaluate(() => {
      const r = document.getElementById('stickZone').getBoundingClientRect();
      return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5) };
    });
    await page.locator('#stickZone').dispatchEvent('pointerdown',
      { pointerId: 21, pointerType: 'touch', clientX: stickPt.x, clientY: stickPt.y, buttons: 1 });
    const movedStick = await page.evaluate(() => {
      const b = document.getElementById('stickBase').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, floating: document.getElementById('stickBase').classList.contains('floating') };
    });
    assert(movedStick.floating && Math.abs(movedStick.x - stickPt.x) < 2 && Math.abs(movedStick.y - stickPt.y) < 2,
      '摇杆应浮到手指位置');
    await page.locator('#stickZone').dispatchEvent('pointerup',
      { pointerId: 21, pointerType: 'touch', clientX: stickPt.x, clientY: stickPt.y });
    await page.waitForTimeout(260);
    const homeStick = await page.evaluate(() => {
      const b = document.getElementById('stickBase').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    assert(Math.hypot(homeStick.x - stickPt.x, homeStick.y - stickPt.y) > 40, '松手后摇杆应回到左下角');

    // 短按放方块、长按拆方块。
    const spot = await page.evaluate(() => {
      const p = __mc.player, w = __mc.world;
      const x = Math.floor(w.spawn.x), z = Math.floor(w.spawn.z), h = w.heightAt(x, z);
      p.flying = true;
      p.pos = [x + 0.5, h + 2.6, z + 0.5];
      p.vel.fill(0);
      p.pitch = -1.5;
      p.yaw = 0;
      return { x, z, h, before: w.getBlock(x, h + 1, z), hotbar: __mc.state.hotbar[__mc.state.selected].id };
    });
    await page.waitForTimeout(250);
    await page.locator('#touchPlace').dispatchEvent('pointerdown', { pointerId: 31, pointerType: 'touch', buttons: 1 });
    await page.waitForTimeout(60);
    await page.locator('#touchPlace').dispatchEvent('pointerup', { pointerId: 31, pointerType: 'touch' });
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(s => __mc.world.getBlock(s.x, s.h + 1, s.z), spot), spot.hotbar,
      '短按应放置方块');
    await page.locator('#touchPlace').dispatchEvent('pointerdown', { pointerId: 32, pointerType: 'touch', buttons: 1 });
    await page.waitForTimeout(520);
    await page.locator('#touchPlace').dispatchEvent('pointerup', { pointerId: 32, pointerType: 'touch' });
    await page.waitForTimeout(160);
    assert.equal(await page.evaluate(s => __mc.world.getBlock(s.x, s.h + 1, s.z), spot), 0,
      '长按应拆除方块');
    await page.evaluate(() => { __mc.player.flying = false; });

    const portrait = await page.evaluate(() => {
      const rect = id => document.getElementById(id).getBoundingClientRect();
      const quick = rect('touchQuick'), actions = rect('touchBtns'), bar = rect('hotbar');
      return {
        quickVisible: getComputedStyle(document.getElementById('touchQuick')).display !== 'none',
        quickAboveActions: quick.bottom < actions.top,
        barInside: bar.left >= 0 && bar.right <= innerWidth,
        gl: __mc.renderer.gl.getError()
      };
    });
    assert(portrait.quickVisible && portrait.quickAboveActions && portrait.barInside);
    assert.equal(portrait.gl, 0);

    await page.locator('#touchBag').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch' });
    assert.equal(await page.evaluate(() => __mc.state.mode), 'inventory');
    await page.locator('#paletteGrid .landscapeItem').first().click();
    assert.equal(await page.evaluate(() => __mc.state.mode), 'playing');

    await page.locator('#touchPhoto').dispatchEvent('pointerdown', { pointerId: 8, pointerType: 'touch' });
    assert.equal(await page.evaluate(() => __mc.state.mode), 'photo');
    const timeBefore = await page.evaluate(() => __mc.state.time);
    await page.locator('#photoTime').click();
    assert(await page.evaluate(() => __mc.state.time) > timeBefore);
    await page.locator('#photoShutter').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mcweb.landscape.photos.2025') || '[]').length === 1,
      null, { timeout: 10000 });
    await page.locator('#photoClose').click();
    await page.locator('#touchGallery').dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'touch' });
    assert.equal(await page.locator('#galleryGrid .photoCard').count(), 1);
    await page.locator('#galleryClose').click();

    await page.setViewportSize({ width: 844, height: 390 });
    const landscape = await page.evaluate(() => {
      const quick = document.getElementById('touchQuick').getBoundingClientRect();
      const actions = document.getElementById('touchBtns').getBoundingClientRect();
      return { separate: quick.bottom < actions.top, mapHidden: getComputedStyle(document.getElementById('miniMapWrap')).display === 'none' };
    });
    assert(landscape.separate && landscape.mapHidden);
    assert.deepEqual(errors, []);
    console.log('PASS: 手机竖屏与横屏、素材、拍照和相册');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

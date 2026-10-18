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

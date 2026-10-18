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
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href + '?auto=1&seed=2024');
    await page.waitForFunction(() => window.__mc?.state.mode === 'playing', null, { timeout: 120000 });

    assert.equal(await page.title(), '栖野 · 一座可以亲手布置的世界');
    assert.equal(await page.locator('#sceneDock button').count(), 4);
    assert.equal(await page.evaluate(() => __mc.touchMode), false);
    assert.equal(await page.evaluate(() => __mc.state.hotbar[0].id), 1);

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

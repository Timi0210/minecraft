/* 手机触屏验收：使用调用者提供的 Playwright 和 Chrome。 */
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
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href +
      '?auto=1&seed=2024&debug=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__mc?.state.mode === 'playing', null, { timeout: 120000 });
    await page.waitForTimeout(1800);

    const initial = await page.evaluate(() => {
      const hint = document.querySelector('#touchHint').getBoundingClientRect();
      const map = document.querySelector('#miniMapWrap').getBoundingClientRect();
      const slot = document.querySelector('#hotbar .slot').getBoundingClientRect();
      return {
        touchMode: __mc.touchMode, inputMode: __mc.inputMode,
        body: document.body.className,
        display: getComputedStyle(document.querySelector('#touch')).display,
        hintShown: document.querySelector('#touchHint').className.includes('show'),
        hintBelowMap: hint.top >= map.bottom - 1,
        slot: slot.width,
        gl: __mc.renderer.gl.getError()
      };
    });
    assert.equal(initial.touchMode, true);
    assert.equal(initial.inputMode, 'auto');
    assert(initial.body.includes('touch-mode'));
    assert.equal(initial.display, 'block');
    assert(initial.hintShown);
    assert(initial.hintBelowMap);
    assert(initial.slot >= 32);
    assert.equal(initial.gl, 0);

    // 摇杆：模拟指针拖动，玩家应移动。
    const moved = await page.evaluate(async () => {
      const base = document.querySelector('#stickBase');
      const r = base.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ev = (type, x, y) => base.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', clientX: x, clientY: y
      }));
      const p0 = __mc.player.pos.slice();
      ev('pointerdown', cx, cy);
      ev('pointermove', cx, cy - r.height * 0.3);
      await new Promise(resolve => setTimeout(resolve, 650));
      const p1 = __mc.player.pos.slice();
      ev('pointerup', cx, cy - r.height * 0.3);
      return Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    });
    assert(moved > 0.3, 'joystick should move player');

    // 视角拖动。
    const looked = await page.evaluate(() => {
      const look = document.querySelector('#touchLook');
      const ev = (type, x, y) => look.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 12, pointerType: 'touch', clientX: x, clientY: y
      }));
      const y0 = __mc.player.yaw;
      ev('pointerdown', 200, 300);
      ev('pointermove', 320, 300);
      ev('pointerup', 320, 300);
      return Math.abs(__mc.player.yaw - y0);
    });
    assert(looked > 0.2, 'look drag should rotate');

    // 动作按钮与快捷栏。
    const buttons = await page.evaluate(async () => {
      const down = (sel, id) => document.querySelector(sel).dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch' }));
      const up = (sel, id) => document.querySelector(sel).dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch' }));
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      down('#touchFly', 21); up('#touchFly', 21); await sleep(80);
      const flying = __mc.player.flying;
      const downVisible = getComputedStyle(document.querySelector('#touchDown')).display;

      down('#touchJump', 22);
      const jumpDown = __mc.touchState.jump;
      up('#touchJump', 22);
      const jumpUp = __mc.touchState.jump;

      down('#touchMine', 23);
      const mineDown = __mc.state.mouseDown[0];
      up('#touchMine', 23);
      const mineUp = __mc.state.mouseDown[0];

      down('#touchPlace', 24);
      const placeDown = __mc.state.mouseDown[1];
      up('#touchPlace', 24);
      const placeUp = __mc.state.mouseDown[1];

      const slot = document.querySelectorAll('#hotbar .slot')[2];
      slot.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 25, pointerType: 'touch'
      }));
      const selected = __mc.state.selected;

      down('#touchBag', 26); up('#touchBag', 26); await sleep(150);
      const bagMode = __mc.state.mode;
      document.querySelector('#invClose').click(); await sleep(150);
      const back = __mc.state.mode;

      down('#touchMenu', 27); up('#touchMenu', 27); await sleep(150);
      const pauseMode = __mc.state.mode;
      const touchHidden = document.querySelector('#touch').className.includes('hide');
      return { flying, downVisible, jumpDown, jumpUp, mineDown, mineUp,
        placeDown, placeUp, selected, bagMode, back, pauseMode, touchHidden };
    });
    assert.equal(buttons.flying, true);
    assert.equal(buttons.downVisible, 'block');
    assert.equal(buttons.jumpDown, true);
    assert.equal(buttons.jumpUp, false);
    assert.equal(buttons.mineDown, true);
    assert.equal(buttons.mineUp, false);
    assert.equal(buttons.placeDown, true);
    assert.equal(buttons.placeUp, false);
    assert.equal(buttons.selected, 2);
    assert.equal(buttons.bagMode, 'inventory');
    assert.equal(buttons.back, 'playing');
    assert.equal(buttons.pauseMode, 'paused');
    assert.equal(buttons.touchHidden, true);

    // 暂停页继续；触屏模式仍在。
    await page.locator('#primary').click();
    await page.waitForFunction(() => __mc.state.mode === 'playing');
    const resumed = await page.evaluate(() => ({ touch: __mc.touchMode, input: __mc.inputMode }));
    assert.equal(resumed.touch, true);
    assert.equal(resumed.input, 'auto');

    if (process.env.MC_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.MC_MOBILE_SCREENSHOT });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ initial, moved, looked, buttons, resumed, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

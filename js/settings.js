/* settings.js — 独立于世界存档的画面偏好，容错读取并限制取值范围。 */
(function () {
  'use strict';
  const MC = window.MC;
  const KEY = 'mcweb.settings.v1';
  class Settings {
    constructor(storage) {
      this.storage = storage;
      let saved = {};
      try { saved = JSON.parse(storage.getItem(KEY)) || {}; } catch (_) { /* 存储不可用时使用默认值。 */ }
      this.values = Settings.normalize(saved);
    }
    static normalize(value) {
      const v = value && typeof value === 'object' ? value : {};
      return {
        distance: [8, 10, 12].includes(v.distance) ? v.distance : 10,
        resolution: [0.65, 0.85, 1].includes(v.resolution) ? v.resolution : 1,
        fov: Number.isFinite(v.fov) ? Math.max(55, Math.min(95, v.fov)) : 65,
        shadows: typeof v.shadows === 'boolean' ? v.shadows : true,
        particles: typeof v.particles === 'boolean' ? v.particles : true,
        inputMode: ['auto', 'touch', 'mouse'].includes(v.inputMode) ? v.inputMode : 'auto'
      };
    }
    set(key, value) {
      this.values = Settings.normalize({ ...this.values, [key]: value });
      try { this.storage.setItem(KEY, JSON.stringify(this.values)); } catch (_) { /* 本次设置仍即时生效。 */ }
      return this.values;
    }
  }
  MC.Settings = Settings;
})();

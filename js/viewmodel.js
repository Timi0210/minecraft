/* viewmodel.js — 空手时的第一人称手臂与挥手动画 */
(function () {
  'use strict';
  const MC = window.MC;

  // Column-major T * Rz * Ry * Rx * S, used by the arm and sleeve.
  function pose(out, x, y, z, rx, ry, rz, sx, sy, sz) {
    const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry);
    const e = Math.cos(rz), f = Math.sin(rz);
    out[0] = e * c * sx; out[1] = f * c * sx; out[2] = -d * sx; out[3] = 0;
    out[4] = (e * d * b - f * a) * sy;
    out[5] = (f * d * b + e * a) * sy; out[6] = c * b * sy; out[7] = 0;
    out[8] = (e * d * a + f * b) * sz;
    out[9] = (f * d * a - e * b) * sz; out[10] = c * a * sz; out[11] = 0;
    out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
    return out;
  }

  class ViewModel {
    constructor(renderer) {
      this.renderer = renderer;
      this.proj = MC.M4.create();
      this.root = MC.M4.create();
      this.local = MC.M4.create();
      this.model = MC.M4.create();
    }

    draw(mesh, x, y, z, rx, ry, rz, sx, sy, sz) {
      if (!mesh) return;
      const r = this.renderer, gl = r.gl;
      pose(this.local, x, y, z, rx, ry, rz, sx, sy, sz);
      MC.M4.mul(this.model, this.root, this.local);
      gl.uniformMatrix4fv(r.uMain.uModel, false, this.model);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    }

    render(hand, aspect, light, underwater) {
      const r = this.renderer, gl = r.gl, u = r.uMain;
      if (hand.itemId) return;

      const progress = Math.max(0, Math.min(1, hand.swing));
      const stroke = Math.sin(progress * Math.PI), arc = Math.sin(Math.sqrt(progress) * Math.PI);
      const bobX = Math.cos(hand.bobPhase) * 0.018 * hand.bobAmount;
      const bobY = Math.sin(hand.bobPhase * 2) * 0.015 * hand.bobAmount;
      pose(this.root, 0.80 * aspect / (16 / 9) + bobX - stroke * 0.25,
        -0.34 + bobY + stroke * 0.08, -1.0 - arc * 0.12,
        -0.48 - arc * 0.50, -0.16 - arc * 0.40, 0.18 - stroke * 0.55, 1, 1, 1);

      // A separate projection keeps the hand stable while the world FOV changes.
      MC.M4.perspective(this.proj, 65 * Math.PI / 180, aspect, 0.025, 10);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(r.progMain);
      gl.uniformMatrix4fv(u.uVP, false, this.proj);
      gl.uniform3f(u.uCamPos, 0, 0, 0);
      gl.uniform1f(u.uFogNear, 100);
      gl.uniform1f(u.uFogFar, 200);
      gl.uniform1f(u.uShadowOn, 0);
      gl.uniform1f(u.uAlpha, 1);
      gl.uniform3f(u.uLightDir, -0.36, 0.80, 0.48);
      gl.uniform3fv(u.uAmbient, underwater ? [0.43, 0.60, 0.69] : [0.35 + light.day * 0.35, 0.39 + light.day * 0.32, 0.49 + light.day * 0.25]);
      gl.uniform3fv(u.uDirect, underwater ? [0.13, 0.13, 0.15] : [0.10 + light.day * 0.22, 0.10 + light.day * 0.20, 0.14 + light.day * 0.15]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, r.texture);
      gl.uniform1i(u.uTex, 0);

      const t = MC.Atlas.index;
      const skin = r.getMobCube({ top: t.arm_end, side: t.arm_skin, bottom: t.arm_skin });
      const sleeve = r.getMobCube({ top: t.arm_sleeve, side: t.arm_sleeve, bottom: t.arm_sleeve });
      this.draw(skin, 0, -0.07, 0, 0, 0, 0, 0.235, 0.30, 0.235);
      this.draw(sleeve, 0, -0.38, 0, 0, 0, 0, 0.26, 0.34, 0.26);

      gl.enable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
  }

  MC.ViewModel = ViewModel;
})();

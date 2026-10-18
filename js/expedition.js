/* expedition.js — 世界地标、方向指引和探索手册。 */
(function () {
  'use strict';
  const MC = window.MC;
  const $ = id => document.getElementById(id);

  class Expedition {
    constructor(world, state, onChange, onDiscover) {
      this.world = world;
      this.state = state;
      this.onChange = onChange;
      this.onDiscover = onDiscover;
      this.journal = $('journal');
      this.grid = $('journalGrid');
      this.progress = $('journalProgress');
      this.needle = $('compassNeedle');
      this.target = $('targetName');
      this.distance = $('targetDistance');
      this.track = world.landmarks.find(p => p.id === state.tracked) || world.landmarks[1];
      this.state.tracked = this.track.id;
      this.drawJournal();
    }

    open() {
      this.drawJournal();
      this.journal.classList.remove('hide');
    }

    close() { this.journal.classList.add('hide'); }

    choose(id) {
      const found = this.world.landmarks.find(p => p.id === id);
      if (!found) return;
      this.track = found;
      this.state.tracked = id;
      this.drawJournal();
      this.onChange();
    }

    drawJournal() {
      const discovered = this.state.discovered;
      this.progress.textContent = discovered.length + ' / ' + this.world.landmarks.length + ' 处已发现';
      this.grid.replaceChildren();
      for (const point of this.world.landmarks) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'journeyCard' + (point.id === this.track.id ? ' tracked' : '') +
          (discovered.includes(point.id) ? ' found' : '');
        card.innerHTML = '<span class="journeyIcon"></span><span class="journeyBody"><b></b><small></small></span><span class="journeyStatus"></span>';
        card.querySelector('.journeyIcon').textContent = point.icon;
        card.querySelector('b').textContent = point.name;
        card.querySelector('small').textContent = point.note;
        card.querySelector('.journeyStatus').textContent = point.id === this.track.id ? '追踪中' :
          discovered.includes(point.id) ? '已到访' : '标记路线 ↗';
        card.addEventListener('click', () => this.choose(point.id));
        this.grid.appendChild(card);
      }
    }

    update(player) {
      const target = this.track;
      const dx = target.x - player.pos[0], dz = target.z - player.pos[2];
      const distance = Math.hypot(dx, dz);
      const targetYaw = Math.atan2(-dx, -dz);
      let delta = targetYaw - player.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const clamped = Math.max(-1, Math.min(1, delta / (Math.PI * 0.72)));
      this.needle.style.left = (50 + clamped * 43) + '%';
      this.target.textContent = target.name;
      this.distance.textContent = Math.round(distance) + ' 格';
      for (const point of this.world.landmarks) {
        if (this.state.discovered.includes(point.id)) continue;
        if (Math.hypot(point.x - player.pos[0], point.z - player.pos[2]) < 11 &&
            Math.abs(point.y - player.pos[1]) < 16) {
          this.state.discovered.push(point.id);
          this.drawJournal();
          this.onDiscover(point);
          this.onChange();
        }
      }
    }
  }

  MC.Expedition = Expedition;
})();

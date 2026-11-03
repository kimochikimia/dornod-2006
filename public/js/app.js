(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Гар утасны цэс
    var toggle = $('[data-nav-toggle]');
    if (toggle) toggle.addEventListener('click', function () { $('[data-nav]').classList.toggle('open'); });

    // Нэвтрэх/бүртгүүлэх цонхны × товч: өмнөх хуудас руу буцна (эсвэл нүүр хуудас). Esc дарахад ч хаагдана.
    var closeBtn = $('[data-modal-close]');
    if (closeBtn) {
      var ref = null;
      try { ref = document.referrer ? new URL(document.referrer) : null; } catch (e) { ref = null; }
      var canGoBack = ref && ref.origin === location.origin && !/^\/(login|register)/.test(ref.pathname);
      if (canGoBack) closeBtn.href = ref.pathname + ref.search;
      document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') location.href = closeBtn.href; });
    }

    // data-confirm бүхий маягт илгээхээс өмнө баталгаажуулна
    $$('form[data-confirm]').forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        if (!window.confirm(f.getAttribute('data-confirm'))) ev.preventDefault();
      });
    });

    // Төлөв сонгоход маягтыг шууд илгээнэ
    $$('form[data-autosubmit] select').forEach(function (sel) {
      var prev = sel.value;
      sel.addEventListener('change', function () {
        var label = sel.options[sel.selectedIndex].text;
        if (window.confirm('Төлөвийг "' + label + '" болгох уу?')) sel.form.submit();
        else sel.value = prev;
      });
    });

    initCountdowns();
    initScheduleForm();
    initBallot();
    initLive();
    initPlanForm();
  });

  // ---------- Хугацааны тоолуур: data-countdown="ISO огноо" ----------
  function initCountdowns() {
    var els = $$('[data-countdown]');
    if (!els.length) return;
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function tick() {
      els.forEach(function (el) {
        var left = new Date(el.getAttribute('data-countdown')).getTime() - Date.now();
        if (left <= 0) {
          el.textContent = 'Одоо';
          if (el.hasAttribute('data-reload') && !el.dataset.reloading) {
            el.dataset.reloading = '1';
            setTimeout(function () { location.reload(); }, 2500);
          }
          return;
        }
        var s = Math.floor(left / 1000);
        var d = Math.floor(s / 86400); s -= d * 86400;
        var hh = Math.floor(s / 3600); s -= hh * 3600;
        var mm = Math.floor(s / 60); s -= mm * 60;
        el.textContent = (d ? d + ' өдөр ' : '') + pad(hh) + ':' + pad(mm) + ':' + pad(s);
      });
    }
    tick();
    setInterval(tick, 1000);
  }

  // ---------- Сонгуулийн маягт: автомат горим унтраалттай үед хуваарийг бүдэгрүүлнэ ----------
  function initScheduleForm() {
    var box = $('[data-auto-schedule]');
    var fields = $('[data-schedule-fields]');
    if (!box || !fields) return;
    function update() {
      fields.classList.toggle('off', !box.checked);
      $$('input', fields).forEach(function (i) { i.required = box.checked; });
    }
    box.addEventListener('change', update);
    update();
  }

  // ---------- Төлөвлөгөөний маягт: чухал үед дуусах огноо хэрэггүй ----------
  function initPlanForm() {
    var kind = $('[data-plan-kind]');
    var end = $('[data-plan-end]');
    if (!kind || !end) return;
    function update() { end.style.display = kind.value === 'milestone' ? 'none' : ''; }
    kind.addEventListener('change', update);
    update();
  }

  // ---------- Саналын хуудас: сонголтын хязгаар ----------
  function initBallot() {
    var form = $('[data-ballot]');
    if (!form) return;
    var max = Number(form.getAttribute('data-max')) || 1;
    var boxes = $$('input[name="choices"]', form);
    var counter = $('[data-ballot-count]', form);
    var submit = $('[data-ballot-submit]', form);

    function update() {
      var n = boxes.filter(function (b) { return b.checked; }).length;
      counter.textContent = n;
      submit.disabled = n === 0;
      boxes.forEach(function (b) {
        var full = n >= max && !b.checked;
        b.disabled = full;
        b.closest('.ballot-option').classList.toggle('checked', b.checked);
        b.closest('.ballot-option').classList.toggle('disabled', full);
      });
    }
    boxes.forEach(function (b) { b.addEventListener('change', update); });
    update();
  }

  // ---------- Сонгуулийн шууд явц ----------
  function initLive() {
    var root = $('#live');
    if (!root) return;
    var url = root.getAttribute('data-url');
    var poll = Number(root.getAttribute('data-poll')) || 0;
    var lastBallots = null;

    try { render(JSON.parse(root.getAttribute('data-initial'))); } catch (e) { /* ignore */ }

    if (poll > 0) {
      setInterval(function () {
        if (document.hidden) return;
        fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.phase && d.phase !== 'voting') return window.location.reload();
            render(d);
          })
          .catch(function () { /* сүлжээний түр алдаа */ });
      }, poll);
    }

    function set(key, val) { $$('[data-k="' + key + '"]', root).forEach(function (el) { el.textContent = val; }); }

    function render(d) {
      if (!d || d.ballots == null) return;
      set('ballots', d.ballots);
      set('eligible', d.eligible);
      set('turnout', d.turnout + '%');
      set('avgChoices', d.avgChoices);
      set('period', d.startedAt ? ('Эхэлсэн: ' + d.startedAt + (d.endedAt ? ' · Дууссан: ' + d.endedAt : '')) : '');
      var donut = $('[data-donut]', root);
      if (donut) donut.style.setProperty('--p', Math.min(100, d.turnout));
      var upd = $('[data-live-updated]', root);
      if (upd) upd.textContent = (d.phase === 'voting' ? '● Шинэчлэгдсэн: ' : 'Эцсийн дүн · ') + d.updatedAt;

      // Нэр дэвшигчдийн санал
      var tally = $('[data-tally]', root);
      if (!d.showTally) {
        tally.innerHTML = '<p class="muted">Нэр дэвшигчдийн авсан саналыг санал хураалт дууссаны дараа нийтэлнэ.</p>';
      } else if (!d.candidates.length) {
        tally.innerHTML = '<p class="muted">Нэр дэвшигч алга.</p>';
      } else {
        var maxVotes = Math.max.apply(null, d.candidates.map(function (c) { return c.votes; }).concat([1]));
        var html = d.candidates.map(function (c) {
          return '<div class="hbar ' + (c.winner && d.phase === 'closed' ? 'winner' : '') + '">' +
            '<div class="name" title="' + esc(c.name + (c.school ? ' — ' + c.school : '')) + '">' + c.rank + '. ' + esc(c.name) + '</div>' +
            '<div class="progress"><span style="width:' + (c.votes / maxVotes * 100) + '%"></span></div>' +
            '<div class="val">' + c.votes + ' санал · ' + c.pct + '%</div></div>';
        }).join('');
        if (d.phase === 'closed') {
          html += '<p class="small muted" style="margin-top:.75rem">★ — удирдах зөвлөлд сонгогдсон (' + d.seats + ' суудал). Хувь нь нийт санал өгсөн хүнд эзлэх хувь.</p>';
          if (d.tie) html += '<div class="flash warn small">Сүүлийн суудалд санал тэнцсэн нэр дэвшигчид байна — шийдвэрийг удирдлага гаргана.</div>';
        }
        tally.innerHTML = html;
      }

      // Сургуулиар
      var schools = $('[data-schools]', root);
      schools.innerHTML = d.bySchool.length ? d.bySchool.map(function (s) {
        return '<div class="hbar"><div class="name">' + esc(s.name) + '</div>' +
          '<div class="progress"><span style="width:' + Math.min(100, s.pct) + '%"></span></div>' +
          '<div class="val">' + s.voted + '/' + s.members + ' · ' + s.pct + '%</div></div>';
      }).join('') : '<p class="muted">Мэдээлэл алга.</p>';

      // Цаг тутмын идэвх
      var hourly = $('[data-hourly]', root);
      if (!d.hourly.length) {
        hourly.innerHTML = '<p class="muted">Санал хараахан ирээгүй байна.</p>';
      } else {
        var hs = d.hourly.slice(-24);
        var hmax = Math.max.apply(null, hs.map(function (x) { return x.count; }));
        hourly.innerHTML = '<div class="cols">' + hs.map(function (x) {
          return '<div class="col" style="height:' + Math.max(4, x.count / hmax * 100) + '%" data-tip="' + esc(x.label + ' — ' + x.count + ' санал') + '"></div>';
        }).join('') + '</div><div class="cols-axis"><span>' + esc(hs[0].label) + '</span><span>' + esc(hs[hs.length - 1].label) + '</span></div>';
      }

      // Сүүлд санал өгсөн
      var feed = $('[data-feed]', root);
      var fresh = lastBallots != null && d.ballots > lastBallots ? d.ballots - lastBallots : 0;
      feed.innerHTML = d.recent.length ? d.recent.map(function (r, i) {
        return '<li class="' + (i < fresh ? 'new' : '') + '"><span>🗳️ Санал ирлээ · ' + esc(r.school) + '</span><span class="faint">' + esc(r.at) + '</span></li>';
      }).join('') : '<li class="muted">—</li>';
      lastBallots = d.ballots;
    }
  }
})();

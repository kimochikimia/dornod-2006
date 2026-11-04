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
        // Товч өөрийн асуулттай бол (жишээ нь нэр дэвшигч бүрийн "Санал өгөх") түүнийг ашиглана.
        var msg = (ev.submitter && ev.submitter.getAttribute('data-confirm')) || f.getAttribute('data-confirm');
        if (!window.confirm(msg)) ev.preventDefault();
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

    // Жижиг цонх (dialog): нээх, хаах, гадна талд дарахад хаах. Esc-ээр хөтөч өөрөө хаана.
    $$('[data-open-dialog]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dlg = document.getElementById(btn.getAttribute('data-open-dialog'));
        if (!dlg) return;
        dlg.showModal();
        var first = $('input[type=search], select', dlg);
        if (first) first.focus();
      });
    });
    $$('dialog').forEach(function (dlg) {
      $$('[data-close-dialog]', dlg).forEach(function (b) { b.addEventListener('click', function () { dlg.close(); }); });
      dlg.addEventListener('click', function (ev) { if (ev.target === dlg) dlg.close(); });
    });

    // Сонголтын жагсаалтыг хайлтаар шүүх
    $$('[data-filter-select]').forEach(function (input) {
      var sel = document.getElementById(input.getAttribute('data-filter-select'));
      if (!sel) return;
      input.addEventListener('input', function () {
        var q = input.value.trim().toLowerCase();
        var firstVisible = null;
        Array.prototype.forEach.call(sel.options, function (o) {
          var show = !q || o.text.toLowerCase().indexOf(q) !== -1;
          o.hidden = !show;
          if (show && !firstVisible) firstVisible = o;
        });
        // Бүх сонголт нь нуугдсан бүлгийн гарчгийг ч нууна
        Array.prototype.forEach.call(sel.querySelectorAll('optgroup'), function (g) {
          var label = (g.label || '').toLowerCase();
          var groupMatch = q && label.indexOf(q) !== -1;
          if (groupMatch) Array.prototype.forEach.call(g.children, function (o) { o.hidden = false; });
          g.hidden = !Array.prototype.some.call(g.children, function (o) { return !o.hidden; });
          if (groupMatch && !firstVisible) firstVisible = g.children[0];
        });
        if (sel.selectedOptions[0] && sel.selectedOptions[0].hidden) sel.value = '';
        if (q && firstVisible && !sel.value) firstVisible.selected = true;
      });
    });

    // Зөвлөлийн томилгоо: "Томилогдоогүй" үед огноо/шийдвэрийг нууна, албан тушаал сонгоход өнөөдрийн огноог бөглөнө
    // Нэг мөрөнд жагссан томилгооны картад багана нь хөдлөхгүйн тулд visibility-ээр нууна
    function hideField(f, hide) {
      if (f.closest('.board-edit')) f.style.visibility = hide ? 'hidden' : '';
      else f.style.display = hide ? 'none' : '';
    }
    $$('form[data-appoint]').forEach(function (form) {
      var post = $('[data-post]', form);
      if (!post) return;
      function update() {
        var on = post.value !== 'unassigned';
        $$('[data-appoint-field]', form).forEach(function (f) { hideField(f, !on); });
        var d = $('input[data-default-date]', form);
        if (on && d && !d.value) d.value = d.getAttribute('data-default-date');
      }
      post.addEventListener('change', update);
      $$('[data-appoint-field]', form).forEach(function (f) { hideField(f, post.value === 'unassigned'); });
    });

    // Баримт бичгийн хавсралт: файлыг base64 болгож маягтад хийнэ
    // (Нэг хуудсанд олон маягт байж болно — тус бүрийн доторх талбаруудыг ашиглана)
    $$('[data-doc-file]').forEach(function (docFile) {
      var scope = docFile.form || document;
      var $s = function (sel) { return scope.querySelector(sel); };
      docFile.addEventListener('change', function () {
        var f = docFile.files && docFile.files[0];
        var label = $s('[data-doc-file-label]');
        if (!f) return;
        if (f.size > 10 * 1024 * 1024) { window.alert('Файл 10MB-аас ихгүй байх ёстой.'); docFile.value = ''; return; }
        if (!/\.(pdf|docx|doc)$/i.test(f.name)) { window.alert('Зөвхөн PDF эсвэл Word файл сонгоно уу.'); docFile.value = ''; return; }
        var reader = new FileReader();
        label.textContent = 'Уншиж байна...';
        reader.onload = function () {
          var url = String(reader.result);
          // Зарим хөтөч Word файлын төрлийг хоосон өгдөг тул өргөтгөлөөр нь тогтооно
          var ext = f.name.split('.').pop().toLowerCase();
          var mime = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword' }[ext];
          url = url.replace(/^data:[^;]*;/, 'data:' + mime + ';');
          $s('[data-doc-file-data]').value = url;
          $s('[data-doc-file-name]').value = f.name;
          label.textContent = '✓ ' + f.name + ' (' + Math.round(f.size / 1024) + ' KB) — хадгалахад хавсаргагдана';
          var submit = $s('[data-doc-file-submit]');
          if (submit) submit.disabled = false;
        };
        reader.readAsDataURL(f);
      });
    });

    // Амьдарч буй газар: "Бусад" сонгоход аймаг, сумын жагсаалт гарна
    $$('[data-city]').forEach(function (box) {
      var choice = $('[data-city-choice]', box);
      var other = $('[data-city-other]', box);
      var otherSel = $('select', other);
      function update() {
        var on = choice.value === 'other';
        other.hidden = !on;
        otherSel.required = on;
        if (!on) otherSel.value = '';
      }
      choice.addEventListener('change', function () { update(); if (choice.value === 'other') $('input', other).focus(); });
      otherSel.required = choice.value === 'other';
    });

    initPhotoPickers();
    initCountdowns();
    initScheduleForm();
    initBallot();
    initLive();
    initPlanForm();
    initProfessions();
    initReactions();
    initOrgChart();
    initHelp();
    initPostKinds();
  });

  // ---------- Зураг сонгогч: 400×400 дөрвөлжин болгож JPEG-ээр багасгана ----------
  function initPhotoPickers() {
    $$('[data-photo-picker]').forEach(function (box) {
      var file = $('[data-photo-file]', box);
      var data = $('[data-photo-data]', box);
      var preview = $('[data-photo-preview]', box);
      var clear = $('[data-photo-clear]', box);
      var save = $('[data-photo-save]', box);
      if (!file || !data || !preview) return;

      function show(src) {
        preview.innerHTML = '';
        if (src) { var img = new Image(); img.src = src; img.alt = ''; preview.appendChild(img); }
        else { var s = document.createElement('span'); s.textContent = '📷'; preview.appendChild(s); }
        if (clear) clear.hidden = !src;
        if (save) save.hidden = !src;
      }

      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { window.alert('JPG, PNG эсвэл WEBP зураг сонгоно уу.'); file.value = ''; return; }
        if (f.size > 15 * 1024 * 1024) { window.alert('Зураг 15MB-аас бага байх ёстой.'); file.value = ''; return; }
        var reader = new FileReader();
        reader.onload = function () {
          var img = new Image();
          img.onload = function () {
            var size = 400;
            var side = Math.min(img.naturalWidth, img.naturalHeight);
            var sx = (img.naturalWidth - side) / 2;
            var sy = (img.naturalHeight - side) / 2;
            var canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
            var url = canvas.toDataURL('image/jpeg', 0.85);
            data.value = url;
            show(url);
          };
          img.onerror = function () { window.alert('Зургийг уншиж чадсангүй.'); };
          img.src = reader.result;
        };
        reader.readAsDataURL(f);
      });

      if (clear) clear.addEventListener('click', function () { data.value = ''; file.value = ''; show(null); });
    });
  }

  // ---------- Хугацааны тоолуур: data-countdown="ISO огноо" ----------
  function initCountdowns() {
    var els = $$('[data-countdown]');
    if (!els.length) return;
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function tick() {
      els.forEach(function (el) {
        var left = new Date(el.getAttribute('data-countdown')).getTime() - Date.now();
        if (left <= 0) {
          if (el.hasAttribute('data-countdown-units')) {
            $$('[data-u]', el).forEach(function (u) { u.textContent = u.getAttribute('data-u') === 'd' ? '0' : '00'; });
          } else {
            el.textContent = 'Одоо';
          }
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
        if (el.hasAttribute('data-countdown-units')) {
          // Том тоолуур: өдөр / цаг / минут / секунд тус тусдаа
          var vals = { d: String(d), h: pad(hh), m: pad(mm), s: pad(s) };
          Object.keys(vals).forEach(function (k) {
            var u = el.querySelector('[data-u="' + k + '"]');
            if (u && u.textContent !== vals[k]) u.textContent = vals[k];
          });
          return;
        }
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

  // ---------- Албан тушаал: дарга/удирдлага бол орон тоо 1 ----------
  function initPostKinds() {
    $$('[data-post-kind]').forEach(function (sel) {
      var seats = $('[data-post-seats]', sel.form);
      if (!seats) return;
      var memberVal = seats.value === '1' && sel.value !== 'member' ? '' : seats.value;
      function update() {
        var fixed = sel.value !== 'member';
        if (fixed) { if (!seats.disabled) memberVal = seats.value; seats.value = '1'; }
        else if (seats.disabled) seats.value = memberVal;
        seats.disabled = fixed;
      }
      sel.addEventListener('change', update);
      update();
    });
  }

  // ---------- Заавар: баруун талын нарийн самбар — цэс дарахад доошоо нээгдэнэ (алхам алхмаар, зурагтай) ----------
  function initHelp() {
    var drawer = $('[data-help-drawer]');
    if (!drawer) return;
    var openers = $$('[data-help-open]');
    var accs = $$('details[data-guide]', drawer);
    var active = null; // одоо нээлттэй цэс

    function showStep(acc, i) {
      var steps = $$('[data-step]', acc);
      var n = steps.length;
      i = Math.max(0, Math.min(i, n - 1));
      acc._step = i;
      steps.forEach(function (s, k) {
        s.hidden = k !== i;
        if (k === i || k === i + 1) {
          var img = $('img[data-src]', s); // идэвхтэй болон дараагийн зургийг л ачаална
          if (img) { img.src = img.getAttribute('data-src'); img.removeAttribute('data-src'); }
        }
      });
      var prev = $('[data-step-prev]', acc);
      var next = $('[data-step-next]', acc);
      if (prev) prev.disabled = i === 0;
      if (next) { next.disabled = i === n - 1; next.textContent = i === n - 1 ? 'Дууслаа ✓' : 'Дараах →'; }
      $$('[data-step-go]', acc).forEach(function (d, k) { d.classList.toggle('on', k === i); });
    }
    accs.forEach(function (acc) {
      acc.addEventListener('toggle', function () {
        if (acc.open) {
          accs.forEach(function (o) { if (o !== acc) o.open = false; }); // нэг л цэс нээлттэй
          active = acc;
          showStep(acc, acc._step || 0);
        } else if (active === acc) {
          active = null;
        }
      });
      acc.addEventListener('click', function (e) {
        var t = e.target;
        if (t.closest('[data-step-prev]')) showStep(acc, acc._step - 1);
        else if (t.closest('[data-step-next]')) showStep(acc, acc._step + 1);
        else if (t.closest('[data-step-go]')) showStep(acc, Number(t.closest('[data-step-go]').getAttribute('data-step-go')));
        else if (t.closest('.guide-img.missing')) e.preventDefault();
      });
    });
    function set(open) {
      drawer.classList.toggle('open', open);
      drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
      openers.forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    }
    openers.forEach(function (b) { b.addEventListener('click', function () { set(!drawer.classList.contains('open')); }); });
    $$('[data-help-close]', drawer).forEach(function (b) { b.addEventListener('click', function () { set(false); }); });
    // #help эсвэл #help=<түлхүүр> холбоосоор шууд нээнэ (заавар хуваалцах)
    var hm = /^#help(?:=([\w-]+))?$/.exec(window.location.hash);
    if (hm) {
      set(true);
      var acc = hm[1] && $('details[data-guide="' + hm[1] + '"]', drawer);
      if (acc) { acc.open = true; acc.scrollIntoView({ block: 'nearest' }); }
    }
    document.addEventListener('keydown', function (e) {
      if (!drawer.classList.contains('open')) return;
      var typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
      if (e.key === 'Escape') set(false);
      else if (!typing && active && e.key === 'ArrowRight') showStep(active, active._step + 1);
      else if (!typing && active && e.key === 'ArrowLeft') showStep(active, active._step - 1);
    });
  }

  // ---------- Зөвлөлийн бүтэц: багтахгүй бол босоо харагдац руу шилжинэ ----------
  function initOrgChart() {
    var charts = $$('[data-org]');
    if (!charts.length) return;
    var MIN = 150; // нэгжийн хайрцгийн хамгийн бага өргөн (px)
    function fit() {
      charts.forEach(function (c) {
        c.classList.remove('vertical');
        var tooNarrow = $$('.org-node', c).some(function (n) { return n.getBoundingClientRect().width < MIN; });
        if (tooNarrow || c.scrollWidth > c.clientWidth + 1) c.classList.add('vertical');
      });
    }
    var t;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(fit, 120); });
    // Цонх (dialog) дотор биш тул шууд хэмжиж болно
    fit();
  }

  // ---------- Reaction: хуудас дахин ачаалахгүйгээр илгээнэ ----------
  function initReactions() {
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form.matches || !form.matches('[data-react-form]')) return;
      var btn = e.submitter;
      if (!window.fetch || !btn) return;
      e.preventDefault();
      var box = form.closest('[data-react]');
      var data = new URLSearchParams(new FormData(form));
      data.set('emoji', btn.value);
      box.classList.add('busy');
      fetch(form.action, {
        method: 'POST', body: data, credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.html) throw new Error(j.error || 'error');
        var tmp = document.createElement('div');
        tmp.innerHTML = j.html.trim();
        box.replaceWith(tmp.firstElementChild);
      }).catch(function () { form.submit(); });
    });
    // Гадна дарахад нээлттэй picker-ийг хаана
    document.addEventListener('click', function (e) {
      var more = e.target.closest && e.target.closest('.react-more');
      $$('.react-form.open').forEach(function (f) { if (!more || f !== more.closest('.react-form')) f.classList.remove('open'); });
      if (more) more.closest('.react-form').classList.toggle('open');
    });
  }

  // ---------- Мэргэжил: олон мөр нэмэх / хасах ----------
  function initProfessions() {
    $$('[data-professions]').forEach(function (box) {
      var rows = $('[data-prof-rows]', box);
      var tpl = $('[data-prof-template]', box);
      var add = $('[data-prof-add]', box);
      var max = Number(box.getAttribute('data-max')) || 5;
      function update() {
        var n = $$('[data-prof-row]', rows).length;
        add.hidden = n >= max;
        $$('[data-prof-remove]', rows).forEach(function (b) { b.hidden = n <= 1; });
      }
      add.addEventListener('click', function () {
        rows.appendChild(tpl.content.cloneNode(true));
        var all = $$('[data-prof-row]', rows);
        $('select', all[all.length - 1]).focus();
        update();
      });
      rows.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-prof-remove]');
        if (!btn) return;
        btn.closest('[data-prof-row]').remove();
        update();
      });
      update();
    });
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
          if (d.invalid) html += '<div class="flash error small">Ирц ' + d.turnout + '% нь шаардлагатай доод ирц ' + d.minTurnout + '%-д хүрээгүй тул сонгууль хүчингүй. Хэн ч сонгогдоогүй.</div>';
          if (d.tie) html += '<div class="flash warn small">Сүүлийн суудалд санал тэнцсэн — тухайн саналын тоонд түрүүлж хүрсэн нь сонгогдлоо.</div>';
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

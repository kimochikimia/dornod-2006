// Тасалбар: суудлын план зурагч (удирдлага), суудал сонгогч (захиалагч), тоо сонгогч, хуулах товч.
// Геометрийг public/js/seatmap.js (window.SeatMap) тооцно — сервер ч мөн адил тооцоолдог.
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var ROW_LETTERS = 'АБВГДЕЖЗИКЛМНОӨПРСТУҮФХЦЧШЭЮЯ';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function group(d) { return String(d).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function money(n) { return group(Math.round(Number(n) || 0)) + '₮'; }
  // Мөнгөн дүнгийн талбар: бичих явцад орончилно (1500000 → 1,500,000), курсорын байрлалыг хадгална
  function moneyInput(input) {
    function format(keepCaret) {
      var v = input.value;
      var pos = input.selectionStart == null ? v.length : input.selectionStart;
      var before = v.slice(0, pos).replace(/\D/g, '').length;
      var out = group(v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 10));
      if (out === v) return;
      input.value = out;
      if (!keepCaret) return;
      var i = 0, n = 0;
      while (i < out.length && n < before) { if (/\d/.test(out[i])) n++; i++; }
      input.setSelectionRange(i, i);
    }
    format(false);
    input.addEventListener('input', function () { format(document.activeElement === input); });
  }
  function digits(v) { var d = String(v || '').replace(/\D/g, ''); return d ? Number(d) : null; }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function readJson(root, sel) {
    var s = $(sel, root);
    try { return JSON.parse(s ? s.textContent : '{}'); } catch (e) { return {}; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- SVG зурах ----------
  // opts: { price, seatClass(seat) -> 'free'|'paid'|..., editing }
  function draw(svg, layout, opts) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + layout.w + ' ' + layout.h);
    el('rect', { x: 0, y: 0, width: layout.w, height: layout.h, rx: 14, class: 'seat-bg' }, svg);
    if (opts.bg) {
      // Заалны план зураг — суудлуудыг дээр нь байрлуулна (харьцааг нь хадгалж төвд нь)
      var img = el('image', { x: 0, y: 0, width: layout.w, height: layout.h, preserveAspectRatio: 'xMidYMid meet', opacity: (layout.bgOp || 70) / 100, class: 'seat-bg-img' }, svg);
      img.setAttribute('href', opts.bg);
    }
    if (opts.grid) {
      // Бүдэг тор: 25 нэгж тутам нарийн, 100 тутам арай тод шугам
      var defs = el('defs', {}, svg);
      var minor = el('pattern', { id: 'seat-grid-minor', width: 25, height: 25, patternUnits: 'userSpaceOnUse' }, defs);
      el('path', { d: 'M 25 0 L 0 0 0 25', class: 'grid-minor' }, minor);
      var major = el('pattern', { id: 'seat-grid-major', width: 100, height: 100, patternUnits: 'userSpaceOnUse' }, defs);
      el('rect', { width: 100, height: 100, fill: 'url(#seat-grid-minor)' }, major);
      el('path', { d: 'M 100 0 L 0 0 0 100', class: 'grid-major' }, major);
      el('rect', { x: 0, y: 0, width: layout.w, height: layout.h, fill: 'url(#seat-grid-major)', 'pointer-events': 'none' }, svg);
    }
    var R = SeatMap.SEAT_R;
    layout.items.forEach(function (it) {
      var g = el('g', { class: 'seat-item t-' + it.t, 'data-id': it.id }, svg);
      if (it.t === 'zone') {
        if (it.shape === 'ellipse') el('ellipse', { cx: it.x + it.w / 2, cy: it.y + it.h / 2, rx: it.w / 2, ry: it.h / 2, class: 'zone' }, g);
        else el('rect', { x: it.x, y: it.y, width: it.w, height: it.h, rx: 8, class: it.shape === 'text' ? 'zone zone-text' : 'zone' }, g);
        var tz = el('text', { x: it.x + it.w / 2, y: it.y + it.h / 2, class: 'zone-label' }, g);
        tz.style.fontSize = Math.max(10, Math.min(it.shape === 'text' ? 28 : 18, Math.round(it.h * 0.45))) + 'px';
        tz.textContent = it.text || '';
        return;
      }
      var seats = SeatMap.seatsOfItem(it, opts.price);
      if (it.t === 'block') { drawBlock(g, it, seats, opts); return; }
      if (it.t === 'table') {
        el('circle', { cx: it.x, cy: it.y, r: SeatMap.tableRadius(it.n), class: 'table' }, g);
        var tt = el('text', { x: it.x, y: it.price != null && opts.editing ? it.y - 6 : it.y, class: 'table-label' }, g);
        tt.textContent = it.name;
        // Зурагч дээр тусгай үнэтэй ширээний үнийг төвд нь харуулна
        if (it.price != null && opts.editing) {
          var tp = el('text', { x: it.x, y: it.y + 9, class: 'table-price' }, g);
          tp.textContent = money(it.price);
        }
      } else {
        var rad = ((it.rot || 0) * Math.PI) / 180;
        var lp = SeatMap.pos(it, 'lp');
        var off = R + 14, last = seats[seats.length - 1] || { x: it.x, y: it.y };
        var ends = [];
        if (lp === 'start' || lp === 'both') ends.push({ x: it.x - Math.cos(rad) * off, y: it.y - Math.sin(rad) * off });
        if (lp === 'end' || lp === 'both') ends.push({ x: last.x + Math.cos(rad) * off, y: last.y + Math.sin(rad) * off });
        if (lp === 'top' || lp === 'bottom') {
          // Эгнээний голд, эгнээнд перпендикуляр чиглэлд (эргэлтийг дагана)
          var sgn = lp === 'top' ? -1 : 1, mx = (it.x + last.x) / 2, my = (it.y + last.y) / 2, d = R + 11;
          ends.push({ x: mx - Math.sin(rad) * d * sgn, y: my + Math.cos(rad) * d * sgn });
        }
        ends.forEach(function (q) { el('text', { x: q.x, y: q.y, class: 'row-label' }, g).textContent = it.name; });
        if (it.price != null && opts.editing) {
          var q0 = ends[0] || { x: it.x - Math.cos(rad) * off, y: it.y - Math.sin(rad) * off };
          var rp = el('text', { x: q0.x, y: q0.y + 15, class: 'table-price' }, g);
          rp.textContent = money(it.price);
        }
      }
      seats.forEach(function (s, i) {
        var cls = opts.seatClass ? opts.seatClass(s) : 'free';
        var sg = el('g', { class: 'seat ' + cls, 'data-key': s.key }, g);
        el('circle', { cx: s.x, cy: s.y, r: R }, sg);
        var t = el('text', { x: s.x, y: s.y }, sg);
        t.textContent = it.t === 'row' ? (it.start || 1) + i : i + 1;
        var title = el('title', {}, sg);
        title.textContent = s.group + ' · ' + s.label + ' · ' + money(s.price);
      });
    });
  }

  // Сектор: дөрвөлжин суудлууд, зүүн талд эгнээний дугаар, дээд талд суудлын дугаар, дээр нь секторын нэр
  function drawBlock(g, it, seats, opts) {
    var size = SeatMap.blockSeatSize(it), half = size / 2;
    var fs = Math.max(7, Math.min(12, Math.round(it.gap * 0.45)));
    var rot = it.rot || 0;
    var lbl = function (r, c, text, cls) {
      var p = SeatMap.blockPoint(it, r, c);
      var t = el('text', { x: p.x, y: p.y, class: cls }, g);
      t.style.fontSize = fs + 'px';
      t.textContent = text;
    };
    var L = SeatMap.blockLabels(it);
    var priceText = opts.editing && it.price != null ? money(it.price) : '';
    if (L.name) {
      var name = SeatMap.blockPoint(it, L.name.r, L.name.c);
      var tn = el('text', { x: name.x, y: name.y, class: 'block-label', transform: rot ? 'rotate(' + rot + ' ' + name.x + ' ' + name.y + ')' : null }, g);
      tn.style.fontSize = Math.max(11, Math.min(18, Math.round(it.gap * 0.7))) + 'px';
      tn.textContent = it.name + (priceText && (L.name.r < 0 || L.name.r > it.rows - 1) ? ' · ' + priceText : '');
    }
    L.seatNumR.forEach(function (rr) { for (var c = 0; c < it.cols; c++) lbl(rr, c, SeatMap.blockSeatNo(it, c), 'block-num'); });
    L.rowNumC.forEach(function (cc) { for (var r = 0; r < it.rows; r++) lbl(r, cc, SeatMap.blockRowNo(it, r), 'block-num'); });
    var showNo = it.gap >= 26;
    seats.forEach(function (s) {
      var cls = opts.seatClass ? opts.seatClass(s) : 'free';
      var sg = el('g', { class: 'seat sq ' + cls, 'data-key': s.key }, g);
      el('rect', { x: s.x - half, y: s.y - half, width: size, height: size, rx: Math.max(2, size * 0.18),
        transform: rot ? 'rotate(' + rot + ' ' + s.x + ' ' + s.y + ')' : null }, sg);
      if (showNo) { var t = el('text', { x: s.x, y: s.y }, sg); t.style.fontSize = fs + 'px'; t.textContent = s.seat; }
      var title = el('title', {}, sg);
      title.textContent = s.label + ' · ' + money(s.price);
    });
  }

  function makeSvg(wrap, layout) {
    var svg = el('svg', { class: 'seat-svg', role: 'img', 'aria-label': 'Суудлын план' });
    svg.style.minWidth = Math.min(layout.w, 720) + 'px';
    wrap.appendChild(svg);
    return svg;
  }

  // ---------- Суудал сонгогч ----------
  function initSeatMaps() {
    $$('[data-seat-map]').forEach(function (wrap) {
      var data = readJson(wrap, '[data-map-json]');
      var layout = data.layout || { w: 1000, h: 700, items: [] };
      var states = data.states || {};
      var all = SeatMap.seats(layout, data.price || 0);
      var byKey = {};
      all.forEach(function (s) { byKey[s.key] = s; });
      var pick = wrap.getAttribute('data-mode') === 'pick';
      var form = pick ? document.getElementById(wrap.getAttribute('data-form')) : null;
      var selected = [];
      var svg = makeSvg(wrap, layout);
      addZoom(wrap, svg, layout, all.length);
      if (!all.length) {
        wrap.insertAdjacentHTML('beforeend', '<p class="small faint" style="margin:.5rem 0 0">Суудлын план хараахан бэлэн болоогүй байна.</p>');
      }

      function render() {
        draw(svg, layout, {
          price: data.price || 0,
          bg: data.bg || null,
          seatClass: function (s) {
            if (states[s.key]) return states[s.key];
            return selected.indexOf(s.key) >= 0 ? 'sel' : pick ? 'free can' : 'free';
          },
        });
      }

      function sync() {
        if (!form) return;
        var input = $('[data-pick-input]', form);
        var list = $('[data-pick-list]', form);
        var total = $('[data-pick-total]', form);
        var btn = $('[data-pick-submit]', form);
        input.value = selected.join(',');
        var sum = 0;
        list.innerHTML = selected.length ? selected.map(function (k) {
          var s = byKey[k];
          sum += s.price;
          if (s.sec != null) {
            return '<div class="tk-pick-card"><div class="tk-pick-sec"><strong>' + esc(s.sec) + '</strong><span>сектор</span></div>' +
              '<div class="tk-pick-info"><strong>' + esc(s.seat) + ' суудал</strong><span>' + esc(s.row) + ' эгнээ</span></div>' +
              '<div class="tk-pick-price">' + money(s.price) + '</div>' +
              '<button type="button" class="btn btn-sm" data-unpick="' + esc(k) + '">Устгах</button></div>';
          }
          return '<button type="button" class="tk-chip" data-unpick="' + esc(k) + '" title="Хасах">' + esc(s.group) + ' · <strong>' + esc(s.label) + '</strong> <span class="faint">' + money(s.price) + '</span> ×</button>';
        }).join('') : '<span class="small faint">Суудал сонгоогүй байна.</span>';
        total.textContent = money(sum);
        btn.disabled = !selected.length;
      }

      if (pick) {
        var max = data.max || 10;
        svg.addEventListener('click', function (ev) {
          var g = ev.target.closest && ev.target.closest('.seat');
          if (!g) return;
          var key = g.getAttribute('data-key');
          if (states[key]) return;
          var i = selected.indexOf(key);
          if (i >= 0) selected.splice(i, 1);
          else if (selected.length >= max) { window.alert('Нэг удаад ' + max + '-аас ихгүй суудал сонгоно.'); return; }
          else selected.push(key);
          render();
          sync();
        });
        if (form) {
          $('[data-pick-list]', form).addEventListener('click', function (ev) {
            var b = ev.target.closest('[data-unpick]');
            if (!b) return;
            selected.splice(selected.indexOf(b.getAttribute('data-unpick')), 1);
            render();
            sync();
          });
        }
      }
      render();
      sync();
    });
  }

  // Томруулах: −, +, бүтэн харах товч; Ctrl + хулганы дугуй (зөөврийн компьютерын touchpad-ын чимхэлт);
  // утсан дээр хоёр хуруугаар чимхэх; захиалагчийн план дээр хулганаар чирж гүйлгэх.
  // SVG-ийн өргөнийг өөрчилж, wrap доторх гүйлгэлтээр шилжинэ. mount өгвөл (план зурагч) товчийг тэнд байрлуулна.
  function addZoom(wrap, svg, layout, seatCount, mount) {
    // Товч зөвхөн план зурагч дээр; захиалагч чимхэж/дугуйгаар томруулна
    var bar = document.createElement('div');
    bar.className = 'seat-zoom inline';
    bar.innerHTML = '<button type="button" class="btn btn-sm" data-z="-1" aria-label="Жижигрүүлэх">−</button>' +
      '<button type="button" class="btn btn-sm" data-z="1" aria-label="Томруулах">+</button>' +
      '<button type="button" class="btn btn-sm" data-z="0">Бүтэн харах</button>';
    if (mount) mount.appendChild(bar);
    var MAX = 6;
    var scale = 1;
    // (ax, ay) — wrap доторх цэг (px), томруулахад тэр цэг байрандаа үлдэнэ. Өгөхгүй бол төв.
    function setScale(next, ax, ay) {
      next = Math.max(1, Math.min(MAX, next));
      if (Math.abs(next - scale) < 0.001) return;
      if (ax == null) { ax = wrap.clientWidth / 2; ay = wrap.clientHeight / 2; }
      var fx = (wrap.scrollLeft + ax) / (wrap.scrollWidth || 1);
      var fy = (wrap.scrollTop + ay) / (wrap.scrollHeight || 1);
      scale = next;
      svg.style.width = scale * 100 + '%';
      wrap.classList.toggle('zoomed', scale > 1);
      wrap.scrollLeft = fx * wrap.scrollWidth - ax;
      wrap.scrollTop = fy * wrap.scrollHeight - ay;
    }
    function local(cx, cy) { var r = wrap.getBoundingClientRect(); return [cx - r.left, cy - r.top]; }
    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-z]');
      if (!b) return;
      var d = Number(b.getAttribute('data-z'));
      setScale(d === 0 ? 1 : d > 0 ? scale * 1.5 : scale / 1.5);
    });
    wrap.addEventListener('wheel', function (ev) {
      if (!ev.ctrlKey) return; // энгийн дугуй — хуудсыг гүйлгэнэ
      ev.preventDefault();
      var p = local(ev.clientX, ev.clientY);
      setScale(scale * Math.exp(-ev.deltaY * 0.01), p[0], p[1]);
    }, { passive: false });

    // Хоёр хуруугаар чимхэх
    var pinch = null;
    function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    wrap.addEventListener('touchstart', function (ev) {
      if (ev.touches.length === 2) pinch = { d: dist(ev.touches), s: scale };
    }, { passive: true });
    wrap.addEventListener('touchmove', function (ev) {
      if (!pinch || ev.touches.length !== 2) return;
      ev.preventDefault();
      var p = local((ev.touches[0].clientX + ev.touches[1].clientX) / 2, (ev.touches[0].clientY + ev.touches[1].clientY) / 2);
      setScale(pinch.s * dist(ev.touches) / pinch.d, p[0], p[1]);
    }, { passive: false });
    wrap.addEventListener('touchend', function (ev) { if (ev.touches.length < 2) pinch = null; });

    // Хулганаар чирж гүйлгэх (план зурагч дээр элемент чирдэг тул зөвхөн захиалагчийн план дээр)
    if (!mount) {
      var pan = null, moved = false;
      wrap.addEventListener('pointerdown', function (ev) {
        if (ev.pointerType !== 'mouse' || ev.button !== 0 || scale === 1) return;
        pan = { x: ev.clientX, y: ev.clientY, l: wrap.scrollLeft, t: wrap.scrollTop };
        moved = false;
      });
      window.addEventListener('pointermove', function (ev) {
        if (!pan) return;
        var dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        moved = true;
        wrap.classList.add('panning');
        wrap.scrollLeft = pan.l - dx;
        wrap.scrollTop = pan.t - dy;
      });
      window.addEventListener('pointerup', function () { pan = null; wrap.classList.remove('panning'); });
      // Чирсний дараах "click"-ээр суудал сонгогдохгүй
      wrap.addEventListener('click', function (ev) { if (moved) { ev.stopPropagation(); moved = false; } }, true);
    }
    // Бүтэн харагдацаас эхэлнэ (жижиг дэлгэцэнд ч бүх план багтана)
    svg.style.minWidth = '0';
  }

  // ---------- Тоо сонгогч (суудалгүй) ----------
  function initQty() {
    $$('[data-qty]').forEach(function (box) {
      var input = $('input', box);
      var form = box.closest('form');
      var price = Number(form.getAttribute('data-price')) || 0;
      var total = $('[data-pick-total]', form);
      function update() { total.textContent = money(price * (Number(input.value) || 0)); }
      $$('[data-qty-step]', box).forEach(function (b) {
        b.addEventListener('click', function () {
          var v = (Number(input.value) || 0) + Number(b.getAttribute('data-qty-step'));
          var max = Number(input.max) || 999;
          input.value = Math.max(1, Math.min(max, v));
          update();
        });
      });
      input.addEventListener('input', update);
      update();
    });
  }

  // ---------- Хуулах ----------
  function initCopy() {
    $$('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var text = b.getAttribute('data-copy');
        var done = function () { var t = b.textContent; b.textContent = '✓ Хуулсан'; setTimeout(function () { b.textContent = t; }, 1500); };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Хуулна уу:', text); });
        else window.prompt('Хуулна уу:', text);
      });
    });
  }

  // ---------- Суудлын план зурагч ----------
  function initEditor() {
    var root = $('[data-seat-editor]');
    if (!root) return;
    var data = readJson(root, '[data-editor-json]');
    var norm = SeatMap.normalize(data.layout || {});
    var layout = norm.layout || { w: 1000, h: 700, items: [] };
    var locked = {};
    (data.locked || []).forEach(function (k) { locked[k] = true; });
    var input = $('[data-layout-input]', root);
    var wrap = $('[data-editor-canvas]', root);
    var props = $('[data-props]', root);
    var stats = $('[data-editor-stats]', root);
    var priceInput = $('[data-base-price]');
    var svg = makeSvg(wrap, layout);
    addZoom(wrap, svg, layout, Infinity, $('.seat-toolbar', root));
    var selId = null;
    var bgUrl = data.bg || null;
    initPlanBg();

    // Арын план зураг: сонгомогц JPEG болгож шахаад нуугдмал талбарт хийнэ. Талбайн өндрийг зургийн харьцаагаар тааруулна.
    function initPlanBg() {
      var box = $('[data-plan-bg]', root);
      if (!box) return;
      var file = $('[data-plan-file]', box), hidden = $('[data-plan-data]', box), remove = $('[data-plan-remove-input]', box);
      var rmBtn = $('[data-plan-remove]', box), status = $('[data-plan-status]', box), op = $('[data-plan-op]', box);
      if (bgUrl && bgUrl.indexOf('data:') === 0) hidden.value = bgUrl; // алдаатай буцсан үед
      function paint() { rmBtn.hidden = !bgUrl; op.parentNode.hidden = !bgUrl; }
      op.value = layout.bgOp || 70;
      op.addEventListener('input', function () { layout.bgOp = Number(op.value); render(); });
      file.addEventListener('change', function () {
        var f = file.files[0];
        if (!f) return;
        if (!/^image\//.test(f.type)) { status.textContent = '✕ Зураг биш файл'; return; }
        status.textContent = 'Боловсруулж байна…';
        createImageBitmap(f, { imageOrientation: 'from-image' }).then(function (bmp) {
          var url, q = 0.85, max = 2400;
          for (var i = 0; i < 4; i++) {
            var sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
            var c = document.createElement('canvas');
            c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // ил тод PNG-г цагаан дэвсгэртэй
            ctx.drawImage(bmp, 0, 0, c.width, c.height);
            url = c.toDataURL('image/jpeg', q);
            if (url.length < 5.2e6) break;
            max = Math.round(max * 0.8); q -= 0.08;
          }
          // Талбайн өндрийг зургийн харьцаанд тааруулна (өргөн хэвээр)
          var nh = Math.round(layout.w * bmp.height / bmp.width);
          var lim = SeatMap.LIMITS.h;
          layout.h = Math.max(lim[0], Math.min(lim[1], nh));
          layout.items.forEach(clampXY);
          if (bmp.close) bmp.close();
          bgUrl = url; hidden.value = url; remove.value = '';
          status.textContent = '✓ Сонгогдлоо (хадгалахад хуулагдана)';
          syncCanvasInputs(); paint(); render();
        }).catch(function () { status.textContent = '✕ Зургийг уншиж чадсангүй'; });
      });
      rmBtn.addEventListener('click', function () {
        bgUrl = null; hidden.value = ''; remove.value = '1'; file.value = '';
        status.textContent = 'Хадгалахад зураг устгагдана.';
        paint(); render();
      });
      paint();
    }

    function basePrice() { return Number(String(priceInput ? priceInput.value : '').replace(/\D/g, '')) || 0; }
    function find(id) { for (var i = 0; i < layout.items.length; i++) if (layout.items[i].id === id) return layout.items[i]; return null; }
    function newId() { var id; do { id = Math.random().toString(36).slice(2, 9).replace(/[^a-z0-9]/g, 'x'); } while (find(id)); return id; }
    function hasLocked(it) { return SeatMap.seatsOfItem(it, 0).some(function (s) { return locked[s.key]; }); }
    function seatCount(it) { return it.t === 'table' || it.t === 'row' ? it.n : it.t === 'block' ? it.rows * it.cols : 0; }
    function snap(v) { return Math.round(v / 5) * 5; }
    function clampXY(it) {
      var mw = it.t === 'zone' ? layout.w - it.w : layout.w;
      var mh = it.t === 'zone' ? layout.h - it.h : layout.h;
      it.x = Math.max(0, Math.min(mw, Math.round(it.x)));
      it.y = Math.max(0, Math.min(mh, Math.round(it.y)));
    }

    function save() {
      input.value = JSON.stringify(layout);
      var t = 0, r = 0, b = 0, n = 0;
      layout.items.forEach(function (it) {
        if (it.t === 'table') t++; else if (it.t === 'row') r++; else if (it.t === 'block') b++;
        n += seatCount(it);
      });
      stats.textContent = [b ? b + ' сектор' : '', t ? t + ' ширээ' : '', r ? r + ' эгнээ' : '', 'нийт ' + n + ' суудал'].filter(Boolean).join(' · ');
    }

    function render() {
      draw(svg, layout, {
        price: basePrice(),
        bg: bgUrl,
        editing: true,
        grid: true,
        seatClass: function (s) { return locked[s.key] ? 'paid' : 'free'; },
      });
      if (selId) {
        var g = $('[data-id="' + selId + '"]', svg);
        if (g) g.classList.add('selected');
      }
      save();
    }

    function nextName(type) {
      var used = {};
      layout.items.forEach(function (it) { if (it.t === type) used[it.name] = true; });
      if (type === 'table' || type === 'block') { var i = 1; while (used[String(i)]) i++; return String(i); }
      for (var j = 0; j < ROW_LETTERS.length; j++) if (!used[ROW_LETTERS[j]]) return ROW_LETTERS[j];
      var k = 1; while (used['Р' + k]) k++; return 'Р' + k;
    }

    // Харагдаж буй хэсгийн төвд, давхцахгүйгээр байрлуулна
    function spot() {
      var n = layout.items.length;
      return { x: snap(layout.w / 2 + ((n % 5) - 2) * 40), y: snap(layout.h / 2 + ((Math.floor(n / 5) % 5) - 2) * 40) };
    }

    function add(type) {
      var p = spot();
      var it;
      if (type === 'table') it = { id: newId(), t: 'table', x: p.x, y: p.y, n: 8, name: nextName('table'), price: null };
      else if (type === 'row') it = { id: newId(), t: 'row', x: snap(p.x - 150), y: p.y, n: 10, name: nextName('row'), gap: 34, rot: 0, start: 1, price: null };
      else if (type === 'block') it = { id: newId(), t: 'block', x: snap(p.x - 100), y: snap(p.y - 80), rows: 8, cols: 10, name: nextName('block'), gap: 22, rot: 0, rowStart: 1, seatStart: 1, rowDir: 'down', seatDir: 'ltr', price: null };
      else if (type === 'label') it = { id: newId(), t: 'zone', x: snap(p.x - 50), y: snap(p.y - 20), w: 100, h: 40, text: 'Gate 1', shape: 'text' };
      else it = { id: newId(), t: 'zone', x: snap(layout.w / 2 - 150), y: 20, w: 300, h: 60, text: 'ТАЙЗ', shape: 'rect' };
      clampXY(it);
      layout.items.push(it);
      select(it.id);
    }

    // Олон ширээг сүлжээгээр нэмэх
    function addGrid(count, seatsPer, cols, price) {
      var r = SeatMap.tableRadius(seatsPer) + SeatMap.SEAT_R * 2 + 14;
      var step = r * 2;
      var rows = Math.ceil(count / cols);
      var x0 = Math.max(r, snap(layout.w / 2 - ((cols - 1) * step) / 2));
      // Одоо байгаа элементүүдийн доор байрлуулна (давхцуулахгүй)
      var bottom = 0;
      layout.items.forEach(function (o) { bottom = Math.max(bottom, bbox(o).y2); });
      var y0 = layout.items.length ? snap(bottom + 20 + r) : Math.max(r + 80, snap(layout.h / 2 - ((rows - 1) * step) / 2));
      var needW = x0 + (cols - 1) * step + r, needH = y0 + (rows - 1) * step + r;
      if (needW > layout.w) layout.w = Math.min(SeatMap.LIMITS.w[1], Math.ceil(needW / 50) * 50);
      if (needH > layout.h) layout.h = Math.min(SeatMap.LIMITS.h[1], Math.ceil(needH / 50) * 50);
      for (var i = 0; i < count; i++) {
        layout.items.push({ id: newId(), t: 'table', x: Math.round(x0 + (i % cols) * step), y: Math.round(y0 + Math.floor(i / cols) * step), n: seatsPer, name: nextName('table'), price: price });
      }
      syncCanvasInputs();
      select(null);
    }

    function remove(id) {
      var it = find(id);
      if (!it) return;
      if (hasLocked(it)) { window.alert('Энэ элементэд захиалагдсан суудал байгаа тул устгах боломжгүй.'); return; }
      layout.items = layout.items.filter(function (x) { return x.id !== id; });
      select(null);
    }

    function duplicate(id) {
      var it = find(id);
      if (!it) return;
      var c = JSON.parse(JSON.stringify(it));
      c.id = newId();
      if (c.t !== 'zone') c.name = nextName(c.t);
      if (c.t === 'table') c.x += SeatMap.tableRadius(c.n) * 2 + 50;
      else if (c.t === 'block') { var bb = bbox(it); c.x += Math.round(bb.x2 - bb.x1 + 20); }
      else if (c.t !== 'block') c.y += c.t === 'row' ? 40 : c.h + 20;
      clampXY(c);
      layout.items.push(c);
      select(c.id);
    }

    function select2(label, key, opts) {
      return '<div class="field"><label>' + label + '</label><select data-prop="' + key + '">' +
        opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></div>';
    }
    function field(label, key, type, attrs) {
      return '<div class="field"><label>' + label + '</label><input type="' + type + '" data-prop="' + key + '" ' + (attrs || '') + '></div>';
    }

    function select(id) {
      selId = id;
      var it = id ? find(id) : null;
      render();
      if (!it) {
        props.innerHTML =
          '<h4>Олон ширээ нэмэх</h4>' +
          '<div class="form-grid tight">' +
          field('Ширээний тоо', 'g-count', 'number', 'min="1" max="100" value="10"') +
          field('Суудал / ширээ', 'g-seats', 'number', 'min="1" max="24" value="10"') +
          field('Нэг эгнээнд', 'g-cols', 'number', 'min="1" max="20" value="5"') +
          '</div>' + field('Суудлын үнэ (₮)', 'g-price', 'text', 'inputmode="numeric" placeholder="Үндсэн үнэ"') +
          '<button type="button" class="btn btn-sm btn-primary" data-grid>Нэмэх</button>';
        $('[data-grid]', props).addEventListener('click', function () {
          var v = function (k) { return Number($('[data-prop="' + k + '"]', props).value) || 0; };
          var pd = digits($('[data-prop="g-price"]', props).value);
          addGrid(Math.max(1, Math.min(100, v('g-count'))), Math.max(1, Math.min(24, v('g-seats'))), Math.max(1, Math.min(20, v('g-cols'))),
            pd == null ? null : Math.min(1000000000, pd));
        });
        moneyInput($('[data-prop="g-price"]', props));
        return;
      }
      var lockedNote = hasLocked(it) ? '<p class="small" style="color:var(--warn);margin:0">Захиалагдсан суудалтай — устгах, суудал хасах боломжгүй.</p>' : '';
      var html = '<h4>' + ({ table: '◯ Ширээ', row: '▭▭ Эгнээ', block: '▦ Сектор', zone: '▢ Талбай' })[it.t] + '</h4>' + lockedNote;
      if (it.t === 'block') {
        html += '<div class="form-grid tight">' + field('Секторын нэр', 'name', 'text', 'maxlength="10"') +
          field('Үнэ (₮)', 'price', 'text', 'inputmode="numeric" placeholder="Үндсэн үнэ"') + '</div>' +
          '<div class="form-grid tight">' + field('Эгнээний тоо', 'rows', 'number', 'min="1" max="60"') +
          field('Эгнээнд суудал', 'cols', 'number', 'min="1" max="80"') + '</div>' +
          '<div class="form-grid tight">' + field('Эхний эгнээ №', 'rowStart', 'number', 'min="1" max="999"') +
          field('Эхний суудал №', 'seatStart', 'number', 'min="1" max="999"') + '</div>' +
          '<div class="form-grid tight">' + select2('1-р эгнээ', 'rowDir', [['down', 'Дээд талд'], ['up', 'Доод талд']]) +
          select2('Суудлын дугаар', 'seatDir', [['ltr', 'Зүүнээс →'], ['rtl', '← Баруунаас']]) + '</div>' +
          '<div class="form-grid tight">' + field('Суудлын зай', 'gap', 'number', 'min="14" max="60"') +
          field('Эргэлт (°)', 'rot', 'number', 'min="-180" max="180" step="5"') + '</div>' +
          '<h5 class="seat-props-sub">Шошгоны байрлал</h5>' +
          select2('Секторын нэр', 'np', [['top', 'Дээр'], ['bottom', 'Доор'], ['left', 'Зүүн талд'], ['right', 'Баруун талд'], ['none', 'Харуулахгүй']]) +
          '<div class="form-grid tight">' + select2('Эгнээний дугаар', 'rp', [['left', 'Зүүн талд'], ['right', 'Баруун талд'], ['both', 'Хоёр талд'], ['none', 'Харуулахгүй']]) +
          select2('Суудлын дугаар', 'sp', [['top', 'Дээр'], ['bottom', 'Доор'], ['both', 'Дээр, доор'], ['none', 'Харуулахгүй']]) + '</div>';
      } else if (it.t === 'zone') {
        html += field('Бичвэр', 'text', 'text', 'maxlength="40"') +
          select2('Хэлбэр', 'shape', [['rect', '▢ Тэгш өнцөгт'], ['ellipse', '◯ Зууван'], ['text', 'Т Зөвхөн бичвэр']]) +
          '<div class="form-grid tight">' + field('Өргөн', 'w', 'number', 'min="20" max="4000" step="10"') + field('Өндөр', 'h', 'number', 'min="20" max="4000" step="10"') + '</div>';
      } else {
        html += '<div class="form-grid tight">' + field(it.t === 'table' ? 'Ширээний дугаар' : 'Эгнээний нэр', 'name', 'text', 'maxlength="10"') +
          field('Суудлын тоо', 'n', 'number', 'min="1" max="' + (it.t === 'table' ? 24 : 60) + '"') + '</div>';
        if (it.t === 'row') {
          html += '<div class="form-grid tight">' + field('Эхний дугаар', 'start', 'number', 'min="1" max="999"') +
            field('Зай', 'gap', 'number', 'min="28" max="80"') + field('Эргэлт (°)', 'rot', 'number', 'min="-180" max="180" step="5"') + '</div>' +
            select2('Эгнээний нэрийн байрлал', 'lp', [['start', 'Эхэнд (1-р суудлын өмнө)'], ['end', 'Төгсгөлд'], ['both', 'Хоёр талд'], ['top', 'Дээр (голд)'], ['bottom', 'Доор (голд)'], ['none', 'Харуулахгүй']]);
        }
        html += field('Үнэ (₮)', 'price', 'text', 'inputmode="numeric" placeholder="Үндсэн үнэ"');
      }
      html += '<div class="row" style="gap:.4rem;margin-top:.5rem"><button type="button" class="btn btn-sm" data-dup>⧉ Хувилах</button>' +
        '<button type="button" class="btn btn-sm btn-danger" data-del>Устгах</button></div>';
      props.innerHTML = html;
      $$('[data-prop]', props).forEach(function (inp) {
        var k = inp.getAttribute('data-prop');
        inp.value = it[k] == null ? (inp.tagName === 'SELECT' ? inp.options[0].value : '') : it[k];
        if (k === 'price') moneyInput(inp);
        inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', function () {
          var v = inp.value;
          if (inp.tagName === 'SELECT') it[k] = v;
          else if (k === 'name' || k === 'text') it[k] = v.slice(0, k === 'text' ? 40 : 10);
          else if (k === 'price') { var d = digits(v); it.price = d == null ? null : Math.min(1000000000, d); }
          else {
            var num = Number(v);
            if (!isFinite(num) || v === '') return;
            var min = Number(inp.min), max = Number(inp.max);
            if (num < min || num > max) return;
            if ((k === 'n' || k === 'rows' || k === 'cols') && num < it[k]) {
              var test = JSON.parse(JSON.stringify(it)); test[k] = num;
              var keep = {}; SeatMap.seatsOfItem(test, 0).forEach(function (s) { keep[s.key] = true; });
              var lost = SeatMap.seatsOfItem(it, 0).some(function (s) { return locked[s.key] && !keep[s.key]; });
              if (lost) { inp.value = it[k]; window.alert('Захиалагдсан суудлыг хасах боломжгүй.'); return; }
            }
            it[k] = Math.round(num);
          }
          if (it.t === 'zone') clampXY(it);
          render();
        });
      });
      $('[data-dup]', props).addEventListener('click', function () { duplicate(it.id); });
      $('[data-del]', props).addEventListener('click', function () { remove(it.id); });
    }

    // Чирэх
    function point(ev) {
      var pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }
    // Элементийн хүрээ (суудлыг оруулаад): { x1, x2, y1, y2 }
    function bbox(it) {
      if (it.t === 'zone') return { x1: it.x, x2: it.x + it.w, y1: it.y, y2: it.y + it.h };
      if (it.t === 'table') {
        var r = SeatMap.tableRadius(it.n) + SeatMap.SEAT_R * 2 + 6;
        return { x1: it.x - r, x2: it.x + r, y1: it.y - r, y2: it.y + r };
      }
      if (it.t === 'block') {
        // Шошгыг оруулаад: зүүн талд эгнээний дугаар, дээр нь суудлын дугаар, секторын нэр
        var L = SeatMap.blockLabels(it);
        var r1 = -0.5, r2 = it.rows - 0.5, c1 = -0.5, c2 = it.cols - 0.5;
        L.seatNumR.concat(L.name ? [L.name.r] : []).forEach(function (r) { r1 = Math.min(r1, r - 0.5); r2 = Math.max(r2, r + 0.5); });
        L.rowNumC.concat(L.name ? [L.name.c] : []).forEach(function (c) { c1 = Math.min(c1, c - 0.6); c2 = Math.max(c2, c + 0.6); });
        var pts = [[r1, c1], [r1, c2], [r2, c1], [r2, c2]].map(function (q) { return SeatMap.blockPoint(it, q[0], q[1]); });
        var px = pts.map(function (q) { return q.x; }), py = pts.map(function (q) { return q.y; });
        return { x1: Math.min.apply(null, px), x2: Math.max.apply(null, px), y1: Math.min.apply(null, py), y2: Math.max.apply(null, py) };
      }
      var s = SeatMap.seatsOfItem(it, 0), R = SeatMap.SEAT_R;
      var xs = s.map(function (q) { return q.x; }), ys = s.map(function (q) { return q.y; });
      return { x1: Math.min.apply(null, xs) - R, x2: Math.max.apply(null, xs) + R, y1: Math.min.apply(null, ys) - R, y2: Math.max.apply(null, ys) + R };
    }
    // Төв эхэндээ — ижил зайтай үед төвийн шугамыг илүүд үзнэ
    function anchors(b) { return { x: [(b.x1 + b.x2) / 2, b.x1, b.x2], y: [(b.y1 + b.y2) / 2, b.y1, b.y2] }; }

    // Соронзон шугамлалт: чирж буй элементийн ирмэг/төвийг бусдынх (болон талбайн төв)-тэй ойртвол наалдуулна
    var MAGNET = 8;
    function magnet(base, axis, delta, targets) {
      var best = null;
      base[axis].forEach(function (a) {
        targets.forEach(function (t) {
          var d = t - (a + delta);
          if (Math.abs(d) <= MAGNET && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, at: t };
        });
      });
      return best;
    }
    function showGuides(gx, gy) {
      var layer = $('.guides', svg);
      if (!layer) layer = el('g', { class: 'guides' }, svg);
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      if (gx != null) el('line', { x1: gx, x2: gx, y1: 0, y2: layout.h }, layer);
      if (gy != null) el('line', { x1: 0, x2: layout.w, y1: gy, y2: gy }, layer);
    }

    var drag = null;
    svg.addEventListener('pointerdown', function (ev) {
      var g = ev.target.closest && ev.target.closest('.seat-item');
      if (!g) { select(null); return; }
      var id = g.getAttribute('data-id');
      if (id !== selId) select(id);
      g = $('[data-id="' + id + '"]', svg);
      var p = point(ev);
      var it = find(id);
      var tx = [layout.w / 2], ty = [layout.h / 2];
      layout.items.forEach(function (o) {
        if (o.id === id) return;
        var a = anchors(bbox(o));
        tx = tx.concat(a.x);
        ty = ty.concat(a.y);
      });
      drag = { id: id, g: g, sx: p.x, sy: p.y, dx: 0, dy: 0, base: anchors(bbox(it)), tx: tx, ty: ty };
      svg.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var p = point(ev);
      var rx = p.x - drag.sx, ry = p.y - drag.sy;
      var mx = ev.altKey ? null : magnet(drag.base, 'x', rx, drag.tx);
      var my = ev.altKey ? null : magnet(drag.base, 'y', ry, drag.ty);
      drag.dx = mx ? Math.round(rx + mx.d) : snap(rx);
      drag.dy = my ? Math.round(ry + my.d) : snap(ry);
      drag.g.setAttribute('transform', 'translate(' + drag.dx + ',' + drag.dy + ')');
      showGuides(mx ? mx.at : null, my ? my.at : null);
    });
    function endDrag() {
      if (!drag) return;
      var it = find(drag.id);
      if (it && (drag.dx || drag.dy)) { it.x += drag.dx; it.y += drag.dy; clampXY(it); }
      drag = null;
      render();
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    document.addEventListener('keydown', function (ev) {
      if (!selId || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      var it = find(selId);
      if (!it) return;
      var step = ev.shiftKey ? 20 : 5;
      var mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (mv) { it.x += mv[0]; it.y += mv[1]; clampXY(it); render(); ev.preventDefault(); }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') { remove(selId); ev.preventDefault(); }
      else if (ev.key === 'Escape') select(null);
    });

    $$('[data-add]', root).forEach(function (b) { b.addEventListener('click', function () { add(b.getAttribute('data-add')); }); });

    // Бүх ширээг нэг дор арилгах (захиалагдсан суудалтай ширээ үлдэнэ; эгнээ, тайз хэвээр)
    $('[data-clear-tables]', root).addEventListener('click', function () {
      var tables = layout.items.filter(function (it) { return it.t === 'table'; });
      if (!tables.length) { window.alert('Планд ширээ алга.'); return; }
      var keep = tables.filter(hasLocked);
      var n = tables.length - keep.length;
      if (!n) { window.alert('Бүх ширээнд захиалагдсан суудал байгаа тул арилгах боломжгүй.'); return; }
      var msg = n + ' ширээг арилгах уу?' + (keep.length ? ' (Захиалагдсан суудалтай ' + keep.length + ' ширээ үлдэнэ.)' : '');
      if (!window.confirm(msg)) return;
      layout.items = layout.items.filter(function (it) { return it.t !== 'table' || hasLocked(it); });
      select(null);
    });

    var cw = $('[data-canvas="w"]', root), ch = $('[data-canvas="h"]', root);
    function syncCanvasInputs() { cw.value = layout.w; ch.value = layout.h; svg.style.minWidth = Math.min(layout.w, 720) + 'px'; }
    [cw, ch].forEach(function (inp) {
      inp.addEventListener('change', function () {
        var v = Number(inp.value);
        var k = inp.getAttribute('data-canvas');
        var lim = SeatMap.LIMITS[k];
        if (!(v >= lim[0] && v <= lim[1])) { inp.value = layout[k]; return; }
        layout[k] = Math.round(v);
        layout.items.forEach(clampXY);
        syncCanvasInputs();
        render();
      });
    });
    if (priceInput) priceInput.addEventListener('input', render);

    // Суудалтай сонголт идэвхжихэд л зурагч харагдана — тэр үед дахин зурна
    $$('input[name=seating]').forEach(function (r) { r.addEventListener('change', render); });
    root.closest('form').addEventListener('submit', save);

    syncCanvasInputs();
    select(null);
  }

  // ---------- Онцлох арга хэмжээний слайдер: сум, цэг, 6 секунд тутам автоматаар (хулгана дээр нь байхад зогсоно) ----------
  function initCarousel() {
    $$('[data-carousel]').forEach(function (root) {
      var track = $('[data-carousel-track]', root);
      var slides = $$('.tk-slide', track);
      var dotsBox = $('[data-carousel-dots]', root);
      if (slides.length < 2 || !dotsBox) return;
      var dots = slides.map(function (s, i) {
        var d = document.createElement('button');
        d.type = 'button';
        d.setAttribute('aria-label', (i + 1) + '-р слайд');
        d.addEventListener('click', function () { go(i); });
        dotsBox.appendChild(d);
        return d;
      });
      function current() {
        var x = track.scrollLeft, best = 0;
        slides.forEach(function (s, i) { if (Math.abs(s.offsetLeft - track.offsetLeft - x) < Math.abs(slides[best].offsetLeft - track.offsetLeft - x)) best = i; });
        return best;
      }
      function go(i) {
        i = (i + slides.length) % slides.length;
        idx = i;
        track.scrollTo({ left: slides[i].offsetLeft - track.offsetLeft, behavior: 'smooth' });
        paint();
      }
      // idx — одоогийн слайд. Сум/цэг/автомат шилжилт шууд тавина; хуруугаар гүйлгэхэд scroll-оос тооцно.
      var idx = 0;
      function paint() { dots.forEach(function (d, i) { d.classList.toggle('on', i === idx); }); }
      function mark() { idx = current(); paint(); }
      $('[data-carousel-prev]', root).addEventListener('click', function () { go(idx - 1); });
      $('[data-carousel-next]', root).addEventListener('click', function () { go(idx + 1); });
      var t = null;
      track.addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(mark, 80); });
      mark();
      var paused = false;
      root.addEventListener('mouseenter', function () { paused = true; });
      root.addEventListener('mouseleave', function () { paused = false; });
      root.addEventListener('focusin', function () { paused = true; });
      root.addEventListener('focusout', function () { paused = false; });
      if (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setInterval(function () { if (!paused && !document.hidden) go(idx + 1); }, 6000);
      }
    });
  }

  // Захиалгыг код, нэр, утсаар шүүх (удирдлагын борлуулалтын таб)
  function initOrderSearch() {
    var box = document.querySelector('[data-order-search]');
    if (!box) return;
    var input = box.querySelector('[data-order-q]');
    var hint = box.querySelector('[data-order-hint]');
    var norm = function (v) { return String(v).toLowerCase().replace(/[\s-]+/g, ''); };
    var run = function () {
      var q = norm(input.value);
      var total = 0;
      document.querySelectorAll('section[id]').forEach(function (sec) {
        var rows = sec.querySelectorAll('[data-order-row]');
        if (!rows.length) return;
        var n = 0;
        rows.forEach(function (tr) {
          var ok = !q || norm(tr.getAttribute('data-order-row')).indexOf(q) !== -1;
          tr.hidden = !ok;
          if (ok) n++;
        });
        var c = sec.querySelector('[data-order-count]');
        if (c) c.textContent = q ? n + ' / ' + rows.length : rows.length;
        total += n;
      });
      hint.textContent = q ? (total ? total + ' захиалга олдлоо' : 'Олдсонгүй') : '';
    };
    input.addEventListener('input', run);
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { input.value = ''; run(); } });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initCarousel();
    initOrderSearch();
    if (window.SeatMap) {
      initEditor();
      initSeatMaps();
    }
    initQty();
    initCopy();
  });
})();

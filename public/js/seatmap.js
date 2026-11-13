// Суудлын план: сервер (require) болон хөтөч (window.SeatMap) хоёулаа ашиглана.
// layout = { w, h, items: [...] }
//   table: { id, t: 'table', x, y, n, name, price }            — дугуй ширээ, төв нь (x, y), n суудал тойрон
//   row:   { id, t: 'row', x, y, n, name, gap, rot, start, price } — эгнээ, эхний суудал (x, y), rot градусаар эргэнэ
//   zone:  { id, t: 'zone', x, y, w, h, text }               — тайз, хаалга, баар гэх мэт тэмдэглэгээ (суудалгүй)
// price null бол арга хэмжээний үндсэн үнэ.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeatMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SEAT_R = 13;
  var LIMITS = { w: [300, 4000], h: [200, 4000], tableN: [1, 24], rowN: [1, 60], gap: [28, 80], items: 400, seats: 3000 };
  var MAX_PRICE = 1000000000;

  function tableRadius(n) { return Math.max(24, Math.round(n * 4.4)); }

  function clamp(v, lo, hi, def) {
    var n = Number(v);
    if (!isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }
  function str(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max); }

  // Тухайн элементийн суудлууд
  function seatsOfItem(it, basePrice) {
    var out = [];
    var price = it.price != null ? it.price : basePrice;
    var i;
    if (it.t === 'table') {
      var r = tableRadius(it.n) + SEAT_R + 6;
      for (i = 0; i < it.n; i++) {
        var a = -Math.PI / 2 + (2 * Math.PI * i) / it.n;
        out.push({
          key: it.id + '-' + (i + 1), item: it.id, group: 'Ширээ ' + it.name, label: it.name + '-' + (i + 1),
          x: Math.round((it.x + Math.cos(a) * r) * 10) / 10, y: Math.round((it.y + Math.sin(a) * r) * 10) / 10, price: price,
        });
      }
    } else if (it.t === 'row') {
      var rad = ((it.rot || 0) * Math.PI) / 180;
      var start = it.start || 1;
      for (i = 0; i < it.n; i++) {
        out.push({
          key: it.id + '-' + (i + 1), item: it.id, group: 'Эгнээ ' + it.name, label: it.name + (start + i),
          x: Math.round((it.x + Math.cos(rad) * it.gap * i) * 10) / 10, y: Math.round((it.y + Math.sin(rad) * it.gap * i) * 10) / 10, price: price,
        });
      }
    }
    return out;
  }

  function seats(layout, basePrice) {
    var out = [];
    ((layout && layout.items) || []).forEach(function (it) { out = out.concat(seatsOfItem(it, basePrice)); });
    return out;
  }

  // Хэрэглэгчээс ирсэн JSON-г шалгаж цэвэрлэнэ → { layout } эсвэл { error }
  function normalize(raw) {
    var data = raw;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw || '{}'); } catch (e) { return { error: 'Суудлын планыг уншиж чадсангүй.' }; }
    }
    if (!data || typeof data !== 'object') data = {};
    var w = clamp(data.w, LIMITS.w[0], LIMITS.w[1], 1000);
    var h = clamp(data.h, LIMITS.h[0], LIMITS.h[1], 700);
    var src = Array.isArray(data.items) ? data.items : [];
    if (src.length > LIMITS.items) return { error: 'Планд хэт олон элемент байна (' + LIMITS.items + '-аас ихгүй).' };
    var ids = {};
    var items = [];
    var total = 0;
    for (var i = 0; i < src.length; i++) {
      var s = src[i] || {};
      var id = /^[a-z0-9]{1,12}$/.test(String(s.id)) ? String(s.id) : null;
      if (!id || ids[id]) return { error: 'Планы элементийн дугаар буруу байна.' };
      ids[id] = true;
      var x = clamp(s.x, 0, w, 0);
      var y = clamp(s.y, 0, h, 0);
      var price = null;
      if (s.price !== null && s.price !== undefined && s.price !== '') {
        price = clamp(s.price, 0, MAX_PRICE, null);
        if (price === null) return { error: 'Суудлын үнэ буруу байна.' };
      }
      if (s.t === 'table') {
        var tn = clamp(s.n, LIMITS.tableN[0], LIMITS.tableN[1], 8);
        items.push({ id: id, t: 'table', x: x, y: y, n: tn, name: str(s.name, 10) || String(i + 1), price: price });
        total += tn;
      } else if (s.t === 'row') {
        var rn = clamp(s.n, LIMITS.rowN[0], LIMITS.rowN[1], 10);
        items.push({
          id: id, t: 'row', x: x, y: y, n: rn, name: str(s.name, 10) || String(i + 1),
          gap: clamp(s.gap, LIMITS.gap[0], LIMITS.gap[1], 34), rot: clamp(s.rot, -180, 180, 0), start: clamp(s.start, 1, 999, 1), price: price,
        });
        total += rn;
      } else if (s.t === 'zone') {
        items.push({ id: id, t: 'zone', x: x, y: y, w: clamp(s.w, 20, w, 200), h: clamp(s.h, 20, h, 60), text: str(s.text, 40) });
      }
    }
    if (total > LIMITS.seats) return { error: 'Суудлын тоо хэт их байна (' + LIMITS.seats + '-аас ихгүй).' };
    return { layout: { w: w, h: h, items: items } };
  }

  return { SEAT_R: SEAT_R, LIMITS: LIMITS, tableRadius: tableRadius, seatsOfItem: seatsOfItem, seats: seats, normalize: normalize };
});

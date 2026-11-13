// Суудлын план: сервер (require) болон хөтөч (window.SeatMap) хоёулаа ашиглана.
// layout = { w, h, bgOp, items: [...] }  — bgOp: арын (план) зургийн тод байдал, 10–100 %
//   table: { id, t: 'table', x, y, n, name, price }            — дугуй ширээ, төв нь (x, y), n суудал тойрон
//   row:   { id, t: 'row', x, y, n, name, gap, rot, start, price } — эгнээ, эхний суудал (x, y), rot градусаар эргэнэ
//   block: { id, t: 'block', x, y, rows, cols, name, gap, rot, rowStart, seatStart, rowDir, seatDir, price }
//          — сектор: rows эгнээ × cols суудлын тор. (x, y) — зүүн дээд суудлын төв. rowDir 'down' бол 1-р эгнээ дээд талд,
//            'up' бол доод талд; seatDir 'ltr' бол суудлын дугаар зүүнээс, 'rtl' бол баруунаас өснө.
//   Шошгоны байрлал: row.lp — эгнээний нэр: 'start' | 'end' | 'both' | 'top' | 'bottom' | 'none' (top/bottom — эгнээний голд)
//            block.np — секторын нэр: 'top' | 'bottom' | 'left' | 'right' | 'none'
//            block.rp — эгнээний дугаар: 'left' | 'right' | 'both' | 'none'
//            block.sp — суудлын дугаар: 'top' | 'bottom' | 'both' | 'none'
//   zone:  { id, t: 'zone', x, y, w, h, text, shape }        — тайз, хаалга, баар гэх мэт тэмдэглэгээ (суудалгүй)
//          shape: 'rect' | 'ellipse' | 'text' (зөвхөн бичвэр)
// price null бол арга хэмжээний үндсэн үнэ.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeatMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SEAT_R = 13;
  var LIMITS = {
    w: [300, 6000], h: [200, 6000], tableN: [1, 24], rowN: [1, 60], gap: [28, 80],
    blockRows: [1, 60], blockCols: [1, 80], blockGap: [14, 60], items: 400, seats: 10000,
  };
  var ZONE_SHAPES = ['rect', 'ellipse', 'text'];
  var POS = {
    lp: ['start', 'end', 'both', 'top', 'bottom', 'none'],
    np: ['top', 'bottom', 'left', 'right', 'none'],
    rp: ['left', 'right', 'both', 'none'],
    sp: ['top', 'bottom', 'both', 'none'],
  };
  function pos(it, k) { return POS[k].indexOf(it[k]) >= 0 ? it[k] : POS[k][0]; }

  // Секторын шошгоны байрлал (торын нэгжээр): { name: {r, c} | null, rowNumC: [c...], seatNumR: [r...] }
  function blockLabels(it) {
    var np = pos(it, 'np'), rp = pos(it, 'rp'), sp = pos(it, 'sp');
    var top = sp === 'top' || sp === 'both', bottom = sp === 'bottom' || sp === 'both';
    var left = rp === 'left' || rp === 'both', right = rp === 'right' || rp === 'both';
    var midR = (it.rows - 1) / 2, midC = (it.cols - 1) / 2;
    var name = null;
    if (np === 'top') name = { r: top ? -1.9 : -1.05, c: midC };
    else if (np === 'bottom') name = { r: it.rows - 1 + (bottom ? 1.9 : 1.05), c: midC };
    else if (np === 'left') name = { r: midR, c: left ? -2.3 : -1.3 };
    else if (np === 'right') name = { r: midR, c: it.cols - 1 + (right ? 2.3 : 1.3) };
    var rowNumC = [], seatNumR = [];
    if (left) rowNumC.push(-1);
    if (right) rowNumC.push(it.cols);
    if (top) seatNumR.push(-0.95);
    if (bottom) seatNumR.push(it.rows - 1 + 0.95);
    return { name: name, rowNumC: rowNumC, seatNumR: seatNumR };
  }

  // Секторын (r, c) байрлалын цэг (0-ээс эхэлсэн индекс; бутархай/сөрөг байж болно — шошгонд)
  function blockPoint(it, r, c) {
    var rad = ((it.rot || 0) * Math.PI) / 180;
    var dx = c * it.gap, dy = r * it.gap;
    return {
      x: Math.round((it.x + dx * Math.cos(rad) - dy * Math.sin(rad)) * 10) / 10,
      y: Math.round((it.y + dx * Math.sin(rad) + dy * Math.cos(rad)) * 10) / 10,
    };
  }
  function blockRowNo(it, r) { return (it.rowStart || 1) + (it.rowDir === 'up' ? it.rows - 1 - r : r); }
  function blockSeatNo(it, c) { return (it.seatStart || 1) + (it.seatDir === 'rtl' ? it.cols - 1 - c : c); }
  function blockSeatSize(it) { return Math.max(8, Math.round(it.gap * 0.78)); }
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
    } else if (it.t === 'block') {
      for (var r2 = 0; r2 < it.rows; r2++) {
        for (var c2 = 0; c2 < it.cols; c2++) {
          var p = blockPoint(it, r2, c2);
          var rowNo = blockRowNo(it, r2), seatNo = blockSeatNo(it, c2);
          out.push({
            key: it.id + '-' + (r2 + 1) + '-' + (c2 + 1), item: it.id, group: it.name + ' сектор',
            label: it.name + ' сектор · ' + rowNo + ' эгнээ · ' + seatNo + ' суудал',
            sec: it.name, row: rowNo, seat: seatNo, x: p.x, y: p.y, price: price,
          });
        }
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
          lp: pos(s, 'lp'),
        });
        total += rn;
      } else if (s.t === 'block') {
        var br = clamp(s.rows, LIMITS.blockRows[0], LIMITS.blockRows[1], 8);
        var bc = clamp(s.cols, LIMITS.blockCols[0], LIMITS.blockCols[1], 10);
        items.push({
          id: id, t: 'block', x: x, y: y, rows: br, cols: bc, name: str(s.name, 10) || String(i + 1),
          gap: clamp(s.gap, LIMITS.blockGap[0], LIMITS.blockGap[1], 22), rot: clamp(s.rot, -180, 180, 0),
          rowStart: clamp(s.rowStart, 1, 999, 1), seatStart: clamp(s.seatStart, 1, 999, 1),
          rowDir: s.rowDir === 'up' ? 'up' : 'down', seatDir: s.seatDir === 'rtl' ? 'rtl' : 'ltr', price: price,
          np: pos(s, 'np'), rp: pos(s, 'rp'), sp: pos(s, 'sp'),
        });
        total += br * bc;
      } else if (s.t === 'zone') {
        items.push({
          id: id, t: 'zone', x: x, y: y, w: clamp(s.w, 20, w, 200), h: clamp(s.h, 20, h, 60), text: str(s.text, 40),
          shape: ZONE_SHAPES.indexOf(s.shape) >= 0 ? s.shape : 'rect',
        });
      }
    }
    if (total > LIMITS.seats) return { error: 'Суудлын тоо хэт их байна (' + LIMITS.seats + '-аас ихгүй).' };
    return { layout: { w: w, h: h, bgOp: clamp(data.bgOp, 10, 100, 70), items: items } };
  }

  return {
    SEAT_R: SEAT_R, LIMITS: LIMITS, tableRadius: tableRadius, seatsOfItem: seatsOfItem, seats: seats, normalize: normalize,
    blockPoint: blockPoint, blockLabels: blockLabels, pos: pos, blockRowNo: blockRowNo, blockSeatNo: blockSeatNo, blockSeatSize: blockSeatSize,
  };
});

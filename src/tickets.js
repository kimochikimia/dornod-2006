// Тасалбартай арга хэмжээ: арга хэмжээ, захиалга, суудлын түгжээ.
// Захиалга "pending" төлөвтэй үүсч гүйлгээний утга (code)-аар данс руу шилжүүлнэ; удирдлага баталгаажуулахад "paid" болно.
// Хугацаандаа (hold_hours) төлөгдөөгүй захиалга автоматаар цуцлагдаж суудал/тоо чөлөөлөгдөнө.
const crypto = require('crypto');
const { pool } = require('./db');
const { clean, fromUbInput, ubInput, fmtDate } = require('./helpers');
const { fmtMoney, parseAmount } = require('./campaigns');
const SeatMap = require('../public/js/seatmap');

const STATUS_LABELS = { pending: 'Төлбөр хүлээгдэж буй', paid: 'Төлсөн', cancelled: 'Цуцлагдсан' };
const CANCEL_LABELS = { expired: 'Төлөх хугацаа дууссан', user: 'Захиалагч цуцалсан', admin: 'Удирдлага цуцалсан' };
const EVENT_STATUS = { draft: 'Ноорог', open: 'Нийтлэгдсэн', closed: 'Хаагдсан' };
const PHASE_LABELS = { draft: 'Ноорог', soon: 'Удахгүй', onsale: 'Худалдаалж байна', soldout: 'Дууссан', ended: 'Худалдаа хаагдсан' };
const MAX_PENDING_PER_USER = 3;
const ADMIN_MAX_SEATS = 100;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  let s = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}

// Төлөх хугацаа нь өнгөрсөн захиалгыг цуцалж түгжээг чөлөөлнө.
async function expireStale(db = pool) {
  await db.query(
    "UPDATE ticket_orders SET status = 'cancelled', cancel_reason = 'expired' WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()"
  );
  await db.query("DELETE l FROM ticket_seat_locks l JOIN ticket_orders o ON o.id = l.order_id WHERE o.status = 'cancelled'");
}

// Постерын BLOB-оос бусад багана (жагсаалт, захиалгад зураг татахгүй)
const EV = `e.id, e.title, e.summary, e.body, e.venue, e.event_at, e.sale_start, e.sale_end, e.seating, e.price, e.capacity,
  e.max_per_order, e.hold_hours, e.layout, e.bank_name, e.bank_account, e.bank_holder, e.contact, e.status, e.poster_v,
  e.created_by, e.created_at, e.updated_at`;

const STATS = `
  (SELECT COALESCE(SUM(o.quantity), 0) FROM ticket_orders o WHERE o.event_id = e.id AND o.status = 'paid') AS paid_qty,
  (SELECT COALESCE(SUM(o.amount), 0) FROM ticket_orders o WHERE o.event_id = e.id AND o.status = 'paid') AS paid_amount,
  (SELECT COALESCE(SUM(o.quantity), 0) FROM ticket_orders o WHERE o.event_id = e.id AND o.status = 'pending') AS pending_qty,
  (SELECT COUNT(*) FROM ticket_orders o WHERE o.event_id = e.id AND o.status = 'pending') AS pending_orders`;

function decorate(e) {
  for (const k of ['price', 'paid_qty', 'paid_amount', 'pending_qty', 'pending_orders']) e[k] = Number(e[k] || 0);
  e.capacity = e.capacity == null ? null : Number(e.capacity);
  let layout = null;
  if (e.layout) {
    try { layout = SeatMap.normalize(e.layout).layout || null; } catch (err) { layout = null; }
  }
  e.layoutObj = layout || { w: 1000, h: 700, items: [] };
  e.seatList = e.seating === 'seated' ? SeatMap.seats(e.layoutObj, e.price) : [];
  e.total = e.seating === 'seated' ? e.seatList.length : e.capacity;
  e.sold = e.paid_qty + e.pending_qty; // түгжигдсэн (төлсөн + хүлээгдэж буй)
  e.left = e.total == null ? null : Math.max(0, e.total - e.sold);
  if (e.seating === 'seated' && e.seatList.length) {
    const prices = e.seatList.map((s) => s.price);
    e.minPrice = Math.min(...prices);
    e.maxPrice = Math.max(...prices);
  } else {
    e.minPrice = e.maxPrice = e.price;
  }
  e.priceText = e.minPrice === e.maxPrice ? (e.minPrice ? fmtMoney(e.minPrice) : 'Үнэгүй') : `${fmtMoney(e.minPrice)} – ${fmtMoney(e.maxPrice)}`;
  const now = Date.now();
  if (e.status === 'draft') e.phase = 'draft';
  else if (e.status === 'closed' || new Date(e.sale_end).getTime() < now) e.phase = 'ended';
  else if (e.sale_start && new Date(e.sale_start).getTime() > now) e.phase = 'soon';
  else if (e.left === 0) e.phase = 'soldout';
  else e.phase = 'onsale';
  e.onSale = e.phase === 'onsale';
  e.eventText = fmtDate(e.event_at);
  e.saleText = `${e.sale_start ? fmtDate(e.sale_start) : 'Одооноос'} – ${fmtDate(e.sale_end)}`;
  return e;
}

async function list({ includeDrafts = false } = {}) {
  await expireStale();
  const [rows] = await pool.query(
    `SELECT ${EV}, ${STATS} FROM ticket_events e ${includeDrafts ? '' : "WHERE e.status <> 'draft'"}
     ORDER BY e.event_at < NOW(), CASE WHEN e.event_at < NOW() THEN -UNIX_TIMESTAMP(e.event_at) ELSE UNIX_TIMESTAMP(e.event_at) END, e.id DESC`
  );
  return rows.map(decorate);
}

async function get(id) {
  await expireStale();
  const [[e]] = await pool.query(`SELECT ${EV}, ${STATS} FROM ticket_events e WHERE e.id = ?`, [id]);
  return e ? decorate(e) : null;
}

function parseSeats(o) {
  try { return JSON.parse(o.seats || '[]'); } catch (e) { return []; }
}

function decorateOrder(o) {
  o.amount = Number(o.amount);
  o.seatArr = parseSeats(o);
  o.seatText = o.seatArr.map((s) => s.label).join(', ');
  return o;
}

// Суудал бүрийн төлөв: { key: 'paid' | 'pending' }; мөн тухайн хэрэглэгчийнх бол mine.
async function seatStates(eventId, userId) {
  const [rows] = await pool.query(
    `SELECT l.seat_key, o.status, o.user_id FROM ticket_seat_locks l JOIN ticket_orders o ON o.id = l.order_id WHERE l.event_id = ?`,
    [eventId]
  );
  const out = {};
  for (const r of rows) out[r.seat_key] = userId && r.user_id === userId ? 'mine' : r.status;
  return out;
}

async function orders(eventId) {
  const [rows] = await pool.query(
    `SELECT o.*, u.surname, u.name, r.surname AS r_surname, r.name AS r_name
     FROM ticket_orders o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN users r ON r.id = o.reviewed_by
     WHERE o.event_id = ? ORDER BY o.created_at DESC, o.id DESC`,
    [eventId]
  );
  return rows.map(decorateOrder);
}

async function userOrders(eventId, userId) {
  const [rows] = await pool.query(
    'SELECT * FROM ticket_orders WHERE event_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC',
    [eventId, userId]
  );
  return rows.map(decorateOrder);
}

// Хэрэглэгчийн бүх арга хэмжээний захиалга (Миний тасалбар)
async function allUserOrders(userId) {
  await expireStale();
  const [rows] = await pool.query(
    `SELECT o.*, e.title, e.event_at FROM ticket_orders o JOIN ticket_events e ON e.id = o.event_id
     WHERE o.user_id = ? AND o.status <> 'cancelled' ORDER BY e.event_at DESC, o.id DESC`,
    [userId]
  );
  return rows.map(decorateOrder);
}

async function getOrder(code) {
  await expireStale();
  const [[o]] = await pool.query('SELECT * FROM ticket_orders WHERE code = ?', [String(code || '').toUpperCase().slice(0, 12)]);
  return o ? decorateOrder(o) : null;
}

class OrderError extends Error {}

// Захиалга үүсгэх. opts: { userId, buyerName, buyerPhone, note, quantity, seatKeys, admin, paid }
// Арга хэмжээний мөрийг FOR UPDATE-ээр түгжиж тоо/суудлыг давхардуулахгүй шалгана.
async function placeOrder(eventId, opts) {
  await expireStale();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[raw]] = await conn.query(`SELECT ${EV} FROM ticket_events e WHERE e.id = ? FOR UPDATE`, [eventId]);
    if (!raw) throw new OrderError('Арга хэмжээ олдсонгүй.');
    const e = decorate({ ...raw });
    if (!opts.admin) {
      if (e.status !== 'open') throw new OrderError('Энэ арга хэмжээний тасалбар худалдаалагдахгүй байна.');
      const now = Date.now();
      if (e.sale_start && new Date(e.sale_start).getTime() > now) throw new OrderError('Тасалбарын худалдаа хараахан эхлээгүй байна.');
      if (new Date(e.sale_end).getTime() < now) throw new OrderError('Тасалбарын худалдааны хугацаа дууссан.');
      const [[{ n }]] = await conn.query(
        "SELECT COUNT(*) AS n FROM ticket_orders WHERE event_id = ? AND user_id = ? AND status = 'pending'", [e.id, opts.userId]
      );
      if (n >= MAX_PENDING_PER_USER) throw new OrderError(`Танд төлбөр хүлээгдэж буй ${n} захиалга байна. Эхлээд тэдгээрийг төлөх эсвэл цуцална уу.`);
    }
    const limit = opts.admin ? ADMIN_MAX_SEATS : e.max_per_order;
    let quantity;
    let amount;
    let seatRows = [];
    if (e.seating === 'seated') {
      const byKey = new Map(e.seatList.map((s) => [s.key, s]));
      const keys = [...new Set((opts.seatKeys || []).map(String))];
      if (!keys.length) throw new OrderError('Суудлаа сонгоно уу.');
      if (keys.length > limit) throw new OrderError(`Нэг захиалгаар ${limit}-аас ихгүй суудал авна.`);
      seatRows = keys.map((k) => byKey.get(k));
      if (seatRows.some((s) => !s)) throw new OrderError('Сонгосон суудал планд байхгүй байна. Хуудсаа дахин ачаална уу.');
      quantity = seatRows.length;
      amount = seatRows.reduce((sum, s) => sum + s.price, 0);
    } else {
      quantity = Number(opts.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) throw new OrderError('Тасалбарын тоог зөв оруулна уу.');
      if (quantity > limit) throw new OrderError(`Нэг захиалгаар ${limit}-аас ихгүй тасалбар авна.`);
      if (e.capacity != null) {
        const [[{ used }]] = await conn.query(
          "SELECT COALESCE(SUM(quantity), 0) AS used FROM ticket_orders WHERE event_id = ? AND status IN ('pending','paid')", [e.id]
        );
        const left = e.capacity - Number(used);
        if (quantity > left) throw new OrderError(left > 0 ? `Зөвхөн ${left} тасалбар үлдсэн байна.` : 'Тасалбар дууссан байна.');
      }
      amount = quantity * e.price;
    }
    const paid = opts.paid || amount === 0;
    const row = {
      event_id: e.id,
      user_id: opts.userId || null,
      buyer_name: clean(opts.buyerName, 150) || 'Нэргүй',
      buyer_phone: clean(opts.buyerPhone, 40) || null,
      note: clean(opts.note, 500) || null,
      quantity,
      amount,
      seats: seatRows.length ? JSON.stringify(seatRows.map((s) => ({ key: s.key, label: s.label, group: s.group, price: s.price }))) : null,
      status: paid ? 'paid' : 'pending',
      expires_at: paid ? null : new Date(Date.now() + e.hold_hours * 3600 * 1000),
      reviewed_by: opts.paid ? opts.reviewerId || null : null,
      reviewed_at: opts.paid ? new Date() : null,
    };
    let orderId;
    let code;
    for (let i = 0; i < 6 && !orderId; i++) {
      code = newCode();
      try {
        const [r] = await conn.query('INSERT INTO ticket_orders SET ?', [{ ...row, code }]);
        orderId = r.insertId;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    if (!orderId) throw new Error('Захиалгын код үүсгэж чадсангүй.');
    if (seatRows.length) {
      try {
        await conn.query('INSERT INTO ticket_seat_locks (event_id, seat_key, order_id) VALUES ?', [seatRows.map((s) => [e.id, s.key, orderId])]);
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') throw new OrderError('Сонгосон суудлын зарим нь дөнгөж сая өөр хүнд захиалагдлаа. Өөр суудал сонгоно уу.');
        throw err;
      }
    }
    await conn.commit();
    return { code, orderId, status: row.status };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Захиалгын төлөв солих: paid | cancelled. Цуцлагдсаныг дахин "paid" болгоход суудал/тоо чөлөөтэй эсэхийг шалгана.
async function setOrderStatus(orderId, status, { reviewerId, reason } = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // placeOrder-той ижил дарааллаар (эхлээд арга хэмжээ) түгжинэ
    const [[ref]] = await conn.query('SELECT event_id FROM ticket_orders WHERE id = ?', [orderId]);
    if (!ref) throw new OrderError('Захиалга олдсонгүй.');
    const [[e]] = await conn.query(`SELECT ${EV} FROM ticket_events e WHERE e.id = ? FOR UPDATE`, [ref.event_id]);
    const [[o]] = await conn.query('SELECT * FROM ticket_orders WHERE id = ? FOR UPDATE', [orderId]);
    if (status === 'paid') {
      if (o.status === 'cancelled') {
        const seats = parseSeats(o);
        if (seats.length) {
          try {
            await conn.query('INSERT INTO ticket_seat_locks (event_id, seat_key, order_id) VALUES ?', [seats.map((s) => [o.event_id, s.key, o.id])]);
          } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') throw new OrderError('Энэ захиалгын суудлын зарим нь өөр хүнд зарагдсан тул сэргээх боломжгүй.');
            throw err;
          }
        } else if (e.capacity != null) {
          const [[{ used }]] = await conn.query(
            "SELECT COALESCE(SUM(quantity), 0) AS used FROM ticket_orders WHERE event_id = ? AND status IN ('pending','paid')", [o.event_id]
          );
          if (Number(used) + o.quantity > e.capacity) throw new OrderError('Тасалбарын тоо хүрэлцэхгүй тул сэргээх боломжгүй.');
        }
      }
      await conn.query(
        "UPDATE ticket_orders SET status = 'paid', cancel_reason = NULL, expires_at = NULL, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
        [reviewerId || null, new Date(), o.id]
      );
    } else if (status === 'cancelled') {
      await conn.query(
        "UPDATE ticket_orders SET status = 'cancelled', cancel_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
        [reason || 'admin', reviewerId || null, new Date(), o.id]
      );
      await conn.query('DELETE FROM ticket_seat_locks WHERE order_id = ?', [o.id]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Удирдлагын маягт → { errors, fields }
function eventFields(body, { lockedKeys = [], hasOrders = false, current = null } = {}) {
  const errors = [];
  const f = {
    title: clean(body.title, 200),
    summary: clean(body.summary, 500) || null,
    body: clean(body.body, 20000) || null,
    venue: clean(body.venue, 300) || null,
    event_at: fromUbInput(body.event_at),
    sale_start: fromUbInput(body.sale_start),
    sale_end: fromUbInput(body.sale_end),
    seating: body.seating === 'seated' ? 'seated' : 'none',
    price: 0,
    capacity: null,
    max_per_order: Math.min(50, Math.max(1, parseInt(body.max_per_order, 10) || 10)),
    hold_hours: Math.min(168, Math.max(1, parseInt(body.hold_hours, 10) || 24)),
    layout: null,
    bank_name: clean(body.bank_name, 100) || null,
    bank_account: clean(body.bank_account, 60) || null,
    bank_holder: clean(body.bank_holder, 150) || null,
    contact: clean(body.contact, 300) || null,
    status: ['draft', 'open', 'closed'].includes(body.status) ? body.status : 'draft',
  };
  if (!f.title) errors.push('Арга хэмжээний нэрийг бичнэ үү.');
  if (!f.event_at) errors.push('Арга хэмжээ болох огноо, цагийг оруулна уу.');
  if (!f.sale_end) errors.push('Тасалбар худалдаалах эцсийн хугацааг оруулна уу.');
  if (f.sale_start && f.sale_end && f.sale_end <= f.sale_start) errors.push('Худалдаа дуусах хугацаа эхлэхээсээ хойно байх ёстой.');
  if (f.event_at && f.sale_end && f.sale_end > f.event_at) errors.push('Худалдаа арга хэмжээ эхлэхээс өмнө дуусах ёстой.');
  if (clean(body.price, 30)) {
    f.price = parseAmount(body.price);
    if (f.price == null) errors.push('Тасалбарын үнийг зөв оруулна уу (жишээ нь 50000).');
  }
  if (f.price == null) f.price = 0;
  if (f.seating === 'none' && clean(body.capacity, 10)) {
    f.capacity = parseInt(String(body.capacity).replace(/\D/g, ''), 10);
    if (!(f.capacity > 0 && f.capacity <= 100000)) errors.push('Нийт тасалбарын тоог зөв оруулна уу.');
  }
  if (f.seating === 'seated') {
    const r = SeatMap.normalize(body.layout);
    if (r.error) errors.push(r.error);
    else {
      f.layout = JSON.stringify(r.layout);
      const keys = new Set(SeatMap.seats(r.layout, f.price).map((s) => s.key));
      if (!keys.size && f.status === 'open') errors.push('Суудлын план хоосон байна. Ширээ эсвэл эгнээ нэмнэ үү.');
      const lost = lockedKeys.filter((k) => !keys.has(k));
      if (lost.length) errors.push(`Захиалагдсан ${lost.length} суудлыг планаас хасах боломжгүй. Эхлээд тэдгээр захиалгыг цуцална уу.`);
    }
  } else if (current && current.layout) {
    f.layout = current.layout; // суудалгүй болговол хуучин планыг хадгална
  }
  if (hasOrders && current && current.seating !== f.seating) errors.push('Идэвхтэй захиалгатай үед суудлын төрлийг солих боломжгүй.');
  if (f.price > 0 && f.status === 'open' && !f.bank_account) errors.push('Төлбөр хүлээн авах дансны дугаарыг оруулна уу.');
  return { errors, fields: f };
}

// Маягтын утгууд (алдаатай үед буцааж харуулахад)
function formValues(e) {
  return {
    ...e,
    event_input: e.event_at ? ubInput(e.event_at) : '',
    sale_start_input: e.sale_start ? ubInput(e.sale_start) : '',
    sale_end_input: e.sale_end ? ubInput(e.sale_end) : '',
    layout: e.layout || JSON.stringify({ w: 1000, h: 700, items: [] }),
  };
}

module.exports = {
  STATUS_LABELS, CANCEL_LABELS, EVENT_STATUS, PHASE_LABELS, MAX_PENDING_PER_USER, OrderError,
  fmtMoney, list, get, seatStates, orders, userOrders, allUserOrders, getOrder, placeOrder, setOrderStatus, eventFields, formValues, expireStale,
};

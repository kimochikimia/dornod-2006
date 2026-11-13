// Удирдлага → Тасалбар: арга хэмжээ үүсгэх (суудлын план зурах), захиалгын төлбөр баталгаажуулах, гараар тасалбар бичих.
// /admin/tickets: manage_tickets — арга хэмжээ үүсгэх/засах; sell_tickets — гараар тасалбар бичих;
// confirm_tickets — зөвхөн борлуулалтын таб (захиалга харах, төлбөр баталгаажуулах, цуцлах).
const express = require('express');
const { pool } = require('../db');
const { flash, wrap, requirePerm, can } = require('../middleware');
const { clean, fullName } = require('../helpers');
const tk = require('../tickets');

const gallery = require('../gallery');

const router = express.Router();
const manage = requirePerm('manage_tickets');
const confirm = requirePerm('confirm_tickets');
const sell = requirePerm('sell_tickets');
const checkin = requirePerm('checkin_tickets');

// Браузер дээр шахсан постер (заавал биш). Буруу бол алдаа, байхгүй бол null.
function posterFields(body) {
  if (!body.poster) return { poster: body.remove_poster ? { poster: null, poster_thumb: null, poster_v: null } : null };
  const poster = gallery.parseJpeg(body.poster, gallery.MAX_PHOTO);
  const thumb = gallery.parseJpeg(body.poster_thumb, gallery.MAX_THUMB);
  if (!poster || !thumb) return { error: 'Постер зураг буруу эсвэл хэт том байна.' };
  return { poster: { poster, poster_thumb: thumb, poster_v: Math.floor(Date.now() / 1000) % 2000000000 } };
}
// Суудлын планы арын зураг (заавал биш)
function planBgFields(body) {
  if (!body.plan_bg) return { bg: body.remove_plan_bg ? { plan_bg: null, plan_bg_v: null } : null };
  const img = gallery.parseJpeg(body.plan_bg, gallery.MAX_PHOTO);
  if (!img) return { error: 'Планы зураг буруу эсвэл хэт том байна.' };
  return { bg: { plan_bg: img, plan_bg_v: Math.floor(Date.now() / 1000) % 2000000000 } };
}
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const blank = () => tk.formValues({
  title: '', summary: '', body: '', venue: '', venue_url: '', event_at: null, sale_start: null, sale_end: null, seating: 'none', price: 0,
  capacity: null, max_per_order: 10, hold_hours: 24, layout: null, bank_name: '', bank_account: '', bank_holder: '', contact: '', status: 'draft',
});

async function lockedKeys(eventId) {
  const [rows] = await pool.query('SELECT seat_key FROM ticket_seat_locks WHERE event_id = ?', [eventId]);
  return rows.map((r) => r.seat_key);
}

// bg: алдаатай буцахад шинээр сонгосон зургийг (data URL) алдахгүйн тулд
function renderForm(res, item, errors = [], locked = [], body = {}) {
  let bg = item.plan_bg_v ? `/tickets/${item.id}/plan-bg?v=${item.plan_bg_v}` : null;
  if (body.remove_plan_bg) bg = null;
  if (body.plan_bg && /^data:image\/jpeg;base64,/.test(body.plan_bg)) bg = body.plan_bg;
  res.status(errors.length ? 400 : 200).render('admin/ticket-form', {
    title: item.id ? 'Арга хэмжээ засах' : 'Шинэ арга хэмжээ', item, errors, tk,
    editorJson: safeJson({ layout: JSON.parse(item.layout || '{}'), price: Number(item.price) || 0, locked, bg }),
  });
}

router.get('/', wrap(async (req, res) => {
  res.render('admin/tickets', { title: 'Тасалбар — Удирдлага', events: await tk.list({ includeDrafts: true }), tk });
}));

// QR уншуулахад нээгдэх шалгах хуудас
router.get('/checkin/:token', checkin, wrap(async (req, res, next) => {
  const order = await tk.getByToken(req.params.token);
  if (!order) return res.status(404).render('admin/ticket-checkin', { title: 'Тасалбар шалгах', order: null, log: [], tk });
  res.render('admin/ticket-checkin', { title: `Тасалбар ${order.code}`, order, log: await tk.checkinLog(order.id), tk });
}));

router.post('/checkin/:token', checkin, wrap(async (req, res) => {
  const order = await tk.getByToken(req.params.token);
  if (!order) return res.redirect(`/admin/tickets/checkin/${encodeURIComponent(req.params.token)}`);
  try {
    const r = await tk.checkIn(order.id, req.body.count === 'all' ? order.quantity : 1, req.user.id);
    flash(req, 'success', `✓ ${r.n} хүн орлоо (${r.checked_in} / ${r.quantity}).`);
  } catch (err) {
    if (!(err instanceof tk.OrderError)) throw err;
    flash(req, 'error', err.message);
  }
  res.redirect(`/admin/tickets/checkin/${order.checkin_token}`);
}));

router.get('/new', manage, (req, res) => renderForm(res, blank()));

router.post('/', manage, wrap(async (req, res) => {
  const { errors, fields } = tk.eventFields(req.body);
  const p = posterFields(req.body);
  if (p.error) errors.push(p.error);
  const b = planBgFields(req.body);
  if (b.error) errors.push(b.error);
  if (errors.length) return renderForm(res, tk.formValues({ ...fields, layout: req.body.layout }), errors, [], req.body);
  const [r] = await pool.query('INSERT INTO ticket_events SET ?', [{ ...fields, ...(p.poster || {}), ...(b.bg || {}), created_by: req.user.id }]);
  flash(req, 'success', fields.status === 'open' ? 'Арга хэмжээ нийтлэгдлээ.' : 'Ноорог хадгалагдлаа.');
  res.redirect(`/admin/tickets/${r.insertId}`);
}));

router.get('/:id(\\d+)/edit', manage, wrap(async (req, res, next) => {
  const item = await tk.get(req.params.id);
  if (!item) return next();
  renderForm(res, tk.formValues(item), [], await lockedKeys(item.id));
}));

router.post('/:id(\\d+)/edit', manage, wrap(async (req, res, next) => {
  const item = await tk.get(req.params.id);
  if (!item) return next();
  const locked = await lockedKeys(item.id);
  const hasOrders = item.paid_qty + item.pending_qty + item.held_qty > 0;
  const { errors, fields } = tk.eventFields(req.body, { lockedKeys: locked, hasOrders, current: item });
  const p = posterFields(req.body);
  if (p.error) errors.push(p.error);
  const b = planBgFields(req.body);
  if (b.error) errors.push(b.error);
  if (errors.length) {
    return renderForm(res, tk.formValues({ ...fields, id: item.id, poster_v: item.poster_v, plan_bg_v: item.plan_bg_v, layout: req.body.layout || item.layout }), errors, locked, req.body);
  }
  await pool.query('UPDATE ticket_events SET ? WHERE id = ?', [{ ...fields, ...(p.poster || {}), ...(b.bg || {}) }, item.id]);
  flash(req, 'success', 'Хадгалагдлаа.');
  res.redirect(`/admin/tickets/${item.id}`);
}));

router.post('/:id(\\d+)/delete', manage, wrap(async (req, res) => {
  await pool.query('DELETE FROM ticket_events WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Арга хэмжээ бүх захиалгатайгаа устгагдлаа.');
  res.redirect('/admin/tickets');
}));

// Гараар тасалбар бичихэд сонгох бүртгэлтэй (батлагдсан) төгсөгчид
async function memberOptions() {
  const [rows] = await pool.query(
    `SELECT u.id, u.surname, u.name, u.phone, u.class_name, s.name AS school_name FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.status = 'approved' ORDER BY u.surname, u.name`
  );
  return rows;
}

async function renderManage(res, event, tab, errors = [], form = {}) {
  const all = await tk.orders(event.id);
  const states = event.seating === 'seated' ? await tk.seatStates(event.id, null) : {};
  res.status(errors.length ? 400 : 200).render('admin/ticket', {
    title: `${event.title} — Тасалбар`, event, tk, errors, form, tab,
    members: tab === 'sell' ? await memberOptions() : [],
    active: all.filter((o) => o.status !== 'cancelled'),
    pending: all.filter((o) => o.status === 'pending' && !o.held),
    held: all.filter((o) => o.held),
    paid: all.filter((o) => o.status === 'paid'),
    cancelled: all.filter((o) => o.status === 'cancelled'),
    mapJson: event.seating === 'seated' ? safeJson({ layout: event.layoutObj, price: event.price, states, max: 100, bg: event.planBgUrl }) : null,
  });
}

router.get('/:id(\\d+)', wrap(async (req, res, next) => {
  const event = await tk.get(req.params.id);
  if (!event) return next();
  // Борлуулалт харах эрхгүй бол өөрт байгаа хэсэг рүү нь
  if (!can(req.user, 'confirm_tickets')) return res.redirect(`/admin/tickets/${event.id}/${can(req.user, 'sell_tickets') ? 'sell' : 'edit'}`);
  await renderManage(res, event, 'sales');
}));

router.get('/:id(\\d+)/sell', sell, wrap(async (req, res, next) => {
  const event = await tk.get(req.params.id);
  if (!event) return next();
  await renderManage(res, event, 'sell');
}));

// Гараар тасалбар бичих (бэлнээр эсвэл бүртгэлгүй хүнд) — шууд "Төлсөн" эсвэл "хүлээгдэж буй"
router.post('/:id(\\d+)/orders', sell, wrap(async (req, res, next) => {
  const event = await tk.get(req.params.id);
  if (!event) return next();
  // Зөвхөн бүртгэлтэй (батлагдсан) төгсөгчид тасалбар бичнэ
  const [[buyer]] = await pool.query("SELECT id, surname, name, phone FROM users WHERE id = ? AND status = 'approved'", [Number(req.body.user_id) || 0]);
  if (!buyer) return renderManage(res, event, 'sell', ['Тасалбар авах төгсөгчийг жагсаалтаас сонгоно уу.'], req.body);
  try {
    const r = await tk.placeOrder(event.id, {
      admin: true,
      paid: req.body.mode !== 'held',
      held: req.body.mode === 'held',
      reviewerId: req.user.id,
      userId: buyer.id,
      buyerName: fullName(buyer),
      buyerPhone: buyer.phone,
      note: req.body.note,
      quantity: Number(req.body.quantity),
      seatKeys: String(req.body.seats || '').split(',').filter(Boolean).slice(0, 200),
    });
    flash(req, 'success', r.held
      ? `Түгжигдлээ (код ${r.code}). Энэ кодыг гүйлгээний утгад бичиж төлнө; төлбөр орвол борлуулалтаас "Төлсөн" болгоно.`
      : `Тасалбар бүртгэгдлээ (код ${r.code}).`);
    // Онлайн захиалгатай адил: захиалгын хуудас (код, төлбөрийн мэдээлэл) руу
    res.redirect(`/tickets/order/${r.code}`);
  } catch (err) {
    if (!(err instanceof tk.OrderError)) throw err;
    await renderManage(res, event, 'sell', [err.message], req.body);
  }
}));

router.post('/:id(\\d+)/orders/:oid(\\d+)', confirm, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const oid = Number(req.params.oid);
  const action = req.body.action;
  const [[o]] = await pool.query('SELECT id FROM ticket_orders WHERE id = ? AND event_id = ?', [oid, id]);
  if (o) {
    try {
      if (action === 'delete') {
        await pool.query('DELETE FROM ticket_orders WHERE id = ?', [oid]);
        flash(req, 'success', 'Захиалга устгагдлаа.');
      } else if (action === 'paid' || action === 'cancelled') {
        await tk.setOrderStatus(oid, action, { reviewerId: req.user.id, reason: 'admin' });
        flash(req, 'success', action === 'paid' ? 'Төлбөр баталгаажлаа.' : 'Захиалга цуцлагдлаа.');
      }
    } catch (err) {
      if (!(err instanceof tk.OrderError)) throw err;
      flash(req, 'error', err.message);
    }
  }
  res.redirect(`/admin/tickets/${id}`);
}));

module.exports = router;

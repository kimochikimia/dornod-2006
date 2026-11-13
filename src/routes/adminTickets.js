// Удирдлага → Тасалбар: арга хэмжээ үүсгэх (суудлын план зурах), захиалгын төлбөр баталгаажуулах, гараар тасалбар бичих.
// /admin/tickets: manage_tickets — арга хэмжээ үүсгэх/засах; sell_tickets — гараар тасалбар бичих;
// confirm_tickets — зөвхөн борлуулалтын таб (захиалга харах, төлбөр баталгаажуулах, цуцлах).
const express = require('express');
const { pool } = require('../db');
const { flash, wrap, requirePerm, can } = require('../middleware');
const { clean } = require('../helpers');
const tk = require('../tickets');

const gallery = require('../gallery');

const router = express.Router();
const manage = requirePerm('manage_tickets');
const confirm = requirePerm('confirm_tickets');
const sell = requirePerm('sell_tickets');

// Браузер дээр шахсан постер (заавал биш). Буруу бол алдаа, байхгүй бол null.
function posterFields(body) {
  if (!body.poster) return { poster: body.remove_poster ? { poster: null, poster_thumb: null, poster_v: null } : null };
  const poster = gallery.parseJpeg(body.poster, gallery.MAX_PHOTO);
  const thumb = gallery.parseJpeg(body.poster_thumb, gallery.MAX_THUMB);
  if (!poster || !thumb) return { error: 'Постер зураг буруу эсвэл хэт том байна.' };
  return { poster: { poster, poster_thumb: thumb, poster_v: Math.floor(Date.now() / 1000) % 2000000000 } };
}
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const blank = () => tk.formValues({
  title: '', summary: '', body: '', venue: '', event_at: null, sale_start: null, sale_end: null, seating: 'none', price: 0,
  capacity: null, max_per_order: 10, hold_hours: 24, layout: null, bank_name: '', bank_account: '', bank_holder: '', contact: '', status: 'draft',
});

async function lockedKeys(eventId) {
  const [rows] = await pool.query('SELECT seat_key FROM ticket_seat_locks WHERE event_id = ?', [eventId]);
  return rows.map((r) => r.seat_key);
}

function renderForm(res, item, errors = [], locked = []) {
  res.status(errors.length ? 400 : 200).render('admin/ticket-form', {
    title: item.id ? 'Арга хэмжээ засах' : 'Шинэ арга хэмжээ', item, errors, tk,
    editorJson: safeJson({ layout: JSON.parse(item.layout || '{}'), price: Number(item.price) || 0, locked }),
  });
}

router.get('/', wrap(async (req, res) => {
  res.render('admin/tickets', { title: 'Тасалбар — Удирдлага', events: await tk.list({ includeDrafts: true }), tk });
}));

router.get('/new', manage, (req, res) => renderForm(res, blank()));

router.post('/', manage, wrap(async (req, res) => {
  const { errors, fields } = tk.eventFields(req.body);
  const p = posterFields(req.body);
  if (p.error) errors.push(p.error);
  if (errors.length) return renderForm(res, tk.formValues({ ...fields, layout: req.body.layout }), errors);
  const [r] = await pool.query('INSERT INTO ticket_events SET ?', [{ ...fields, ...(p.poster || {}), created_by: req.user.id }]);
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
  const hasOrders = item.paid_qty + item.pending_qty > 0;
  const { errors, fields } = tk.eventFields(req.body, { lockedKeys: locked, hasOrders, current: item });
  const p = posterFields(req.body);
  if (p.error) errors.push(p.error);
  if (errors.length) return renderForm(res, tk.formValues({ ...fields, id: item.id, poster_v: item.poster_v, layout: req.body.layout || item.layout }), errors, locked);
  await pool.query('UPDATE ticket_events SET ? WHERE id = ?', [{ ...fields, ...(p.poster || {}) }, item.id]);
  flash(req, 'success', 'Хадгалагдлаа.');
  res.redirect(`/admin/tickets/${item.id}`);
}));

router.post('/:id(\\d+)/delete', manage, wrap(async (req, res) => {
  await pool.query('DELETE FROM ticket_events WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Арга хэмжээ бүх захиалгатайгаа устгагдлаа.');
  res.redirect('/admin/tickets');
}));

async function renderManage(res, event, tab, errors = [], form = {}) {
  const all = await tk.orders(event.id);
  const states = event.seating === 'seated' ? await tk.seatStates(event.id, null) : {};
  res.status(errors.length ? 400 : 200).render('admin/ticket', {
    title: `${event.title} — Тасалбар`, event, tk, errors, form, tab,
    pending: all.filter((o) => o.status === 'pending'),
    paid: all.filter((o) => o.status === 'paid'),
    cancelled: all.filter((o) => o.status === 'cancelled'),
    mapJson: event.seating === 'seated' ? safeJson({ layout: event.layoutObj, price: event.price, states, max: 100 }) : null,
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
  const name = clean(req.body.buyer_name, 150);
  if (!name) return renderManage(res, event, 'sell', ['Худалдан авагчийн нэрийг бичнэ үү.'], req.body);
  try {
    const r = await tk.placeOrder(event.id, {
      admin: true,
      paid: req.body.paid === '1',
      reviewerId: req.user.id,
      buyerName: name,
      buyerPhone: req.body.buyer_phone,
      note: req.body.note,
      quantity: Number(req.body.quantity),
      seatKeys: String(req.body.seats || '').split(',').filter(Boolean).slice(0, 200),
    });
    flash(req, 'success', `Тасалбар бүртгэгдлээ (код ${r.code}).`);
    res.redirect(`/admin/tickets/${event.id}/sell`);
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

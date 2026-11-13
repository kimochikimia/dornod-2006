// Тасалбар: нийтийн жагсаалт, арга хэмжээний хуудас (суудал сонгох), захиалга, төлбөрийн заавар.
const express = require('express');
const { pool } = require('../db');
const { flash, wrap, requireLogin, requireMember, can } = require('../middleware');
const { fullName } = require('../helpers');
const tk = require('../tickets');

const router = express.Router();
// Тасалбарын удирдлагын аль нэг эрхтэй (ноорог харах, бусдын захиалга харах)
const staff = (user) => can(user, 'manage_tickets') || can(user, 'sell_tickets') || can(user, 'confirm_tickets');

// <script type="application/json"> дотор аюулгүй байрлуулах JSON
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

router.get('/', wrap(async (req, res) => {
  const events = await tk.list();
  res.render('tickets/list', { title: 'Тасалбар', events, tk });
}));

router.get('/mine', requireLogin, wrap(async (req, res) => {
  res.render('tickets/mine', { title: 'Миний тасалбар', orders: await tk.allUserOrders(req.user.id), tk });
}));

async function renderEvent(req, res, event, errors = [], form = {}) {
  const userId = req.user ? req.user.id : null;
  if (event.status === 'draft' && !staff(req.user)) return false;
  const states = event.seating === 'seated' ? await tk.seatStates(event.id, userId) : {};
  const mine = userId ? await tk.userOrders(event.id, userId) : [];
  res.status(errors.length ? 400 : 200).render('tickets/show', {
    title: event.title, event, mine, tk, errors, form,
    mapJson: event.seating === 'seated' ? safeJson({ layout: event.layoutObj, price: event.price, states, max: event.max_per_order, bg: event.planBgUrl }) : null,
  });
  return true;
}

router.get('/:id(\\d+)', wrap(async (req, res, next) => {
  const event = await tk.get(req.params.id);
  if (!event || !(await renderEvent(req, res, event))) return next();
}));

// Постер: ?s=t бол жижиг хувилбар
router.get('/:id(\\d+)/poster', wrap(async (req, res, next) => {
  const col = req.query.s === 't' ? 'poster_thumb' : 'poster';
  const [[e]] = await pool.query(`SELECT ${col} AS img, status FROM ticket_events WHERE id = ?`, [req.params.id]);
  if (!e || !e.img || (e.status === 'draft' && !staff(req.user))) return next();
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(e.img);
}));

// Суудлын планы арын зураг
router.get('/:id(\\d+)/plan-bg', wrap(async (req, res, next) => {
  const [[e]] = await pool.query('SELECT plan_bg AS img, status FROM ticket_events WHERE id = ?', [req.params.id]);
  if (!e || !e.img || (e.status === 'draft' && !staff(req.user))) return next();
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(e.img);
}));

router.post('/:id(\\d+)/buy', requireMember, wrap(async (req, res, next) => {
  const event = await tk.get(req.params.id);
  if (!event || event.status === 'draft') return next();
  try {
    const r = await tk.placeOrder(event.id, {
      userId: req.user.id,
      buyerName: fullName(req.user),
      buyerPhone: req.body.buyer_phone || req.user.phone,
      note: req.body.note,
      quantity: Number(req.body.quantity),
      seatKeys: String(req.body.seats || '').split(',').filter(Boolean).slice(0, 200),
    });
    flash(req, 'success', r.status === 'paid' ? 'Тасалбар амжилттай бүртгэгдлээ!' : 'Захиалга үүслээ. Доорх данс руу төлбөрөө шилжүүлнэ үү.');
    res.redirect(`/tickets/order/${r.code}`);
  } catch (err) {
    if (!(err instanceof tk.OrderError)) throw err;
    await renderEvent(req, res, await tk.get(event.id), [err.message], req.body);
  }
}));

// Захиалгын хуудас: төлбөрийн заавар эсвэл тасалбар. Зөвхөн захиалагч болон удирдлага үзнэ.
async function ownOrder(req) {
  const order = await tk.getOrder(req.params.code);
  if (!order) return null;
  if (order.user_id !== req.user.id && !staff(req.user)) return null;
  return order;
}

router.get('/order/:code([A-Za-z0-9]{4,12})', requireLogin, wrap(async (req, res, next) => {
  const order = await ownOrder(req);
  if (!order) return next();
  const event = await tk.get(order.event_id);
  res.render('tickets/order', { title: `Захиалга ${order.code}`, order, event, tk });
}));

router.post('/order/:code([A-Za-z0-9]{4,12})/cancel', requireLogin, wrap(async (req, res, next) => {
  const order = await ownOrder(req);
  if (!order || order.user_id !== req.user.id) return next();
  if (order.status === 'pending') {
    await tk.setOrderStatus(order.id, 'cancelled', { reason: 'user' });
    flash(req, 'success', 'Захиалга цуцлагдлаа.');
  }
  res.redirect(`/tickets/${order.event_id}`);
}));

module.exports = router;

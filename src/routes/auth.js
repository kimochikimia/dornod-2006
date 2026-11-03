const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { flash, wrap } = require('../middleware');
const { clean, parsePhoto, normalizeFacebook, employmentKey } = require('../helpers');
const { savePhoto } = require('../photos');
const { parseCity } = require('../locations');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).render('error', { title: 'Хэт олон оролдлого', message: '15 минутын дараа дахин оролдоно уу.' }),
});

function safeNext(n) {
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

function normalizePhone(p) {
  return String(p || '').replace(/[\s-]/g, '');
}

function startSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      resolve();
    });
  });
}

router.get('/register', wrap(async (req, res) => {
  if (req.user) return res.redirect('/me');
  const [schools] = await pool.query('SELECT * FROM schools ORDER BY sort_order, name');
  res.render('auth/register', { title: 'Бүртгүүлэх', schools, form: {}, errors: [] });
}));

router.post('/register', authLimiter, wrap(async (req, res) => {
  const form = {
    surname: clean(req.body.surname, 80),
    name: clean(req.body.name, 80),
    phone: normalizePhone(req.body.phone).slice(0, 20),
    email: clean(req.body.email, 120),
    school_id: Number(req.body.school_id) || null,
    class_name: clean(req.body.class_name, 20),
    occupation: clean(req.body.occupation, 150),
    employment: employmentKey(req.body.employment),
    workplace: clean(req.body.workplace, 150),
    city: null,
    facebook: clean(req.body.facebook, 300),
    photo_data: String(req.body.photo_data || ''),
  };
  const password = String(req.body.password || '');
  const errors = [];
  if (!form.surname) errors.push('Овгоо оруулна уу.');
  if (!form.name) errors.push('Нэрээ оруулна уу.');
  if (!/^\+?\d{8,15}$/.test(form.phone)) errors.push('Утасны дугаар буруу байна (8-15 оронтой тоо).');
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.push('И-мэйл хаяг буруу байна.');
  if (!form.school_id) errors.push('Төгссөн сургуулиа сонгоно уу.');
  if (!form.employment) errors.push('Ажил эрхлэлтийн байдлаа сонгоно уу.');
  const place = parseCity(req.body.city_choice, req.body.city_other);
  if (place.error) errors.push(place.error);
  else form.city = place.city;
  const facebook = normalizeFacebook(form.facebook);
  if (facebook === false) errors.push('Facebook линк буруу байна (ж: facebook.com/таны.нэр).');
  const photo = parsePhoto(form.photo_data);
  if (photo && photo.error) { errors.push(photo.error); form.photo_data = ''; }
  if (password.length < 8) errors.push('Нууц үг дор хаяж 8 тэмдэгт байх ёстой.');
  if (password !== req.body.password2) errors.push('Нууц үг хоорондоо таарахгүй байна.');

  if (!errors.length) {
    const [exists] = await pool.query('SELECT id FROM users WHERE phone = ?', [form.phone]);
    if (exists.length) errors.push('Энэ утасны дугаараар бүртгэл үүссэн байна. Нэвтэрнэ үү.');
  }
  if (errors.length) {
    const [schools] = await pool.query('SELECT * FROM schools ORDER BY sort_order, name');
    return res.status(400).render('auth/register', { title: 'Бүртгүүлэх', schools, form, errors });
  }

  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    `INSERT INTO users (surname, name, phone, email, password_hash, school_id, class_name, occupation, employment, workplace, city, facebook)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [form.surname, form.name, form.phone, form.email || null, hash, form.school_id, form.class_name || null,
      form.occupation || null, form.employment, form.workplace || null, form.city || null, facebook || null]
  );
  if (photo) await savePhoto(result.insertId, photo);
  await startSession(req, result.insertId);
  flash(req, 'success', 'Бүртгэл амжилттай үүслээ! Админ таныг 2006 оны төгсөгч мөн эсэхийг шалгаж баталгаажуулна.');
  res.redirect('/me');
}));

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { title: 'Нэвтрэх', next: safeNext(req.query.next), phone: '', error: null });
});

router.post('/login', authLimiter, wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);
  const [rows] = await pool.query('SELECT id, password_hash, status FROM users WHERE phone = ?', [phone]);
  const user = rows[0];
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) {
    return res.status(401).render('auth/login', { title: 'Нэвтрэх', next, phone, error: 'Утасны дугаар эсвэл нууц үг буруу байна.' });
  }
  if (user.status === 'rejected') {
    return res.status(403).render('auth/login', { title: 'Нэвтрэх', next, phone, error: 'Таны бүртгэлийг админ баталгаажуулаагүй байна. Админтай холбогдоно уу.' });
  }
  await startSession(req, user.id);
  res.redirect(next);
}));

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('d2006.sid');
    res.redirect('/');
  });
});

module.exports = router;

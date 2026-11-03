const crypto = require('crypto');
const { pool } = require('./db');
const helpers = require('./helpers');

function flash(req, type, message) {
  if (!req.session.flash) req.session.flash = [];
  req.session.flash.push({ type, message });
}

async function loadUser(req, res, next) {
  req.user = null;
  if (req.session && req.session.userId) {
    try {
      const [rows] = await pool.query(
        `SELECT u.*, s.name AS school_name FROM users u
         LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = ?`,
        [req.session.userId]
      );
      if (rows[0] && rows[0].status !== 'rejected') req.user = rows[0];
      else delete req.session.userId;
    } catch (err) {
      return next(err);
    }
  }
  next();
}

function locals(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.me = req.user;
  res.locals.isAdmin = !!(req.user && req.user.role === 'admin');
  res.locals.isMember = !!(req.user && req.user.status === 'approved');
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  res.locals.path = req.path;
  res.locals.h = helpers;
  next();
}

function csrfCheck(req, res, next) {
  if (req.method !== 'POST') return next();
  const sent = Buffer.from(String((req.body && req.body._csrf) || ''));
  const expected = Buffer.from(String(req.session.csrf || ''));
  if (sent.length === expected.length && sent.length > 0 && crypto.timingSafeEqual(sent, expected)) return next();
  res.status(403).render('error', { title: 'Хандалт хориглогдлоо', message: 'Хуудасны хугацаа дууссан байна. Хуудсаа дахин ачаалаад оролдоно уу.' });
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  flash(req, 'info', 'Энэ хуудсыг үзэхийн тулд нэвтэрнэ үү.');
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireMember(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (req.user.status === 'approved') return next();
  flash(req, 'warn', 'Таны бүртгэлийг админ баталгаажуулсны дараа энэ үйлдлийг хийх боломжтой.');
  res.redirect('/me');
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).render('error', { title: 'Хандалт хориглогдлоо', message: 'Энэ хэсэг зөвхөн админд нээлттэй.' });
}

// async route handler-ийн алдааг next() руу дамжуулна.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { flash, loadUser, locals, csrfCheck, requireLogin, requireMember, requireAdmin, wrap };

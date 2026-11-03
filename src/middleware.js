const crypto = require('crypto');
const { pool } = require('./db');
const helpers = require('./helpers');
const perms = require('./permissions');

function flash(req, type, message) {
  if (!req.session.flash) req.session.flash = [];
  req.session.flash.push({ type, message });
}

function can(user, permission) {
  return !!(user && user.perms && user.perms.has(permission));
}

// Хэн хэний бүртгэлд хүрч болох вэ: өөрөө, эсвэл өөрөөсөө доод төлөвтэй хүн.
// 'Эрх тохируулах' эрхтэй бол бүгдэд хүрнэ.
function canTouch(actor, target) {
  if (!actor || !target) return false;
  if (target.id === actor.id || can(actor, 'manage_roles')) return true;
  return (perms.ROLE_RANK[target.role] ?? 0) < (perms.ROLE_RANK[actor.role] ?? 0);
}

function canManage(user) {
  return perms.MANAGE_PERMS.some((p) => can(user, p));
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
      if (rows[0] && rows[0].status !== 'rejected') {
        req.user = rows[0];
        req.user.perms = perms.permsFor(req.user);
      } else {
        delete req.session.userId;
      }
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
  res.locals.can = (p) => can(req.user, p);
  res.locals.canManage = canManage(req.user);
  res.locals.canTouch = (target) => canTouch(req.user, target);
  res.locals.isApproved = !!(req.user && req.user.status === 'approved');
  res.locals.ROLE_LABELS = perms.ROLE_LABELS;
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

function forbidden(res) {
  res.status(403).render('error', { title: 'Хандалт хориглогдлоо', message: 'Танд энэ үйлдлийг хийх эрх олгогдоогүй байна.' });
}

// Жагсаасан эрхүүдийн аль нэг нь байвал нэвтрүүлнэ.
function requirePerm(...keys) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (keys.some((k) => can(req.user, k))) return next();
    if (req.user.status !== 'approved') return requireMember(req, res, next);
    forbidden(res);
  };
}

function requireManage(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (canManage(req.user)) return next();
  forbidden(res);
}

// async route handler-ийн алдааг next() руу дамжуулна.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = {
  flash, can, canManage, canTouch, loadUser, locals, csrfCheck, requireLogin, requireMember, requirePerm, requireManage, forbidden, wrap,
};

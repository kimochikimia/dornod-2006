// И-мэйл хаяг баталгаажуулах холбоос. Токеныг зөвхөн хэш хэлбэрээр хадгална.
const crypto = require('crypto');
const { pool } = require('./db');
const mailer = require('./mailer');
const queue = require('./mailQueue');
const layout = require('./mailLayout');

const TTL_MS = 24 * 60 * 60 * 1000;
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const validFormat = (token) => /^[A-Za-z0-9_-]{43}$/.test(String(token || ''));

// Продакшнд холбоосыг Host толгойгоос бүтээхгүйн тулд SITE_URL шаардана.
function available() {
  return mailer.isConfigured() && (process.env.NODE_ENV !== 'production' || !!(process.env.SITE_URL || '').trim());
}

function message(link) {
  const c = {
    title: 'И-мэйл хаягаа баталгаажуулна уу', link, linkText: 'Баталгаажуулах',
    intro: 'Баталгаажуулсны дараа тасалбар, төлбөрийн мэдээлэл энэ хаягаар ирнэ. Холбоос 24 цаг хүчинтэй.\n\nХэрэв та хүсэлт гаргаагүй бол энэ имэйлийг үл тоомсорлоно уу.',
  };
  return { subject: 'И-мэйл хаягаа баталгаажуулна уу', html: layout.html(c), text: layout.text(c) };
}

// Буцаах утга: 'sent' | 'verified' | 'none' | 'unavailable' | 'failed'
async function sendLink(userId, origin) {
  if (!available()) return 'unavailable';
  const [[user]] = await pool.query('SELECT email, email_verified_at FROM users WHERE id = ?', [userId]);
  if (!user || !user.email) return 'none';
  if (user.email_verified_at) return 'verified';
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('UPDATE users SET email_token_hash = ?, email_token_expires = ? WHERE id = ?', [hash(token), new Date(Date.now() + TTL_MS), userId]);
  try {
    await queue.enqueue([{ userId, to: user.email, kind: 'verify_email', priority: 0, ...message(`${origin}/verify-email/${token}`) }]);
    return 'sent';
  } catch (err) {
    console.error(`[mail] баталгаажуулах холбоос (хэрэглэгч ${userId}): ${err.message}`);
    return 'failed';
  }
}

async function isValid(token) {
  if (!validFormat(token)) return false;
  const [[row]] = await pool.query(
    'SELECT id FROM users WHERE email_token_hash = ? AND email_token_expires > NOW() AND email IS NOT NULL', [hash(token)]
  );
  return !!row;
}

async function confirm(token) {
  if (!validFormat(token)) return false;
  const [r] = await pool.query(
    `UPDATE users SET email_verified_at = NOW(), email_token_hash = NULL, email_token_expires = NULL
     WHERE email_token_hash = ? AND email_token_expires > NOW() AND email IS NOT NULL`, [hash(token)]
  );
  return r.affectedRows > 0;
}

module.exports = { available, sendLink, isValid, confirm };

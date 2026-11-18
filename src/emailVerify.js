// И-мэйл хаяг баталгаажуулах холбоос. Токеныг зөвхөн хэш хэлбэрээр хадгална.
const crypto = require('crypto');
const { pool } = require('./db');
const mailer = require('./mailer');

const TTL_MS = 24 * 60 * 60 * 1000;
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const validFormat = (token) => /^[A-Za-z0-9_-]{43}$/.test(String(token || ''));

// Продакшнд холбоосыг Host толгойгоос бүтээхгүйн тулд SITE_URL шаардана.
function available() {
  return mailer.isConfigured() && (process.env.NODE_ENV !== 'production' || !!(process.env.SITE_URL || '').trim());
}

function message(link) {
  return {
    subject: 'И-мэйл хаягаа баталгаажуулна уу',
    text: `Дорнод 2006 сайтад бүртгэсэн и-мэйл хаягаа баталгаажуулахын тулд 24 цагийн дотор энэ холбоосыг нээнэ үү:\n\n${link}\n\nХэрэв та хүсэлт гаргаагүй бол энэ имэйлийг үл тоомсорлоно уу.`,
    html: `<div style="background:#f2f4f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;padding:26px">
<h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;color:#12305c">И-мэйл хаягаа баталгаажуулна уу</h1>
<p style="margin:0 0 20px;color:#344054">Баталгаажуулсны дараа тасалбар, төлбөрийн мэдээлэл энэ хаягаар ирнэ. Холбоос 24 цаг хүчинтэй.</p>
<p style="margin:0"><a href="${link}" style="display:inline-block;background:#12305c;color:#ffffff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:7px">Баталгаажуулах</a></p>
<p style="margin:20px 0 0;color:#667085;font-size:13px">Хэрэв та хүсэлт гаргаагүй бол энэ имэйлийг үл тоомсорлоно уу.</p>
</div></div>`,
  };
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
    await mailer.send({ to: user.email, ...message(`${origin}/verify-email/${token}`) });
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

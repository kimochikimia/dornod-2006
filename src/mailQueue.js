// Имэйлийн дараалал: бүх имэйл энд орж, Gmail-ийн өдрийн хязгаарт багтаан ардаа илгээгдэнэ.
// priority 0 — хувь хүнд (баталгаажуулалт, тасалбар, бүртгэл); 1 — олон нийтэд (мэдээ, арга хэмжээ).
// Олон нийтийн имэйл өдрийн хязгаарын сүүлийн хэсгийг хувь хүний имэйлд үлдээнэ.
const { pool } = require('./db');
const mailer = require('./mailer');

const PER_TICK = 10;
const BACKOFF_MIN = [1, 5, 30, 120];
const MAX_ATTEMPTS = 5;

const dailyLimit = () => Math.max(1, parseInt(process.env.MAIL_DAILY_LIMIT, 10) || 450);
const reserve = () => Math.min(100, Math.floor(dailyLimit() * 0.2));

let running = false;
let again = false;
let pausedUntil = 0;
let lastPrune = 0;
let timer = null;
const hooks = [];

function kick() {
  setImmediate(() => tick().catch((err) => console.error('[mail] дараалал:', err.message)));
}

// rows: [{ userId, to, kind, priority, subject, html, text, attachments: [{ filename, content: Buffer, contentType, cid }] }]
async function enqueue(rows) {
  const list = rows.filter((r) => r && r.to);
  if (!list.length) return 0;
  const values = list.map((r) => [
    r.userId || null, String(r.to).slice(0, 120), String(r.kind || 'other').slice(0, 40), r.priority ? 1 : 0,
    String(r.subject || '').slice(0, 250), r.html || null, r.text || null,
    r.attachments && r.attachments.length
      ? JSON.stringify(r.attachments.map((a) => ({ ...a, content: Buffer.from(a.content).toString('base64') }))) : null,
  ]);
  for (let i = 0; i < values.length; i += 200) {
    await pool.query('INSERT INTO mail_queue (user_id, to_email, kind, priority, subject, html, text, attachments) VALUES ?', [values.slice(i, i + 200)]);
  }
  kick();
  return list.length;
}

async function sendOne(id) {
  const [claim] = await pool.query("UPDATE mail_queue SET status = 'sending', claimed_at = NOW() WHERE id = ? AND status = 'pending'", [id]);
  if (!claim.affectedRows) return 'skipped';
  const [[m]] = await pool.query('SELECT * FROM mail_queue WHERE id = ?', [id]);
  try {
    const attachments = m.attachments ? JSON.parse(m.attachments).map((a) => ({ ...a, content: Buffer.from(a.content, 'base64') })) : undefined;
    await mailer.send({ to: m.to_email, subject: m.subject, html: m.html, text: m.text, attachments });
    // Илгээсний дараа агуулгыг хадгалахгүй (хувийн мэдээлэл, хэмжээ)
    await pool.query("UPDATE mail_queue SET status = 'sent', sent_at = NOW(), html = NULL, text = NULL, attachments = NULL, last_error = NULL WHERE id = ?", [id]);
    return 'sent';
  } catch (err) {
    const msg = String(err.message || err).slice(0, 250);
    if (/HTTP 429/.test(msg)) {
      // Gmail-ийн хязгаар: оролдлогыг тоолохгүй, нэг цаг түр зогсоно
      pausedUntil = Date.now() + 3600e3;
      await pool.query("UPDATE mail_queue SET status = 'pending', last_error = ? WHERE id = ?", [msg, id]);
      return 'paused';
    }
    const attempts = m.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await pool.query("UPDATE mail_queue SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", [attempts, msg, id]);
    } else {
      await pool.query(
        "UPDATE mail_queue SET status = 'pending', attempts = ?, last_error = ?, next_attempt_at = NOW() + INTERVAL ? MINUTE WHERE id = ?",
        [attempts, msg, BACKOFF_MIN[attempts - 1], id]
      );
    }
    console.error(`[mail] имэйл ${id} (${m.kind}): ${msg}`);
    return 'failed';
  }
}

async function tick() {
  if (running) { again = true; return; }
  running = true;
  try {
    for (const hook of hooks) await hook().catch((err) => console.error('[mail] мэдэгдэл:', err.message));
    if (!mailer.isConfigured() || Date.now() < pausedUntil) return;
    if (Date.now() - lastPrune > 3600e3) {
      lastPrune = Date.now();
      await pool.query("DELETE FROM mail_queue WHERE status IN ('sent','failed') AND created_at < NOW() - INTERVAL 30 DAY");
    }
    // Сервер унтарсан үед "илгээж буй" хэвээр үлдсэнийг буцаана
    await pool.query("UPDATE mail_queue SET status = 'pending' WHERE status = 'sending' AND claimed_at < NOW() - INTERVAL 10 MINUTE");
    for (let round = 0; round < 50; round++) {
      const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM mail_queue WHERE status = 'sent' AND sent_at > NOW() - INTERVAL 1 DAY");
      const budget = dailyLimit() - Number(n);
      if (budget <= 0) return;
      const bulkOk = Number(n) < dailyLimit() - reserve();
      const [rows] = await pool.query(
        `SELECT id FROM mail_queue WHERE status = 'pending' AND next_attempt_at <= NOW() AND (priority = 0 OR ?)
         ORDER BY priority, id LIMIT ?`, [bulkOk, Math.min(PER_TICK, budget)]
      );
      if (!rows.length) return;
      for (const r of rows) {
        if ((await sendOne(r.id)) === 'paused') return;
      }
    }
  } finally {
    running = false;
    if (again) { again = false; kick(); }
  }
}

// Дараалал ажиллах бүрт дуудагдах шалгалт (жишээ нь сонгуулийн шат солигдсон эсэх)
function onTick(fn) { hooks.push(fn); }

function start() {
  if (timer) return;
  const every = Math.max(1000, parseInt(process.env.MAIL_TICK_MS, 10) || 15000);
  timer = setInterval(() => tick().catch((err) => console.error('[mail] дараалал:', err.message)), every);
  timer.unref();
  kick();
}

module.exports = { enqueue, tick, start, onTick };

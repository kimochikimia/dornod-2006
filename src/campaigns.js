// Сайн үйлсийн аян хөтөлбөр: аян, түүнд үзүүлсэн дэмжлэг (мөнгө эсвэл бусад зүйл).
// Төгсөгч дэмжлэгээ мэдэгдэхэд "хянагдаж буй" төлөвтэй орж, удирдлага баталгаажуулсны дараа нийтэд харагдаж дүнд нэмэгдэнэ.
const { pool } = require('./db');
const { clean } = require('./helpers');

const KIND_LABELS = { money: 'Мөнгөн хандив', item: 'Бусад зүйл' };
const STATUS_LABELS = { pending: 'Хянагдаж буй', confirmed: 'Баталгаажсан', rejected: 'Татгалзсан' };
const MAX_AMOUNT = 10_000_000_000; // 10 тэрбум ₮

// 1500000 → "1,500,000₮"
function fmtMoney(n) {
  return `${Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}₮`;
}

// "1 500 000", "1,500,000₮" → 1500000. Буруу бол null.
function parseAmount(v) {
  const digits = String(v ?? '').replace(/[\s,.'₮]/g, '');
  if (!/^\d{1,12}$/.test(digits)) return null;
  const n = Number(digits);
  return n > 0 && n <= MAX_AMOUNT ? n : null;
}

// Баталгаажсан дэмжлэгийн нийлбэр, хандивлагчдын тоо
const TOTALS = `
  (SELECT COALESCE(SUM(c.amount), 0) FROM campaign_contributions c WHERE c.campaign_id = k.id AND c.status = 'confirmed' AND c.kind = 'money') AS raised,
  (SELECT COUNT(*) FROM campaign_contributions c WHERE c.campaign_id = k.id AND c.status = 'confirmed') AS supporters,
  (SELECT COUNT(*) FROM campaign_contributions c WHERE c.campaign_id = k.id AND c.status = 'pending') AS pending`;
const COLS = `k.id, k.title, k.summary, k.body, k.goal_amount, k.needs, k.bank_info, k.contact, k.status, k.cover_v, k.created_at,
  DATE_FORMAT(k.start_date, '%Y.%m.%d') AS start_text, DATE_FORMAT(k.end_date, '%Y.%m.%d') AS end_text,
  DATE_FORMAT(k.start_date, '%Y-%m-%d') AS start_input, DATE_FORMAT(k.end_date, '%Y-%m-%d') AS end_input`;

function decorate(k) {
  k.raised = Number(k.raised || 0);
  k.supporters = Number(k.supporters || 0);
  k.pending = Number(k.pending || 0);
  k.goal_amount = k.goal_amount == null ? null : Number(k.goal_amount);
  k.percent = k.goal_amount ? Math.min(100, Math.round((k.raised / k.goal_amount) * 100)) : null;
  k.dates = k.start_text && k.end_text ? `${k.start_text} – ${k.end_text}` : k.end_text ? `${k.end_text} хүртэл` : k.start_text ? `${k.start_text}-с` : '';
  return k;
}

// Идэвхтэй нь эхэндээ, дараа нь шинэ нь
async function list() {
  const [rows] = await pool.query(
    `SELECT ${COLS}, ${TOTALS} FROM campaigns k ORDER BY k.status = 'closed', COALESCE(k.start_date, DATE(k.created_at)) DESC, k.id DESC`
  );
  return rows.map(decorate);
}

async function get(id) {
  const [[k]] = await pool.query(`SELECT ${COLS}, ${TOTALS} FROM campaigns k WHERE k.id = ?`, [id]);
  return k ? decorate(k) : null;
}

// statuses: ['confirmed'] гэх мэт
async function contributions(campaignId, statuses) {
  const [rows] = await pool.query(
    `SELECT c.*, u.surname, u.name, u.photo_v, r.surname AS r_surname, r.name AS r_name
     FROM campaign_contributions c
     LEFT JOIN users u ON u.id = c.user_id
     LEFT JOIN users r ON r.id = c.reviewed_by
     WHERE c.campaign_id = ? AND c.status IN (?)
     ORDER BY c.created_at DESC, c.id DESC`,
    [campaignId, statuses]
  );
  return rows.map((c) => ({ ...c, amount: c.amount == null ? null : Number(c.amount), display: displayName(c) }));
}

async function mine(campaignId, userId) {
  const [rows] = await pool.query(
    'SELECT * FROM campaign_contributions WHERE campaign_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC',
    [campaignId, userId]
  );
  return rows.map((c) => ({ ...c, amount: c.amount == null ? null : Number(c.amount) }));
}

// Хандивлагчийн нэр: төгсөгч бол бүртгэлийн нэр, удирдлага гараар оруулсан бол donor_name
function displayName(c) {
  if (c.user_id && (c.surname || c.name)) return `${c.surname || ''} ${c.name || ''}`.trim();
  return c.donor_name || 'Нэргүй';
}

// Дэмжлэгийн маягт → { errors, fields }
function contributionFields(body) {
  const errors = [];
  const kind = body.kind === 'item' ? 'item' : 'money';
  const fields = {
    kind,
    amount: null,
    item_desc: null,
    note: clean(body.note, 500) || null,
    anonymous: body.anonymous ? 1 : 0,
  };
  if (kind === 'money') {
    fields.amount = parseAmount(body.amount);
    if (!fields.amount) errors.push('Хандивын дүнг зөв оруулна уу (жишээ нь 50000).');
  } else {
    fields.item_desc = clean(body.item_desc, 300) || null;
    if (!fields.item_desc) errors.push('Ямар зүйлээр дэмжиж байгаагаа бичнэ үү.');
    // бусад зүйлийн ойролцоо үнэлгээ заавал биш
    if (clean(body.amount, 20)) fields.amount = parseAmount(body.amount);
  }
  return { errors, fields };
}

module.exports = {
  KIND_LABELS, STATUS_LABELS, fmtMoney, parseAmount, list, get, contributions, mine, contributionFields, displayName,
};

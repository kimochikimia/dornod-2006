// Хэрэглэгчдэд очих мэдэгдлүүд.
// toUser — тухайн хүнд (баталгаажсан и-мэйлтэй бол). toAll — баталгаажсан, мэдэгдэл авахаа цуцлаагүй бүх гишүүнд.
// Хоёулаа алдаа шидэхгүй: мэдэгдэл бүтэлгүйтсэн ч үндсэн үйлдэл хэвээр үлдэнэ.
const crypto = require('crypto');
const { pool } = require('./db');
const { fmtDate } = require('./helpers');
const layout = require('./mailLayout');
const queue = require('./mailQueue');

const ORG_CONTACT = 'dornod2006@gmail.com';

// Имэйл дэх холбоосын суурь хаяг. Хүсэлтгүй (хуваарьт) үед зөвхөн SITE_URL.
function siteOrigin(req) {
  const fixed = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  return req ? `${req.protocol}://${req.get('host')}` : null;
}

const secret = () => process.env.SESSION_SECRET || 'dev-only-secret';
const unsubSig = (userId) => crypto.createHmac('sha256', secret()).update(`unsubscribe:${userId}`).digest('base64url').slice(0, 32);
function checkUnsub(userId, sig) {
  const a = Buffer.from(String(sig || ''));
  const b = Buffer.from(unsubSig(userId));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// msg: { kind, subject, title, intro, rows, link (зам, жишээ нь /me), linkText }
async function personal(userId, msg, req) {
  const origin = siteOrigin(req);
  if (!origin || !userId) return;
  const [[u]] = await pool.query('SELECT email, email_verified_at FROM users WHERE id = ?', [userId]);
  if (!u || !u.email || !u.email_verified_at) return;
  const c = { ...msg, link: msg.link ? origin + msg.link : null };
  await queue.enqueue([{ userId, to: u.email, kind: msg.kind, priority: 0, subject: msg.subject, html: layout.html(c), text: layout.text(c) }]);
}

async function broadcast(msg, { req, exclude } = {}) {
  const origin = siteOrigin(req);
  if (!origin) {
    console.warn(`[mail] SITE_URL тохируулаагүй тул "${msg.kind}" мэдэгдэл илгээсэнгүй.`);
    return;
  }
  const [users] = await pool.query(
    `SELECT id, email FROM users WHERE status = 'approved' AND email IS NOT NULL AND email_verified_at IS NOT NULL
       AND notify_news = 1 AND id <> ?`, [exclude || 0]
  );
  const c = { ...msg, link: msg.link ? origin + msg.link : null };
  await queue.enqueue(users.map((u) => {
    const unsub = `${origin}/unsubscribe/${u.id}/${unsubSig(u.id)}`;
    return {
      userId: u.id, to: u.email, kind: msg.kind, priority: 1, subject: msg.subject,
      html: layout.html({ ...c, footerHtml: `Ийм мэдэгдэл авахгүй бол <a href="${layout.esc(unsub)}" style="color:#98a2b3">энд дарж цуцлана уу</a>.` }),
      text: layout.text({ ...c, footerText: `Ийм мэдэгдэл авахгүй бол: ${unsub}` }),
    };
  }));
}

const log = (kind) => (err) => console.error(`[mail] ${kind}: ${err.message}`);
const toUser = (userId, msg, req) => { personal(userId, msg, req).catch(log(msg.kind)); };
const toAll = (msg, opts) => { broadcast(msg, opts).catch(log(msg.kind)); };

// ---------- Хувь хүний мэдэгдэл ----------
const ROLE_TEXT = { member: 'Төгсөгч', moderator: 'Модератор', subadmin: 'Дэд админ', admin: 'Админ' };

function accountStatus(userId, status, req) {
  if (status === 'approved') {
    toUser(userId, {
      kind: 'account_approved', subject: 'Таны бүртгэл баталгаажлаа', title: 'Таны бүртгэл баталгаажлаа',
      intro: 'Админ таны бүртгэлийг баталгаажууллаа. Та одоо төгсөгчдийн жагсаалт үзэх, тасалбар авах, сонгуульд оролцох боломжтой.',
      link: '/me', linkText: 'Миний хуудас',
    }, req);
  } else if (status === 'rejected') {
    toUser(userId, {
      kind: 'account_rejected', subject: 'Бүртгэлийн тухай мэдэгдэл', title: 'Таны бүртгэлийг баталгаажуулаагүй',
      intro: `Админ таны бүртгэлийг баталгаажуулаагүй байна. Асуух зүйл байвал ${ORG_CONTACT} хаягаар холбогдоно уу.`,
    }, req);
  }
}

function roleChanged(userId, role, req) {
  toUser(userId, {
    kind: 'role_changed', subject: 'Таны эрх өөрчлөгдлөө', title: 'Таны эрх өөрчлөгдлөө',
    intro: 'Сайтын админ таны төлвийг өөрчиллөө.', rows: [['Шинэ төлөв', ROLE_TEXT[role] || role, true]],
    link: '/me', linkText: 'Миний хуудас',
  }, req);
}

function passwordReset(userId, req) {
  toUser(userId, {
    kind: 'password_reset', subject: 'Таны нууц үгийг шинэчиллээ', title: 'Таны нууц үгийг шинэчиллээ',
    intro: `Сайтын админ таны нууц үгийг шинэчиллээ. Шинэ нууц үгээ админаас авна уу.\n\nХэрэв та ийм хүсэлт гаргаагүй бол ${ORG_CONTACT} хаягаар яаралтай мэдэгдэнэ үү.`,
    link: '/login', linkText: 'Нэвтрэх',
  }, req);
}

function requestDone(userId, message, note, req) {
  toUser(userId, {
    kind: 'request_done', subject: 'Таны хүсэлт шийдвэрлэгдлээ', title: 'Таны хүсэлт шийдвэрлэгдлээ',
    intro: 'Таны илгээсэн засварын хүсэлтийг админ шийдвэрлэлээ.',
    rows: [['Хүсэлт', layout.excerpt(message, 300)], ...(note ? [['Админы хариу', note, true]] : [])],
    link: '/me', linkText: 'Миний хуудас',
  }, req);
}

function contribution(userId, status, info, req) {
  const done = status === 'confirmed';
  toUser(userId, {
    kind: `contribution_${status}`,
    subject: done ? `Таны дэмжлэг баталгаажлаа: ${info.title}` : `Дэмжлэгийн тухай мэдэгдэл: ${info.title}`,
    title: done ? 'Таны дэмжлэг баталгаажлаа' : 'Таны дэмжлэгийг баталгаажуулаагүй',
    intro: done ? 'Таны үзүүлсэн дэмжлэгийг удирдлага баталгаажууллаа. Танд баярлалаа!' : `Таны мэдэгдсэн дэмжлэгийг удирдлага баталгаажуулаагүй. Асуух зүйл байвал ${ORG_CONTACT} хаягаар холбогдоно уу.`,
    rows: [['Аян', info.title, true], ['Дэмжлэг', info.what]],
    link: `/campaigns/${info.campaignId}`, linkText: 'Аяныг харах',
  }, req);
}

function nominated(userId, election, req) {
  toUser(userId, {
    kind: 'nominated', subject: `Таныг нэр дэвшүүллээ: ${election.title}`, title: 'Таныг нэр дэвшүүллээ',
    intro: `Таныг «${election.title}» сонгуульд нэр дэвшүүллээ. Сайтад нэвтэрч нэр дэвшихээ зөвшөөрөх эсвэл татгалзана уу.`,
    link: `/elections/${election.id}`, linkText: 'Сонгууль руу орох',
  }, req);
}

// ---------- Олон нийтийн мэдэгдэл ----------
function newsPublished(item, req) {
  toAll({
    kind: 'news', subject: `Шинэ мэдээ: ${item.title}`, title: item.title,
    intro: layout.excerpt(item.body, 500), link: `/news/${item.id}`, linkText: 'Мэдээг бүтнээр унших',
  }, { req, exclude: req && req.user && req.user.id });
}

function planAdded(f, req) {
  const when = f.end_date && f.end_date !== f.start_date ? `${f.start_date} – ${f.end_date}` : f.start_date;
  toAll({
    kind: 'plan', subject: `Төлөвлөгөөнд нэмэгдлээ: ${f.title}`, title: `Төлөвлөгөөнд шинэ ${f.kind === 'milestone' ? 'үйл явдал' : 'ажил'} нэмэгдлээ`,
    intro: f.description ? layout.excerpt(f.description, 400) : '',
    rows: [['Нэр', f.title, true], ['Огноо', when], ...(f.responsible ? [['Хариуцагч', f.responsible]] : []), ...(f.location ? [['Байршил', f.location]] : [])],
    link: '/plan', linkText: 'Төлөвлөгөөг харах',
  }, { req, exclude: req && req.user && req.user.id });
}

function campaignStarted(c, req) {
  toAll({
    kind: 'campaign', subject: `Шинэ аян: ${c.title}`, title: `Шинэ аян: ${c.title}`,
    intro: c.summary || layout.excerpt(c.body, 400),
    rows: [...(c.dates ? [['Хугацаа', c.dates]] : []), ...(c.goal_amount ? [['Зорилтот дүн', c.goalText]] : [])],
    link: `/campaigns/${c.id}`, linkText: 'Аяныг харах', contact: c.contact,
  }, { req, exclude: req && req.user && req.user.id });
}

// Тасалбартай арга хэмжээг нэг л удаа зарлана (нийтлэгдэх үед)
async function ticketEventOpened(eventId, req) {
  const [r] = await pool.query("UPDATE ticket_events SET announced_at = NOW() WHERE id = ? AND status = 'open' AND announced_at IS NULL", [eventId]);
  if (!r.affectedRows) return;
  const tk = require('./tickets');
  const e = await tk.get(eventId);
  if (!e) return;
  toAll({
    kind: 'ticket_event', subject: `Тасалбартай арга хэмжээ: ${e.title}`, title: e.title,
    intro: e.summary || 'Шинэ арга хэмжээний тасалбар худалдаалагдаж эхэллээ.',
    rows: [['Хэзээ', e.eventText, true], ...(e.venue ? [['Хаана', e.venue]] : []), ['Үнэ', e.priceText], ['Худалдаа', e.saleText]],
    link: `/tickets/${e.id}`, linkText: 'Тасалбар авах', contact: e.contact,
  }, { req, exclude: req && req.user && req.user.id });
}
const announceTicketEvent = (eventId, req) => { ticketEventOpened(eventId, req).catch(log('ticket_event')); };

// Сонгуулийн шат солигдоход (гараар, хуваарийн дагуу аль ч замаар) нэг удаа зарлана
const PHASE_MSG = {
  nomination: (e) => ({ subject: `Нэр дэвшүүлэх шат эхэллээ: ${e.title}`, title: 'Нэр дэвшүүлэх шат эхэллээ', intro: `«${e.title}» сонгуульд нэр дэвшүүлэх боломжтой боллоо.`, rows: e.nomination_end ? [['Дуусах', fmtDate(e.nomination_end), true]] : [], linkText: 'Нэр дэвшүүлэх' }),
  voting: (e) => ({ subject: `Санал хураалт эхэллээ: ${e.title}`, title: 'Санал хураалт эхэллээ', intro: `«${e.title}» сонгуулийн санал хураалт эхэллээ. Саналаа өгнө үү.`, rows: e.voting_end ? [['Дуусах', fmtDate(e.voting_end), true]] : [], linkText: 'Санал өгөх' }),
  closed: (e) => ({ subject: `Сонгуулийн дүн гарлаа: ${e.title}`, title: 'Сонгуулийн дүн гарлаа', intro: `«${e.title}» сонгуулийн санал хураалт дуусч, дүн гарлаа.`, rows: [], linkText: 'Дүнг харах' }),
};

async function checkElections() {
  const [rows] = await pool.query('SELECT id, title, phase, nomination_end, voting_end FROM elections WHERE notified_phase IS NULL OR notified_phase <> phase');
  for (const e of rows) {
    const [r] = await pool.query('UPDATE elections SET notified_phase = ? WHERE id = ? AND phase = ? AND (notified_phase IS NULL OR notified_phase <> ?)', [e.phase, e.id, e.phase, e.phase]);
    if (!r.affectedRows || !PHASE_MSG[e.phase]) continue;
    await broadcast({ kind: `election_${e.phase}`, link: `/elections/${e.id}`, ...PHASE_MSG[e.phase](e) });
  }
}

function start() {
  queue.onTick(checkElections);
  // Хэн ч сайтад ороогүй үед ч хугацаа дууссан захиалгыг цагт нь цуцалж мэдэгдэнэ
  queue.onTick(() => require('./tickets').expireStale());
  queue.start();
}

module.exports = {
  siteOrigin, unsubSig, checkUnsub, start, checkElections,
  accountStatus, roleChanged, passwordReset, requestDone, contribution, nominated,
  newsPublished, planAdded, campaignStarted, announceTicketEvent,
};

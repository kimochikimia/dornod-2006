const TZ = 'Asia/Ulaanbaatar';

const dateFmt = new Intl.DateTimeFormat('mn-MN', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const dayFmt = new Intl.DateTimeFormat('mn-MN', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function parts(d) {
  const o = {};
  for (const p of dateFmt.formatToParts(d)) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00'; // зарим ICU шөнө дундыг 24 гэж өгдөг
  return o;
}

// 2026.11.03 14:05
function fmtDate(d) {
  if (!d) return '';
  const p = parts(new Date(d));
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
}

function fmtDay(d) {
  if (!d) return '';
  const o = {};
  for (const p of dayFmt.formatToParts(new Date(d))) o[p.type] = p.value;
  return `${o.year}.${o.month}.${o.day}`;
}

// <input type="datetime-local"> утга (Улаанбаатарын цагаар): "2026-11-03T14:05"
function ubInput(d) {
  if (!d) return '';
  const p = parts(new Date(d));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// datetime-local утгыг (Улаанбаатарын цаг, UTC+8) Date болгоно. Буруу бол null.
function fromUbInput(s) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(s || ''))) return null;
  const d = new Date(`${s}:00+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Цагийн бүлэглэлд ашиглах түлхүүр: "11.03 14:00"
function hourKey(d) {
  const p = parts(new Date(d));
  return `${p.month}.${p.day} ${p.hour}:00`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Энгийн текстийг аюулгүйгээр HTML болгож мөр хуваалтыг хадгална.
function text(s) {
  return escapeHtml(s)
    .split(/\r?\n\r?\n/)
    .map((para) => `<p>${para.replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

function fullName(u) {
  if (!u) return '';
  return `${u.surname || ''} ${u.name || ''}`.trim();
}

function initials(u) {
  if (!u) return '?';
  return `${(u.surname || '').charAt(0)}${(u.name || '').charAt(0)}`.toUpperCase();
}

const PHASES = ['nomination', 'acceptance', 'voting', 'closed'];
const PHASE_LABELS = {
  draft: 'Ноорог',
  nomination: 'Нэр дэвшүүлэх',
  acceptance: 'Зөвшөөрөл авах',
  voting: 'Санал хураалт',
  closed: 'Дүн гарсан',
};

const STATUS_LABELS = {
  pending: 'Хүлээгдэж буй',
  approved: 'Баталгаажсан',
  rejected: 'Татгалзсан',
  accepted: 'Зөвшөөрсөн',
  declined: 'Татгалзсан',
  open: 'Нээлттэй',
  done: 'Шийдвэрлэсэн',
};

// Хөтчөөс ирсэн зургийн data URL-ийг шалгаж { mime, buf } буцаана.
// Хоосон бол null, буруу бол { error }.
const MAX_PHOTO_BYTES = 600 * 1024;
function parsePhoto(dataUrl) {
  const s = String(dataUrl || '').trim();
  if (!s) return null;
  const m = s.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: 'Зургийн формат буруу байна (JPG, PNG, WEBP).' };
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_PHOTO_BYTES) return { error: 'Зургийн хэмжээ хэт том байна.' };
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  const kind = isJpeg ? 'jpeg' : isPng ? 'png' : isWebp ? 'webp' : null;
  if (!kind) return { error: 'Зургийн файл гэмтэлтэй эсвэл зураг биш байна.' };
  return { mime: `image/${kind}`, buf };
}

// Facebook линкийг https://www.facebook.com/... хэлбэрт оруулна. Хоосон бол null, буруу бол false.
function normalizeFacebook(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch (e) { return false; }
  const host = u.hostname.toLowerCase();
  if (!/^((www|m|web|mbasic)\.)?(facebook\.com|fb\.com)$/.test(host)) return false;
  if (u.pathname === '/' && !u.search) return false;
  return `https://www.facebook.com${u.pathname}${u.search}`.slice(0, 255);
}

// Google Maps линкийг шалгана. Хоосон бол null, буруу бол false.
function normalizeMapUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch (e) { return false; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  const ok = host === 'maps.app.goo.gl'
    || (host === 'goo.gl' && path.startsWith('/maps'))
    || /^maps\.google\.[a-z.]+$/.test(host)
    || (/^(www\.)?google\.[a-z.]+$/.test(host) && path.startsWith('/maps'));
  if (!ok) return false;
  u.protocol = 'https:';
  const out = u.toString();
  return out.length <= 1000 ? out : false;
}

// Баримт бичгийн энгийн тэмдэглэгээг аюулгүй HTML болгоно:
// "# " гарчиг, "## " дэд гарчиг, "- "/"• " жагсаалт, "1. " дугаарласан жагсаалт, хоосон мөр = догол мөр.
function renderDoc(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(escapeHtml).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^\s*(#{1,3})\s+(.*)$/))) {
      flushPara(); flushList();
      const lvl = Math.min(m[1].length + 1, 4);
      out.push(`<h${lvl}>${escapeHtml(m[2])}</h${lvl}>`);
    } else if ((m = line.match(/^\s*[-•*]\s+(.*)$/))) {
      flushPara();
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(m[1]);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return out.join('\n');
}

// Баримт бичгийн хавсралт (PDF, Word): data URL → { mime, buf, name } | null | { error }
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const DOC_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
};
function parseDocFile(dataUrl, name) {
  const s = String(dataUrl || '');
  if (!s) return null;
  const m = s.match(/^data:([a-z0-9.+\/-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m || !DOC_TYPES[m[1].toLowerCase()]) return { error: 'Зөвхөн PDF эсвэл Word (.docx, .doc) файл хавсаргана.' };
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_DOC_BYTES) return { error: 'Файлын хэмжээ 10MB-аас ихгүй байх ёстой.' };
  const ext = DOC_TYPES[m[1].toLowerCase()];
  const magicOk = ext === 'pdf' ? buf.slice(0, 5).toString('latin1') === '%PDF-'
    : ext === 'docx' ? buf[0] === 0x50 && buf[1] === 0x4b
      : buf.slice(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  if (!magicOk) return { error: 'Файл гэмтэлтэй эсвэл төрөл нь таарахгүй байна.' };
  let fname = String(name || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 150) || `document.${ext}`;
  if (!fname.toLowerCase().endsWith(`.${ext}`)) fname += `.${ext}`;
  return { mime: m[1].toLowerCase(), buf, name: fname };
}

function fmtSize(n) {
  if (!n) return '';
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

// Ажил эрхлэлтийн байдал
const EMPLOYMENT = [
  ['public', 'Төрийн байгууллагад ажилладаг'],
  ['private', 'Хувийн хэвшилд ажилладаг'],
  ['business', 'Хувиараа бизнес эрхэлдэг'],
  ['abroad', 'Гадаадад ажиллаж байгаа'],
  ['student', 'Суралцаж байгаа'],
  ['seeking', 'Ажил хайж байгаа'],
  ['leave', 'Хүүхэд асрах чөлөөтэй'],
  ['retired', 'Тэтгэвэрт гарсан'],
  ['other', 'Бусад'],
];
const EMPLOYMENT_LABELS = Object.fromEntries(EMPLOYMENT);
const employmentKey = (v) => (EMPLOYMENT_LABELS[v] ? v : null);

function clean(s, max = 255) {
  return String(s ?? '').trim().slice(0, max);
}

// Мэргэжлийн ерөнхий чиглэл
const PROFESSION_FIELDS = [
  ['law', 'Хууль, эрх зүй'],
  ['it', 'Мэдээллийн технологи'],
  ['health', 'Эрүүл мэнд, анагаах ухаан'],
  ['education', 'Боловсрол, сургалт'],
  ['engineering', 'Инженер, техник, технологи'],
  ['construction', 'Барилга, архитектур'],
  ['finance', 'Санхүү, нягтлан бодох бүртгэл'],
  ['business', 'Эдийн засаг, бизнес, менежмент'],
  ['marketing', 'Худалдаа, маркетинг'],
  ['government', 'Төрийн захиргаа, удирдлага'],
  ['media', 'Хэвлэл мэдээлэл, сэтгүүл зүй'],
  ['arts', 'Урлаг, соёл'],
  ['sports', 'Спорт'],
  ['agriculture', 'Хөдөө аж ахуй, мал эмнэлэг'],
  ['mining', 'Уул уурхай, геологи, эрчим хүч'],
  ['transport', 'Тээвэр, логистик'],
  ['security', 'Батлан хамгаалах, хууль сахиулах'],
  ['science', 'Шинжлэх ухаан, судалгаа'],
  ['social', 'Нийгмийн ажил, сэтгэл зүй'],
  ['tourism', 'Аялал жуулчлал, үйлчилгээ'],
  ['other', 'Бусад'],
];
const PROFESSION_LABELS = Object.fromEntries(PROFESSION_FIELDS);
const MAX_PROFESSIONS = 5;

// Маягтаас ирсэн prof_field[] / prof_title[] -ийг [{ field, title }] болгоно (хоосон мөрийг алгасна).
function parseProfessions(fields, titles) {
  const f = [].concat(fields ?? []);
  const t = [].concat(titles ?? []);
  const out = [];
  for (let i = 0; i < Math.max(f.length, t.length) && out.length < MAX_PROFESSIONS; i++) {
    const field = PROFESSION_LABELS[f[i]] ? f[i] : '';
    const title = clean(t[i], 100);
    if (field || title) out.push({ field, title });
  }
  return out;
}

// Жагсаалт, хайлтад ашиглах энгийн текст (users.occupation).
function professionsText(list) {
  return list.map((p) => p.title || PROFESSION_LABELS[p.field]).join(', ').slice(0, 500);
}

// Хэрэглэгчийн мэргэжлүүдийг уншина. Хуучин бүртгэлд зөвхөн occupation байвал түүнийг нэг мөр болгоно.
function readProfessions(user) {
  if (!user) return [];
  if (user.professions) {
    try {
      const list = JSON.parse(user.professions);
      if (Array.isArray(list)) return parseProfessions(list.map((p) => p && p.field), list.map((p) => p && p.title));
    } catch (e) { /* хуучин өгөгдөл */ }
  }
  return user.occupation ? [{ field: '', title: user.occupation }] : [];
}

module.exports = {
  TZ, fmtDate, fmtDay, hourKey, ubInput, fromUbInput, escapeHtml, text, fullName, initials,
  PHASES, PHASE_LABELS, STATUS_LABELS, clean, parsePhoto, normalizeFacebook, normalizeMapUrl, renderDoc, parseDocFile, fmtSize,
  EMPLOYMENT, EMPLOYMENT_LABELS, employmentKey,
  PROFESSION_FIELDS, PROFESSION_LABELS, MAX_PROFESSIONS, parseProfessions, professionsText, readProfessions,
};

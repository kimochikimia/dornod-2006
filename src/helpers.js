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

function clean(s, max = 255) {
  return String(s ?? '').trim().slice(0, max);
}

module.exports = {
  TZ, fmtDate, fmtDay, hourKey, ubInput, fromUbInput, escapeHtml, text, fullName, initials,
  PHASES, PHASE_LABELS, STATUS_LABELS, clean, parsePhoto, normalizeFacebook,
};

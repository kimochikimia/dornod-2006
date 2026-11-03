const TZ = 'Asia/Ulaanbaatar';

const dateFmt = new Intl.DateTimeFormat('mn-MN', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const dayFmt = new Intl.DateTimeFormat('mn-MN', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function parts(d) {
  const o = {};
  for (const p of dateFmt.formatToParts(d)) o[p.type] = p.value;
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

function clean(s, max = 255) {
  return String(s ?? '').trim().slice(0, max);
}

module.exports = {
  TZ, fmtDate, fmtDay, hourKey, escapeHtml, text, fullName, initials,
  PHASES, PHASE_LABELS, STATUS_LABELS, clean,
};

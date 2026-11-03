const { pool } = require('./db');
const { fmtDay } = require('./helpers');

const DAY = 24 * 60 * 60 * 1000;

const PLAN_COLORS = [
  { name: 'Цэнхэр', hex: '#4f7cff' },
  { name: 'Нил ягаан', hex: '#8b5cf6' },
  { name: 'Ягаан', hex: '#ec4899' },
  { name: 'Улаан', hex: '#ef4444' },
  { name: 'Улбар шар', hex: '#f97316' },
  { name: 'Шар', hex: '#eab308' },
  { name: 'Ногоон', hex: '#22c55e' },
  { name: 'Оюу', hex: '#14b8a6' },
  { name: 'Цайвар цэнхэр', hex: '#0ea5e9' },
  { name: 'Хар хөх', hex: '#1e40af' },
  { name: 'Саарал', hex: '#64748b' },
];

// Сарын хуваарийн толгойн өнгө (сар бүр өөр)
const MONTH_COLORS = [
  '#5b6cf0', '#f0506e', '#f08a3c', '#22a36d', '#7cbf3f', '#f2a91f',
  '#3b8ef0', '#1f6fd1', '#7c4dff', '#a855f7', '#16a34a', '#4f7cff',
];
const MONTH_NAMES = ['1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар',
  '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'];

const toMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const dotted = (s) => s.replace(/-/g, '.');
const md = (s) => s.slice(5).replace('-', '.');

function todayStr() {
  return fmtDay(new Date()).replace(/\./g, '-');
}

async function loadItems() {
  const [rows] = await pool.query(
    `SELECT id, title, description, kind, color, responsible,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(COALESCE(end_date, start_date), '%Y-%m-%d') AS end_date
     FROM plan_items ORDER BY start_date, kind DESC, id`
  );
  const today = todayStr();
  return rows.map((r) => {
    if (r.end_date < r.start_date) r.end_date = r.start_date;
    const status = r.end_date < today ? 'done' : r.start_date > today ? 'upcoming' : 'active';
    return {
      ...r,
      days: Math.round((toMs(r.end_date) - toMs(r.start_date)) / DAY) + 1,
      status,
      range: r.kind === 'milestone' ? dotted(r.start_date) : `${dotted(r.start_date)} – ${dotted(r.end_date)}`,
      shortRange: r.kind === 'milestone' ? md(r.start_date) : `${md(r.start_date)} – ${md(r.end_date)}`,
    };
  });
}

// 1-р харагдац: цагийн шугам
function buildTimeline(items) {
  if (!items.length) return null;
  const min = Math.min(...items.map((i) => toMs(i.start_date)));
  const max = Math.max(...items.map((i) => toMs(i.end_date) + DAY));
  const span = Math.max(max - min, 14 * DAY);
  const pad = Math.max(span * 0.05, 3 * DAY);
  const lo = min - pad;
  const hi = min + span + pad;
  const pct = (t) => ((t - lo) / (hi - lo)) * 100;

  const ticks = [];
  for (let i = 0; i <= 6; i++) {
    const t = Math.round((lo + ((hi - lo) * i) / 6) / DAY) * DAY;
    ticks.push({ left: pct(t), label: dotted(ymd(t)) });
  }

  // Чухал үеүдийн шошго давхцахгүйн тулд 3 түвшинд шатлана.
  const lastLeft = [-100, -100, -100];
  const milestones = items.filter((i) => i.kind === 'milestone').map((m) => {
    const left = pct(toMs(m.start_date) + DAY / 2);
    let level = lastLeft.findIndex((l) => left - l >= 14);
    if (level === -1) level = lastLeft.indexOf(Math.min(...lastLeft));
    lastLeft[level] = left;
    return { ...m, left, level };
  });

  const tasks = items.filter((i) => i.kind === 'task').map((t) => {
    const left = pct(toMs(t.start_date));
    const width = Math.max(pct(toMs(t.end_date) + DAY) - left, 0.8);
    const labelSide = left > 35 ? 'left' : left + width < 65 ? 'right' : 'inside';
    return { ...t, left, width, labelSide };
  });

  const now = pct(toMs(todayStr()) + DAY / 2);
  return { ticks, milestones, tasks, today: now >= 0 && now <= 100 ? now : null };
}

// 2-р харагдац: сарын хуваарь (тухайн жилийн 12 сар)
function buildMonthly(items, year) {
  const pos = (ms) => {
    const d = new Date(ms);
    if (d.getUTCFullYear() < year) return 0;
    if (d.getUTCFullYear() > year) return 100;
    const m = d.getUTCMonth();
    const dim = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    return ((m + (d.getUTCDate() - 1) / dim) / 12) * 100;
  };
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  const rows = items
    .filter((i) => i.start_date <= yEnd && i.end_date >= yStart)
    .map((i) => {
      const left = pos(toMs(i.start_date));
      const right = i.kind === 'milestone' ? left : pos(toMs(i.end_date) + DAY);
      const width = Math.max(right - left, 0.6);
      // Богино багананд нэр багтахгүй тул хажууд нь гаргана.
      const outside = i.kind === 'milestone' || width < 12 ? (left + width > 80 ? 'before' : 'after') : null;
      return { ...i, left, width, outside };
    });
  const today = todayStr();
  const todayLeft = today.startsWith(String(year)) ? pos(toMs(today) + DAY / 2) : null;
  const months = MONTH_NAMES.map((name, i) => ({ name, color: MONTH_COLORS[i] }));
  return { year, rows, months, today: todayLeft };
}

function defaultYear(items) {
  const y = new Date().getFullYear();
  if (!items.length || items.some((i) => i.start_date <= `${y}-12-31` && i.end_date >= `${y}-01-01`)) return y;
  return +items[0].start_date.slice(0, 4);
}

module.exports = { PLAN_COLORS, loadItems, buildTimeline, buildMonthly, defaultYear };

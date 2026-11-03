const { pool } = require('./db');
const { fmtDate } = require('./helpers');

// Шат бүрийн хуваарийн баганууд
const STEPS = [
  { phase: 'nomination', start: 'nomination_start', end: 'nomination_end', label: 'Нэр дэвшүүлэх' },
  { phase: 'acceptance', start: 'acceptance_start', end: 'acceptance_end', label: 'Зөвшөөрөл авах' },
  { phase: 'voting', start: 'voting_start', end: 'voting_end', label: 'Санал хураалт' },
];
const ORDER = ['draft', 'nomination', 'acceptance', 'voting', 'closed'];

const ms = (e, k) => new Date(e[k]).getTime();

// Автомат горим асаалттай бөгөөд бүх огноо бөглөгдсөн эсэх
function hasSchedule(e) {
  return !!(e && e.auto_schedule && STEPS.every((s) => e[s.start] && e[s.end]));
}

// Хуваарийн дагуу одоо ямар шат байх ёстой вэ
function computePhase(e, now = Date.now()) {
  if (!hasSchedule(e)) return e.phase;
  if (now >= ms(e, 'voting_end')) return 'closed';
  if (now >= ms(e, 'voting_start')) return 'voting';
  if (now >= ms(e, 'acceptance_start')) return 'acceptance';
  if (now >= ms(e, 'nomination_start')) return 'nomination';
  return 'draft';
}

// Тухайн үйлдэл яг одоо хийгдэж болох уу (хуваарьгүй бол шатаар нь шийднэ)
function windowOpen(e, action, now = Date.now()) {
  if (!hasSchedule(e)) {
    if (action === 'nominate') return e.phase === 'nomination';
    if (action === 'respond') return ['nomination', 'acceptance'].includes(e.phase);
    if (action === 'vote') return e.phase === 'voting';
    return false;
  }
  if (action === 'nominate') return now >= ms(e, 'nomination_start') && now < ms(e, 'nomination_end');
  if (action === 'respond') return now >= ms(e, 'nomination_start') && now < ms(e, 'acceptance_end');
  if (action === 'vote') return now >= ms(e, 'voting_start') && now < ms(e, 'voting_end');
  return false;
}

// Дараагийн хугацааны тоолуурт: { label, at (ISO), atText }
function nextDeadline(e, now = Date.now()) {
  if (!hasSchedule(e)) return null;
  const points = [
    ['nomination_start', 'Нэр дэвшүүлэх эхлэхэд'],
    ['nomination_end', 'Нэр дэвшүүлэх дуусахад'],
    ['acceptance_start', 'Зөвшөөрөл авах шат эхлэхэд'],
    ['acceptance_end', 'Зөвшөөрөл өгөх хугацаа дуусахад'],
    ['voting_start', 'Санал хураалт эхлэхэд'],
    ['voting_end', 'Санал хураалт дуусахад'],
  ];
  for (const [k, label] of points) {
    if (ms(e, k) > now) return { label, at: new Date(e[k]).toISOString(), atText: fmtDate(e[k]) };
  }
  return null;
}

// Шат бүрийн хуваарийг харуулахад
function stepTimes(e) {
  if (!hasSchedule(e)) return null;
  return Object.fromEntries(STEPS.map((s) => [s.phase, { start: fmtDate(e[s.start]), end: fmtDate(e[s.end]) }]));
}

// Хуваарийн дагуу шатыг өгөгдлийн санд шинэчилнэ. Санал өгөгдсөний дараа өмнөх шат руу буцахгүй.
async function syncElection(e) {
  if (!hasSchedule(e)) return e;
  const target = computePhase(e);
  if (target === e.phase) return e;
  if (ORDER.indexOf(target) < ORDER.indexOf('voting')) {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM ballots WHERE election_id = ?', [e.id]);
    if (n > 0) return e;
  }
  if (target === 'voting') {
    await pool.query(
      `UPDATE elections SET phase = 'voting', voting_started_at = COALESCE(voting_started_at, voting_start),
         voting_ended_at = NULL, eligible_count = NULL WHERE id = ?`,
      [e.id]
    );
  } else if (target === 'closed') {
    const [[{ eligible }]] = await pool.query("SELECT COUNT(*) AS eligible FROM users WHERE status = 'approved'");
    await pool.query(
      `UPDATE elections SET phase = 'closed', voting_started_at = COALESCE(voting_started_at, voting_start),
         voting_ended_at = voting_end, eligible_count = ? WHERE id = ?`,
      [eligible, e.id]
    );
  } else {
    await pool.query('UPDATE elections SET phase = ? WHERE id = ?', [target, e.id]);
  }
  const [[fresh]] = await pool.query('SELECT * FROM elections WHERE id = ?', [e.id]);
  return fresh;
}

async function syncAll() {
  const [rows] = await pool.query('SELECT * FROM elections WHERE auto_schedule = 1');
  for (const e of rows) await syncElection(e);
}

// Админы маягтаас ирсэн хуваарийг шалгана
function validateSchedule(f) {
  const errors = [];
  if (!f.auto_schedule) return errors;
  const keys = STEPS.flatMap((s) => [s.start, s.end]);
  if (keys.some((k) => !f[k])) {
    errors.push('Автомат горимд шат бүрийн эхлэх, дуусах хугацааг бүгдийг оруулна уу.');
    return errors;
  }
  for (const s of STEPS) {
    if (f[s.start] >= f[s.end]) errors.push(`${s.label}: дуусах хугацаа эхлэхээсээ хойно байх ёстой.`);
  }
  if (f.acceptance_start < f.nomination_end) errors.push('Зөвшөөрөл авах шат нэр дэвшүүлэх шат дууссаны дараа эхэлнэ.');
  if (f.voting_start < f.acceptance_end) errors.push('Санал хураалт зөвшөөрөл авах шат дууссаны дараа эхэлнэ.');
  return errors;
}

module.exports = {
  STEPS, hasSchedule, computePhase, windowOpen, nextDeadline, stepTimes, syncElection, syncAll, validateSchedule,
};

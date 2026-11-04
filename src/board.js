// Удирдах зөвлөлийн албан тушаалууд board_posts хүснэгтэд (админ «Албан тушаал» цэснээс үүсгэнэ).
// "unassigned" нь системийн төлөв — хүснэгтэд байхгүй, засах/устгах боломжгүй.
const UNASSIGNED = 'unassigned';
const UNASSIGNED_LABEL = 'Томилогдоогүй';
// Албан тушаалын төрөл: [key, нэр]. Дарга, удирдлага нь орон тоо 1.
const POST_KINDS = [
  ['head', 'Дарга'],
  ['leadership', 'Удирдлага'],
  ['member', 'Гишүүн'],
];
const POST_KIND_LABELS = Object.fromEntries(POST_KINDS);
const KIND_ORDER = `FIELD(kind, ${POST_KINDS.map((k) => `'${k[0]}'`).join(',')})`;
// Шинэ сонгуулийн анхны албан тушаалууд: [нэр, төрөл]. Гишүүний орон тоо = суудал − удирдлага.
const DEFAULT_POSTS = [
  ['Зөвлөлийн дарга', 'head'],
  ['Нарийн бичгийн дарга', 'leadership'],
  ['Санхүү хариуцсан гишүүн', 'leadership'],
  ['Зөвлөлийн гишүүн', 'member'],
];
// Шинэ сонгуульд өмнөх баримт бичиг байхгүй үед ашиглах 10 бодлогын баримт бичиг
const DEFAULT_DOCUMENTS = [
  ['Дорнод 2006 төгсөгчдийн зөвлөлийн дүрэм', 'Зорилго, бүтэц, эрх, үүрэг, үйл ажиллагааны үндсэн зарчим'],
  ['Зөвлөлийн гишүүдийг сонгох журам', 'Нэр санал болгох, зөвшөөрөл авах, санал хураах, сонгуулийн үр дүнг баталгаажуулах'],
  ['Зөвлөлийн үйл ажиллагааны журам', 'Хурал зохион байгуулах, шийдвэр гаргах, үүрэг хуваарилах'],
  ['Санхүү, хандивын журам', 'Хандив, орлого, зарлага, зарцуулалт, тайлагнал'],
  ['Ёс зүй, ашиг сонирхлын зөрчлийн журам', 'Гишүүдийн ёс зүй, шударга байдал, хариуцлага'],
  ['Төгсөгчдийн бүртгэл, мэдээлэл хамгаалах журам', 'Бүртгэл, хувийн мэдээлэл, санал өгөх эрхийн баталгаажуулалт'],
  ['Зөвлөл байгуулах хурлын тэмдэглэл, шийдвэр', 'Байгуулагдсан үйл явц, сонгуулийн үр дүнг албажуулах'],
  ['Жилийн үйл ажиллагааны төлөвлөгөө', 'Хийх ажил, хугацаа, хариуцагч, төсөв'],
  ['Жилийн үйл ажиллагаа, санхүүгийн тайлан', 'Нийт төгсөгчдөд тайлагнах'],
  ['Албан хэрэг, хурлын тэмдэглэл хөтлөх загвар', 'Шийдвэр, хурлын ирц, архив, үүрэг даалгаврын бүртгэл'],
];

const newPostCode = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);

// ---------- Сонгууль: хүчинтэй / хүчингүй ----------
// Хүчинтэй = хамгийн сүүлд дууссан сонгууль. Түүнээс өмнө дууссан нь хүчингүй (архив).
async function currentElection() {
  const { pool } = require('./db');
  const [[e]] = await pool.query(
    `SELECT e.* FROM elections e
     WHERE e.phase = 'closed'
       AND (SELECT COUNT(*) FROM ballots b WHERE b.election_id = e.id) > 0
       AND (SELECT COUNT(*) FROM ballots b WHERE b.election_id = e.id) * 100 >= e.min_turnout * COALESCE(e.eligible_count, 0)
     ORDER BY e.voting_ended_at DESC, e.id DESC LIMIT 1`
  );
  return e || null;
}
async function latestElection() {
  const { pool } = require('./db');
  const [[e]] = await pool.query('SELECT * FROM elections ORDER BY created_at DESC, id DESC LIMIT 1');
  return e || null;
}
// invalid = дууссан ч доод ирц хүрээгүй (хүчинтэй сонгуулиас хойно дууссан эсвэл хүчинтэй нь огт байхгүй)
function electionStatus(e, cur) {
  if (e.phase !== 'closed') return 'upcoming';
  if (cur && cur.id === e.id) return 'current';
  if (!cur || new Date(e.voting_ended_at) > new Date(cur.voting_ended_at)) return 'invalid';
  return 'superseded';
}
const ELECTION_STATUS_LABELS = { current: 'Хүчинтэй', superseded: 'Хүчингүй', upcoming: 'Явагдаж буй', invalid: 'Ирц хүрээгүй' };

// Давтагдашгүй дугаар: <он>-<дугаар>, ж: 2026-01
async function nextElectionNumber(year) {
  const { pool } = require('./db');
  const [[r]] = await pool.query(
    'SELECT MAX(CAST(SUBSTRING(number, 6) AS UNSIGNED)) AS m FROM elections WHERE number LIKE ?', [`${year}-%`]
  );
  return `${year}-${String((Number(r.m) || 0) + 1).padStart(2, '0')}`;
}

// Шинэ сонгуульд анхны албан тушаал (нийт орон тоо = суудал) болон баримт бичгийн жагсаалтыг үүсгэнэ.
async function seedElection(e) {
  const { pool } = require('./db');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM board_posts WHERE election_id = ?', [e.id]);
  if (!n) {
    let left = e.seats;
    for (const [label, kind] of DEFAULT_POSTS) {
      const seats = kind === 'member' ? left : 1;
      if (seats < 1) break;
      await pool.query('INSERT INTO board_posts (election_id, code, label, kind, seats) VALUES (?, ?, ?, ?, ?)',
        [e.id, newPostCode(), label, kind, seats]);
      left -= seats;
    }
  }
  const [[{ d }]] = await pool.query('SELECT COUNT(*) AS d FROM board_documents WHERE election_id = ?', [e.id]);
  if (!d) {
    const [[prev]] = await pool.query(
      'SELECT election_id FROM board_documents WHERE election_id IS NOT NULL AND election_id <> ? ORDER BY election_id DESC LIMIT 1', [e.id]
    );
    if (prev) {
      await pool.query(
        `INSERT INTO board_documents (election_id, sort_order, title, purpose)
         SELECT ?, sort_order, title, purpose FROM board_documents WHERE election_id = ? ORDER BY sort_order, id`,
        [e.id, prev.election_id]
      );
    } else {
      for (let i = 0; i < DEFAULT_DOCUMENTS.length; i++) {
        await pool.query('INSERT INTO board_documents (election_id, sort_order, title, purpose) VALUES (?, ?, ?, ?)',
          [e.id, i + 1, ...DEFAULT_DOCUMENTS[i]]);
      }
    }
  }
}
// SQL эрэмбэлэлт: дарга → удирдлага → гишүүн (үүсгэсэн дарааллаар), томилогдоогүй нь хамгийн сүүлд
const POST_ORDER_SQL = `(b.post = '${UNASSIGNED}'),
  COALESCE((SELECT ${KIND_ORDER} * 100000 + bp.id FROM board_posts bp WHERE bp.code = b.post), 9999999)`;

async function loadPosts(electionId) {
  const { pool } = require('./db');
  const [rows] = await pool.query(
    `SELECT p.id, p.code, p.label, p.kind, p.seats,
            (SELECT COUNT(*) FROM board_appointments a WHERE a.post_id = p.id) AS member_count
     FROM board_posts p WHERE p.election_id = ? ORDER BY ${KIND_ORDER}, p.id`,
    [electionId || 0]
  );
  return rows.map((r) => ({
    ...r,
    kindLabel: POST_KIND_LABELS[r.kind] || POST_KIND_LABELS.member,
    single: r.seats === 1,
    leadership: r.kind !== 'member',
    full: r.seats != null && r.member_count >= r.seats,
  }));
}

// Ганц хүнтэй албан тушаалаас буусан хүн шилжих "энгийн гишүүн" албан тушаал.
// Гишүүний томилгоонууд: { [member_id]: [{ id, post_id, code, label, kind, appointed_at, decision }] }
async function loadAppointments(electionId) {
  const { pool } = require('./db');
  const [rows] = await pool.query(
    `SELECT a.id, a.member_id, a.post_id, DATE_FORMAT(a.appointed_at, '%Y-%m-%d') AS appointed_at, a.decision,
            p.code, p.label, p.kind
     FROM board_appointments a JOIN board_posts p ON p.id = a.post_id JOIN board_members b ON b.id = a.member_id
     WHERE b.election_id = ? ORDER BY ${KIND_ORDER}, p.id`,
    [electionId || 0]
  );
  const map = {};
  for (const r of rows) (map[r.member_id] = map[r.member_id] || []).push(r);
  return map;
}

// board_members.post/position/appointed_at/decision = томилгоонуудын хураангуй (эрэмбэ, бүлэглэлд ашиглана)
async function syncMember(memberId) {
  const { pool } = require('./db');
  const [rows] = await pool.query(
    `SELECT a.appointed_at, a.decision, p.code, p.label FROM board_appointments a JOIN board_posts p ON p.id = a.post_id
     WHERE a.member_id = ? ORDER BY ${KIND_ORDER}, p.id`,
    [memberId]
  );
  const f = rows.length
    ? { post: rows[0].code, position: rows.map((r) => r.label).join(', ').slice(0, 255), appointed_at: rows[0].appointed_at, decision: rows[0].decision }
    : { post: UNASSIGNED, position: UNASSIGNED_LABEL, appointed_at: null, decision: null };
  await pool.query('UPDATE board_members SET ? WHERE id = ?', [f, memberId]);
}

function fallbackPost(posts) {
  return posts.find((p) => p.kind === 'member' && (p.seats == null || p.member_count < p.seats)) || null;
}

// Хуучин чөлөөт текстэн албан тушаалыг шинэ ангилалд буулгах
function guessPost(text) {
  const t = String(text || '').toLowerCase();
  if (/нарийн/.test(t)) return 'secretary';
  if (/санхүү|нягтлан/.test(t)) return 'finance';
  if (/^(тэргүүн|дарга|зөвлөлийн дарга)$/.test(t.trim())) return 'chair';
  // Хуучин хувилбар сонгуулийн дүнгээс нэмэхдээ "Гишүүн" гэж автоматаар бичдэг байсан —
  // энэ нь томилгоо биш тул "Томилогдоогүй" болгоно.
  if (t.trim() === 'гишүүн' || !t.trim()) return 'unassigned';
  return 'member';
}

// Зөвлөлийн бүтэц: { tree, flat }. flat нь модны дарааллаар (depth, descendants-тай).
async function loadStructure(electionId) {
  const { pool } = require('./db');
  const [units] = await pool.query(
    `SELECT u.id, u.parent_id, u.post_id, u.name AS old_name, u.sort_order,
            p.code, p.label, p.kind, p.seats
     FROM board_units u LEFT JOIN board_posts p ON p.id = u.post_id
     WHERE u.election_id = ?
     ORDER BY u.sort_order, u.id`,
    [electionId || 0]
  );
  // Албан тушаал бүрд томилогдсон хүмүүс (томилгооноос автоматаар)
  const [people] = await pool.query(
    `SELECT a.post_id, b.id AS member_id, b.user_id, u.surname, u.name, u.photo_v
     FROM board_appointments a JOIN board_members b ON b.id = a.member_id JOIN users u ON u.id = b.user_id
     WHERE b.election_id = ? ORDER BY u.name`,
    [electionId || 0]
  );
  const byId = new Map(units.map((u) => [u.id, {
    ...u,
    name: u.label || u.old_name,
    missingPost: !u.code,
    people: u.post_id ? people.filter((p) => p.post_id === u.post_id) : [],
    children: [], descendants: [], depth: 0,
  }]));
  for (const u of byId.values()) {
    u.vacant = u.seats != null ? Math.max(u.seats - u.people.length, 0) : (u.people.length ? 0 : 1);
  }
  const tree = [];
  for (const u of byId.values()) {
    const parent = u.parent_id && byId.get(u.parent_id);
    (parent ? parent.children : tree).push(u);
  }
  const flat = [];
  const walk = (u, depth, seen) => {
    if (seen.has(u.id)) return [];
    seen.add(u.id);
    u.depth = depth;
    flat.push(u);
    for (const c of u.children) u.descendants.push(c.id, ...walk(c, depth + 1, seen));
    // Схемд эзлэх өргөн: доорх навчны тоо
    u.leaves = u.children.reduce((s, c) => s + (c.leaves || 1), 0) || 1;
    return u.descendants;
  };
  const seen = new Set();
  for (const u of tree) walk(u, 0, seen);
  return { tree, flat };
}

module.exports = {
  UNASSIGNED, UNASSIGNED_LABEL, POST_KINDS, POST_KIND_LABELS, DEFAULT_POSTS, DEFAULT_DOCUMENTS, POST_ORDER_SQL,
  ELECTION_STATUS_LABELS, newPostCode, currentElection, latestElection, electionStatus, nextElectionNumber, seedElection,
  loadPosts, loadAppointments, syncMember, fallbackPost, guessPost, loadStructure,
};

// Удирдах зөвлөлийн албан тушаалууд. Зөвлөлийн анхны хурлын шийдвэрээр админ томилно.
const POSTS = [
  { key: 'chair', label: 'Зөвлөлийн дарга', desc: 'Ерөнхий зохицуулалт', single: true },
  { key: 'secretary', label: 'Нарийн бичгийн дарга', desc: 'Хурал, шийдвэр, тайлан', single: true },
  { key: 'finance', label: 'Санхүү хариуцсан гишүүн', desc: 'Төсөв, ил тод байдал', single: true },
  { key: 'member', label: 'Зөвлөлийн гишүүн', desc: 'Сургууль, үйл ажиллагааны төлөөлөл', single: false },
  { key: 'unassigned', label: 'Томилогдоогүй', desc: 'Зөвлөлийн хурлаар албан тушаалд томилогдоно', single: false },
];
const POST_KEYS = POSTS.map((p) => p.key);
const POST_BY_KEY = Object.fromEntries(POSTS.map((p) => [p.key, p]));
// SQL эрэмбэлэлт: дарга → нарийн бичиг → санхүү → гишүүд → томилогдоогүй
const POST_ORDER_SQL = `FIELD(b.post, ${POST_KEYS.map((k) => `'${k}'`).join(',')})`;

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
async function loadStructure() {
  const { pool } = require('./db');
  const [units] = await pool.query(
    'SELECT id, parent_id, name, description, head_member_id, sort_order FROM board_units ORDER BY sort_order, id'
  );
  const [links] = await pool.query(
    `SELECT l.unit_id, b.id AS member_id, b.user_id, b.post, b.position, u.surname, u.name, u.photo_v
     FROM board_unit_members l JOIN board_members b ON b.id = l.member_id JOIN users u ON u.id = b.user_id
     ORDER BY ${POST_ORDER_SQL}, u.name`
  );
  const byId = new Map(units.map((u) => [u.id, { ...u, children: [], people: [], memberIds: [], descendants: [], depth: 0 }]));
  for (const l of links) {
    const u = byId.get(l.unit_id);
    if (!u) continue;
    u.memberIds.push(l.member_id);
    u.people.push({ ...l, is_head: l.member_id === u.head_member_id });
  }
  for (const u of byId.values()) u.people.sort((a, b) => b.is_head - a.is_head);
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

module.exports = { POSTS, POST_KEYS, POST_BY_KEY, POST_ORDER_SQL, guessPost, loadStructure };

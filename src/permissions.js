const { pool } = require('./db');

// Доороос дээш эрэмбэлсэн: хүн зөвхөн өөрөөсөө доод төлөвтэй хүний бүртгэлд хүрнэ.
const ROLES = ['member', 'moderator', 'subadmin', 'admin'];
const ROLE_LABELS = { member: 'Төгсөгч', moderator: 'Модератор', subadmin: 'Дэд админ', admin: 'Админ' };
const ROLE_RANK = Object.fromEntries(ROLES.map((r, i) => [r, i]));
// Төлөв бүрийн анхны эрх нэг удаа л тавигдсаныг тэмдэглэх (эрхийн жагсаалтад харагдахгүй)
const SEEDED = '__seeded';

// Тохируулж болох эрхүүд. group нь эрхийн хүснэгтэд бүлэглэж харуулахад.
const PERMISSIONS = [
  { key: 'view_contacts', group: 'Харах', label: 'Төгсөгчдийн утас, и-мэйл харах' },
  { key: 'nominate', group: 'Оролцох', label: 'Сонгуульд нэр дэвшүүлэх' },
  { key: 'vote', group: 'Оролцох', label: 'Сонгуульд санал өгөх' },
  { key: 'manage_news', group: 'Удирдах', label: 'Мэдээ оруулах, засах, устгах' },
  { key: 'manage_plans', group: 'Удирдах', label: 'Төлөвлөгөө оруулах, засах' },
  { key: 'manage_gallery', group: 'Удирдах', label: 'Фото альбом үүсгэх, зураг оруулах, устгах' },
  { key: 'manage_campaigns', group: 'Удирдах', label: 'Аян хөтөлбөр оруулах, дэмжлэг баталгаажуулах' },
  { key: 'manage_tickets', group: 'Удирдах', label: 'Тасалбартай арга хэмжээ үүсгэх' },
  { key: 'sell_tickets', group: 'Удирдах', label: 'Тасалбар гараар бичих' },
  { key: 'confirm_tickets', group: 'Удирдах', label: 'Тасалбартай арга хэмжээний төлбөр баталгаажуулах' },
  { key: 'manage_board', group: 'Удирдах', label: 'Удирдах зөвлөлийн гишүүд, хариуцсан ажлыг засах' },
  { key: 'approve_users', group: 'Удирдах', label: 'Шинэ бүртгэл батлах, татгалзах' },
  { key: 'edit_users', group: 'Удирдах', label: 'Төгсөгчийн мэдээлэл засах, нууц үг шинэчлэх, устгах' },
  { key: 'manage_requests', group: 'Удирдах', label: 'Засварын хүсэлт шийдвэрлэх' },
  { key: 'manage_elections', group: 'Удирдах', label: 'Сонгууль үүсгэх, шат солих' },
  { key: 'manage_schools', group: 'Удирдах', label: 'Сургуулийн жагсаалт засах' },
  { key: 'manage_roles', group: 'Удирдах', label: 'Төлөв олгох, эрх тохируулах' },
];
const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
// Удирдлагын самбарт нэвтрэх эрх өгдөг эрхүүд
const MANAGE_PERMS = PERMISSIONS.filter((p) => p.group === 'Удирдах').map((p) => p.key);
// Админаас хэзээ ч авч болохгүй эрх (бүгд түгжигдэхээс сэргийлнэ)
const LOCKED = { admin: ['manage_roles'] };

const BASE = ['view_contacts', 'nominate', 'vote'];
const DEFAULTS = {
  member: BASE,
  moderator: [...BASE, 'manage_news', 'manage_plans', 'approve_users', 'manage_requests'],
  subadmin: PERMISSION_KEYS.filter((k) => k !== 'manage_roles'),
  admin: PERMISSION_KEYS,
};

let cache = null;
// Эрхийн бүлгийн гишүүд: userId → Set(эрх)
let userCache = new Map();

async function loadPermissions() {
  const [rows] = await pool.query('SELECT role, permission FROM role_permissions');
  const map = Object.fromEntries(ROLES.map((r) => [r, new Set()]));
  for (const r of rows) if (map[r.role] && PERMISSION_KEYS.includes(r.permission)) map[r.role].add(r.permission);
  for (const [role, keys] of Object.entries(LOCKED)) keys.forEach((k) => map[role].add(k));
  cache = map;
  await loadUserPermissions();
  return map;
}

async function loadUserPermissions() {
  const [rows] = await pool.query('SELECT user_id, permission FROM user_permissions');
  const m = new Map();
  for (const r of rows) {
    if (!PERMISSION_KEYS.includes(r.permission)) continue;
    if (!m.has(r.user_id)) m.set(r.user_id, new Set());
    m.get(r.user_id).add(r.permission);
  }
  userCache = m;
}

// Шинэ төлөв нэмэгдэхэд (жишээ нь Дэд админ) зөвхөн тэр төлөвт анхны эрхийг нэг удаа тавина.
// Админ эрхийг бүгдийг нь хассан ч дахин сэргээгдэхгүй.
// Хожим нэмэгдсэн эрхийг одоо байгаа өгөгдлийн санд нэг удаа олгох: { эрх: [төлөвүүд] }
const ADDED_PERMS = { manage_board: ['subadmin', 'admin'], manage_gallery: ['subadmin', 'admin'], manage_campaigns: ['subadmin', 'admin'], manage_tickets: ['subadmin', 'admin'], confirm_tickets: ['subadmin', 'admin'] };
// Хуучин эрхээс салгасан шинэ эрх: тухайн үед хуучин эрхтэй байсан төлөв, бүлгийн гишүүдэд нэг удаа олгоно { шинэ: хуучин }
const SPLIT_PERMS = { sell_tickets: 'manage_tickets' };
const META = '__meta';

async function seedPermissions() {
  const [rows] = await pool.query('SELECT role, permission FROM role_permissions');
  for (const role of ROLES) {
    const mine = rows.filter((r) => r.role === role);
    if (mine.some((r) => r.permission === SEEDED)) continue;
    if (!mine.length) {
      for (const p of DEFAULTS[role]) await pool.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, p]);
    }
    await pool.query('INSERT IGNORE INTO role_permissions (role, permission) VALUES (?, ?)', [role, SEEDED]);
  }
  for (const [perm, roles] of Object.entries(ADDED_PERMS)) {
    const marker = `added:${perm}`;
    const [[done]] = await pool.query('SELECT 1 AS x FROM role_permissions WHERE role = ? AND permission = ?', [META, marker]);
    if (done) continue;
    for (const r of roles) await pool.query('INSERT IGNORE INTO role_permissions (role, permission) VALUES (?, ?)', [r, perm]);
    await pool.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [META, marker]);
  }
  for (const [perm, from] of Object.entries(SPLIT_PERMS)) {
    const marker = `split:${perm}`;
    const [[done]] = await pool.query('SELECT 1 AS x FROM role_permissions WHERE role = ? AND permission = ?', [META, marker]);
    if (done) continue;
    await pool.query('INSERT IGNORE INTO role_permissions (role, permission) SELECT role, ? FROM role_permissions WHERE permission = ? AND role IN (?)', [perm, from, ROLES]);
    await pool.query('INSERT IGNORE INTO user_permissions (user_id, permission, added_by) SELECT user_id, ?, added_by FROM user_permissions WHERE permission = ?', [perm, from]);
    await pool.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [META, marker]);
  }
  await loadPermissions();
}

function permsFor(user) {
  if (!user || user.status !== 'approved' || !cache) return new Set();
  const base = cache[user.role] || new Set();
  const extra = userCache.get(user.id);
  if (!extra) return base;
  return new Set([...base, ...extra]);
}

// Эрхийн бүлгүүд: { эрх: [{ id, surname, name, phone, role, school_name, created_at }] }
async function groupMembers() {
  const [rows] = await pool.query(
    `SELECT up.permission, up.created_at, u.id, u.surname, u.name, u.phone, u.role, u.status, s.name AS school_name
     FROM user_permissions up JOIN users u ON u.id = up.user_id LEFT JOIN schools s ON s.id = u.school_id
     ORDER BY u.name, u.surname`
  );
  const out = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, []]));
  for (const r of rows) if (out[r.permission]) out[r.permission].push(r);
  return out;
}

async function addToGroup(permission, userId, byId) {
  if (!PERMISSION_KEYS.includes(permission)) return false;
  const [r] = await pool.query('INSERT IGNORE INTO user_permissions (user_id, permission, added_by) VALUES (?, ?, ?)', [userId, permission, byId || null]);
  await loadUserPermissions();
  return r.affectedRows > 0;
}

async function removeFromGroup(permission, userId) {
  await pool.query('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?', [userId, permission]);
  await loadUserPermissions();
}

function rolePerms() {
  return cache;
}

// Админы хүснэгтээс ирсэн эрхүүдийг хадгална: { member: [...], moderator: [...], admin: [...] }
async function savePermissions(input) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM role_permissions WHERE role IN (?)', [ROLES]);
    for (const role of ROLES) {
      let keys = input && input[role];
      if (!Array.isArray(keys)) keys = keys ? [keys] : [];
      const set = new Set(keys.filter((k) => PERMISSION_KEYS.includes(k)));
      (LOCKED[role] || []).forEach((k) => set.add(k));
      set.add(SEEDED);
      for (const p of set) await conn.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, p]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await loadPermissions();
}

module.exports = {
  ROLES, ROLE_LABELS, ROLE_RANK, PERMISSIONS, PERMISSION_KEYS, MANAGE_PERMS, LOCKED, DEFAULTS,
  seedPermissions, loadPermissions, permsFor, rolePerms, savePermissions, groupMembers, addToGroup, removeFromGroup,
};

const { pool } = require('./db');

// Доороос дээш эрэмбэлсэн: хүн зөвхөн өөрөөсөө доод төлөвтэй хүний бүртгэлд хүрнэ.
const ROLES = ['member', 'moderator', 'subadmin', 'admin'];
const ROLE_LABELS = { member: 'Төгсөгч', moderator: 'Модератор', subadmin: 'Дэд админ', admin: 'Админ' };
const ROLE_RANK = Object.fromEntries(ROLES.map((r, i) => [r, i]));
// Төлөв бүрийн анхны эрх нэг удаа л тавигдсаныг тэмдэглэх (эрхийн жагсаалтад харагдахгүй)
const SEEDED = '__seeded';

// Тохируулж болох эрхүүд. group нь эрхийн хүснэгтэд бүлэглэж харуулахад.
const PERMISSIONS = [
  { key: 'view_members', group: 'Харах', label: 'Төгсөгчдийн жагсаалт харах' },
  { key: 'view_contacts', group: 'Харах', label: 'Төгсөгчдийн утас, и-мэйл харах' },
  { key: 'nominate', group: 'Оролцох', label: 'Сонгуульд нэр дэвшүүлэх' },
  { key: 'vote', group: 'Оролцох', label: 'Сонгуульд санал өгөх' },
  { key: 'manage_news', group: 'Удирдах', label: 'Мэдээ оруулах, засах, устгах' },
  { key: 'manage_plans', group: 'Удирдах', label: 'Төлөвлөгөө оруулах, засах' },
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

const BASE = ['view_members', 'view_contacts', 'nominate', 'vote'];
const DEFAULTS = {
  member: BASE,
  moderator: [...BASE, 'manage_news', 'manage_plans', 'approve_users', 'manage_requests'],
  subadmin: PERMISSION_KEYS.filter((k) => k !== 'manage_roles'),
  admin: PERMISSION_KEYS,
};

let cache = null;

async function loadPermissions() {
  const [rows] = await pool.query('SELECT role, permission FROM role_permissions');
  const map = Object.fromEntries(ROLES.map((r) => [r, new Set()]));
  for (const r of rows) if (map[r.role] && PERMISSION_KEYS.includes(r.permission)) map[r.role].add(r.permission);
  for (const [role, keys] of Object.entries(LOCKED)) keys.forEach((k) => map[role].add(k));
  cache = map;
  return map;
}

// Шинэ төлөв нэмэгдэхэд (жишээ нь Дэд админ) зөвхөн тэр төлөвт анхны эрхийг нэг удаа тавина.
// Админ эрхийг бүгдийг нь хассан ч дахин сэргээгдэхгүй.
// Хожим нэмэгдсэн эрхийг одоо байгаа өгөгдлийн санд нэг удаа олгох: { эрх: [төлөвүүд] }
const ADDED_PERMS = { manage_board: ['subadmin', 'admin'] };
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
  await loadPermissions();
}

function permsFor(user) {
  if (!user || user.status !== 'approved' || !cache) return new Set();
  return cache[user.role] || new Set();
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
  seedPermissions, loadPermissions, permsFor, rolePerms, savePermissions,
};

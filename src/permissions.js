const { pool } = require('./db');

const ROLES = ['member', 'moderator', 'admin'];
const ROLE_LABELS = { member: 'Төгсөгч', moderator: 'Модератор', admin: 'Админ' };

// Тохируулж болох эрхүүд. group нь эрхийн хүснэгтэд бүлэглэж харуулахад.
const PERMISSIONS = [
  { key: 'view_members', group: 'Харах', label: 'Төгсөгчдийн жагсаалт харах' },
  { key: 'view_contacts', group: 'Харах', label: 'Төгсөгчдийн утас, и-мэйл харах' },
  { key: 'nominate', group: 'Оролцох', label: 'Сонгуульд нэр дэвшүүлэх' },
  { key: 'vote', group: 'Оролцох', label: 'Сонгуульд санал өгөх' },
  { key: 'manage_news', group: 'Удирдах', label: 'Мэдээ оруулах, засах, устгах' },
  { key: 'manage_plans', group: 'Удирдах', label: 'Төлөвлөгөө оруулах, засах' },
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

async function seedPermissions() {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM role_permissions');
  if (n === 0) {
    for (const role of ROLES) {
      for (const p of DEFAULTS[role]) await pool.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, p]);
    }
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
    await conn.query('DELETE FROM role_permissions');
    for (const role of ROLES) {
      let keys = input && input[role];
      if (!Array.isArray(keys)) keys = keys ? [keys] : [];
      const set = new Set(keys.filter((k) => PERMISSION_KEYS.includes(k)));
      (LOCKED[role] || []).forEach((k) => set.add(k));
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
  ROLES, ROLE_LABELS, PERMISSIONS, PERMISSION_KEYS, MANAGE_PERMS, LOCKED, DEFAULTS,
  seedPermissions, loadPermissions, permsFor, rolePerms, savePermissions,
};

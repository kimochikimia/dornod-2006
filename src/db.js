const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

function buildConfig() {
  const base = {
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: 'Z',
  };
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (url) return { uri: url, ...base };
  return {
    ...base,
    host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'dornod2006',
  };
}

const pool = mysql.createPool(buildConfig());
// Огноог UTC-ээр хадгалж, харуулахдаа Улаанбаатарын цагаар хөрвүүлнэ.
pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

// Админ самбараас засварлах боломжтой анхны жагсаалт: [бүлэг, нэрс]. Бүлэггүй (null) нь жагсаалтын төгсгөлд.
const CENTER = 'Хэрлэн сум (аймгийн төв)';
const SUMS = 'Сумдын сургууль';
const OTHER = 'Бусад (жагсаалтад байхгүй)';
const DEFAULT_SCHOOLS = [
  [CENTER, [
    '1-р сургууль', '2-р сургууль', '5-р сургууль', '8-р сургууль', '11-р сургууль', '12-р сургууль',
    'Хан-Уул цогцолбор сургууль', 'Шинэ хөгжил цогцолбор сургууль',
    'Дорнод их сургуулийн харьяа Дорнод ахлах сургууль',
  ]],
  [SUMS, [
    'Баян-Уул сумын ЕБС', 'Баяндун сумын ЕБС', 'Баянтүмэн сумын ЕБС', 'Булган сумын ЕБС',
    'Гурванзагал сумын ЕБС', 'Дашбалбар сумын ЕБС', 'Матад сумын ЕБС', 'Сэргэлэн сумын ЕБС',
    'Халхгол сумын ЕБС', 'Халхгол сумын Ялалт багийн ЕБС', 'Хөлөнбуйр сумын ЕБС',
    'Цагаан-Овоо сумын ЕБС', 'Чойбалсан сумын ЕБС', 'Чулуунхороо сумын ЕБС',
  ]],
  [null, [OTHER]],
];

function flatDefaults() {
  const out = [];
  for (const [category, names] of DEFAULT_SCHOOLS) {
    for (const name of names) out.push({ name, category, sort_order: (out.length + 1) * 10 });
  }
  return out;
}

// schools.category багана нэмэх (хуучин өгөгдлийн санд).
async function ensureSchoolCategory() {
  const [cols] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'category'"
  );
  if (!cols.length) await pool.query('ALTER TABLE schools ADD COLUMN category VARCHAR(80) NULL AFTER name');
}

// Анхны жагсаалт эсвэл хуучин (бүлэггүй) жагсаалтыг шинэ бүлэгтэй жагсаалт руу нэг удаа шилжүүлнэ.
// Төгсөгч бүртгэлтэй хуучин сургуулийг устгахгүй — админ дараа нь шилжүүлнэ.
async function syncSchools() {
  const [[{ grouped }]] = await pool.query('SELECT COUNT(*) AS grouped FROM schools WHERE category IS NOT NULL');
  if (grouped > 0) return;
  const defaults = flatDefaults();
  await pool.query("UPDATE schools SET name = ? WHERE name = 'Бусад'", [OTHER]).catch(() => {});
  for (const s of defaults) {
    await pool.query(
      `INSERT INTO schools (name, category, sort_order) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE category = VALUES(category), sort_order = VALUES(sort_order)`,
      [s.name, s.category, s.sort_order]
    );
  }
  const names = defaults.map((s) => s.name);
  const [removed] = await pool.query(
    `DELETE FROM schools WHERE name NOT IN (?) AND id NOT IN (SELECT school_id FROM (SELECT DISTINCT school_id FROM users WHERE school_id IS NOT NULL) u)`,
    [names]
  );
  await pool.query('UPDATE schools SET sort_order = 9000 WHERE name NOT IN (?)', [names]);
  console.log(`[seed] Сургуулийн жагсаалт шинэчлэгдлээ (${defaults.length} сургууль, ${removed.affectedRows} хуучныг хассан).`);
}

function describeConfig() {
  if (process.env.DATABASE_URL) return 'DATABASE_URL';
  if (process.env.MYSQL_URL) return 'MYSQL_URL';
  if (process.env.MYSQLHOST || process.env.DB_HOST) return 'MYSQLHOST/DB_HOST';
  return null;
}

// MySQL сервер апп-аас хойно асах тохиолдолд хэдэн удаа дахин оролдоно.
async function waitForDb(attempts = 10) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      console.warn(`[db] Холболт амжилтгүй (${i}/${attempts}): ${err.code || err.message}`);
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function init() {
  const source = describeConfig();
  if (!source) {
    console.error('[db] DATABASE_URL тохируулаагүй байна. Railway дээр Variables хэсэгт DATABASE_URL=${{MySQL.MYSQL_URL}} нэмнэ үү.');
  } else {
    console.log(`[db] Холболтын тохиргоо: ${source}`);
  }
  await waitForDb();

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = sql
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await pool.query(stmt);

  await ensureSchoolCategory();
  await syncSchools();

  await seedAdmin();
}

async function seedAdmin() {
  const phone = (process.env.ADMIN_PHONE || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!phone || !password) {
    console.warn('[seed] ADMIN_PHONE / ADMIN_PASSWORD тохируулаагүй тул админ үүсгэсэнгүй.');
    return;
  }
  const [rows] = await pool.query('SELECT id, role FROM users WHERE phone = ?', [phone]);
  if (rows.length) {
    if (rows[0].role !== 'admin') {
      await pool.query("UPDATE users SET role='admin', status='approved' WHERE id=?", [rows[0].id]);
    }
    return;
  }
  const [[school]] = await pool.query("SELECT id FROM schools WHERE name='8-р сургууль'");
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (surname, name, phone, password_hash, school_id, role, status)
     VALUES ('Бумцэнд', 'Алтанхуяг', ?, ?, ?, 'admin', 'approved')`,
    [phone, hash, school ? school.id : null]
  );
  console.log('[seed] Админ хэрэглэгч (Бумцэнд Алтанхуяг) үүслээ.');
}

module.exports = { pool, init };

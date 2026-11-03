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

// Админ самбараас засварлах боломжтой анхны жагсаалт.
const DEFAULT_SCHOOLS = [
  '1-р сургууль', '2-р сургууль', '3-р сургууль', '4-р сургууль', '5-р сургууль',
  '6-р сургууль', '7-р сургууль', '8-р сургууль', '9-р сургууль', '10-р сургууль',
  '11-р сургууль', '12-р сургууль', 'Сумын сургууль', 'Бусад',
];

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = sql
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await pool.query(stmt);

  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM schools');
  if (n === 0) {
    for (let i = 0; i < DEFAULT_SCHOOLS.length; i++) {
      await pool.query('INSERT INTO schools (name, sort_order) VALUES (?, ?)', [DEFAULT_SCHOOLS[i], i + 1]);
    }
  }

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

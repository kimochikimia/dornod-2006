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

async function widenOccupation() {
  const [[col]] = await pool.query(
    "SELECT CHARACTER_MAXIMUM_LENGTH AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'occupation'"
  );
  if (col && Number(col.n) < 500) await pool.query('ALTER TABLE users MODIFY occupation VARCHAR(500) NULL');
}

async function ensureColumn(table, column, ddl) {
  const [cols] = await pool.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]
  );
  if (!cols.length) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

// Сонгуулийн шат бүрийн хуваарь (UTC-ээр хадгална).
async function ensureElectionSchedule() {
  await ensureColumn('elections', 'auto_schedule', 'TINYINT(1) NOT NULL DEFAULT 0');
  for (const c of ['nomination_start', 'nomination_end', 'acceptance_start', 'acceptance_end', 'voting_start', 'voting_end']) {
    await ensureColumn('elections', c, 'DATETIME NULL');
  }
}

// Зөвлөлийн албан тушаал (post), томилгооны огноо, хурлын шийдвэр. Хуучин чөлөөт текстийг ангилалд буулгана.
async function ensureBoardPosts() {
  const [cols] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'board_members' AND COLUMN_NAME = 'post'"
  );
  if (cols.length) return;
  await pool.query("ALTER TABLE board_members ADD COLUMN post VARCHAR(20) NOT NULL DEFAULT 'unassigned' AFTER user_id");
  await ensureColumn('board_members', 'appointed_at', 'DATE NULL');
  await ensureColumn('board_members', 'decision', 'VARCHAR(200) NULL');
  const { guessPost } = require('./board');
  const [rows] = await pool.query('SELECT id, position FROM board_members');
  const taken = new Set();
  for (const r of rows) {
    let post = guessPost(r.position);
    if (['chair', 'secretary', 'finance'].includes(post)) {
      if (taken.has(post)) post = 'member';
      taken.add(post);
    }
    await pool.query('UPDATE board_members SET post = ? WHERE id = ?', [post, r.id]);
  }
}

// Албан тушаалын хүснэгт: туршилтын хувилбарын single/leadership баганыг kind/seats болгоно.
// (Анхны албан тушаалуудыг сонгууль үүсгэхэд board.seedElection оруулна.)
async function seedBoardPosts() {
  await ensureColumn('board_posts', 'kind', "VARCHAR(20) NOT NULL DEFAULT 'member' AFTER label");
  await ensureColumn('board_posts', 'seats', 'INT NULL AFTER kind');
  const [old] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'board_posts' AND COLUMN_NAME = 'single'"
  );
  if (old.length) {
    await pool.query(`UPDATE board_posts SET
      kind = CASE WHEN code = 'chair' THEN 'head' WHEN leadership = 1 THEN 'leadership' ELSE 'member' END,
      seats = CASE WHEN code = 'chair' OR leadership = 1 OR single = 1 THEN 1 ELSE NULL END`);
    await pool.query('ALTER TABLE board_posts DROP COLUMN single, DROP COLUMN leadership');
  }
}

// Удирдах зөвлөлийг сонгууль бүрээр: сонгуулийн дугаар, election_id баганууд, хуучин өгөгдлийг хүчинтэй сонгуульд онооно.
// Хуучин нэг-албан-тушаалын томилгоог board_appointments руу нэг удаа шилжүүлнэ.
async function ensureAppointments() {
  const [[col]] = await pool.query(
    "SELECT CHARACTER_MAXIMUM_LENGTH AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'board_members' AND COLUMN_NAME = 'position'"
  );
  if (col && Number(col.n) < 255) await pool.query("ALTER TABLE board_members MODIFY position VARCHAR(255) NOT NULL DEFAULT 'Гишүүн'");
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM board_appointments');
  if (n > 0) return;
  await pool.query(`INSERT IGNORE INTO board_appointments (member_id, post_id, appointed_at, decision)
    SELECT b.id, p.id, b.appointed_at, b.decision FROM board_members b JOIN board_posts p ON p.code = b.post`);
}

async function ensureElectionScoping() {
  const board = require('./board');
  const { ubInput } = require('./helpers');
  await ensureColumn('elections', 'number', 'VARCHAR(20) NULL AFTER id');
  // Сонгууль хүчинтэй болох доод ирц (%), тэнцсэн үед "түрүүлж хүрсэн"-ийг тодорхойлох сүүлийн саналын цаг
  await ensureColumn('elections', 'min_turnout', 'INT NOT NULL DEFAULT 50 AFTER max_choices');
  await ensureColumn('candidates', 'last_vote_at', 'TIMESTAMP(3) NULL AFTER votes');
  const [nIdx] = await pool.query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'elections' AND INDEX_NAME = 'uq_election_number'"
  );
  if (!nIdx.length) await pool.query('ALTER TABLE elections ADD UNIQUE KEY uq_election_number (number)');
  const [noNum] = await pool.query('SELECT id, created_at FROM elections WHERE number IS NULL ORDER BY created_at, id');
  for (const e of noNum) {
    const number = await board.nextElectionNumber(ubInput(e.created_at).slice(0, 4));
    await pool.query('UPDATE elections SET number = ? WHERE id = ?', [number, e.id]);
  }
  for (const t of ['board_posts', 'board_units', 'board_documents']) await ensureColumn(t, 'election_id', 'INT NULL AFTER id');
  // Нэг хүн өөр сонгуулиар дахин сонгогдож болно: (user_id, election_id) давтагдашгүй
  const [mIdx] = await pool.query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'board_members' AND INDEX_NAME = 'uq_board_member'"
  );
  if (!mIdx.length) await pool.query('ALTER TABLE board_members ADD UNIQUE KEY uq_board_member (user_id, election_id)');
  const [oldIdx] = await pool.query(
    `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'board_members' AND NON_UNIQUE = 0 AND INDEX_NAME NOT IN ('PRIMARY', 'uq_board_member')
     GROUP BY INDEX_NAME HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME) = 'user_id'`
  );
  for (const i of oldIdx) await pool.query(`ALTER TABLE board_members DROP INDEX \`${i.name}\``);
  // Сонгуульгүй хуучин мөрүүдийг хүчинтэй (эсвэл хамгийн сүүлийн) сонгуульд онооно
  const target = (await board.currentElection()) || (await board.latestElection());
  if (target) {
    for (const t of ['board_posts', 'board_units', 'board_documents', 'board_members']) {
      await pool.query(`UPDATE ${t} SET election_id = ? WHERE election_id IS NULL`, [target.id]);
    }
  }
}

// users.role-д 'moderator', 'subadmin' утга нэмэх (хуучин өгөгдлийн санд).
async function ensureModeratorRole() {
  const [[col]] = await pool.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'"
  );
  if (col && !String(col.t).includes('subadmin')) {
    await pool.query("ALTER TABLE users MODIFY role ENUM('member','moderator','subadmin','admin') NOT NULL DEFAULT 'member'");
  }
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
  await ensureModeratorRole();
  await ensureElectionSchedule();
  await ensureColumn('users', 'facebook', 'VARCHAR(255) NULL AFTER city');
  await ensureColumn('users', 'gender', "ENUM('male','female') NULL AFTER name");
  await ensureColumn('users', 'photo_v', 'INT NULL AFTER facebook');
  await ensureColumn('users', 'employment', 'VARCHAR(20) NULL AFTER class_name');
  await ensureColumn('users', 'workplace', 'VARCHAR(150) NULL AFTER employment');
  await ensureColumn('users', 'position_level', 'VARCHAR(20) NULL AFTER workplace');
  await ensureColumn('users', 'position', 'VARCHAR(150) NULL AFTER position_level');
  // Олон мэргэжил (JSON) — occupation нь тэдгээрийн нэгтгэсэн текст.
  await ensureColumn('users', 'professions', 'TEXT NULL AFTER occupation');
  await widenOccupation();
  await ensureBoardPosts();
  // Төлөвлөгөөний ажлын байршил
  await ensureColumn('plan_items', 'location', 'VARCHAR(200) NULL');
  await ensureColumn('plan_items', 'map_url', 'VARCHAR(1000) NULL');
  // Баримт бичгийн төсөл (батлагдахаас өмнөх хэлэлцүүлгийн хувилбар)
  await ensureColumn('board_documents', 'draft_name', 'VARCHAR(200) NULL');
  await ensureColumn('board_documents', 'draft_mime', 'VARCHAR(100) NULL');
  await ensureColumn('board_documents', 'draft_size', 'INT NULL');
  await ensureColumn('board_documents', 'draft_data', 'LONGBLOB NULL');
  await ensureColumn('board_documents', 'draft_at', 'DATETIME NULL');
  await seedBoardPosts();
  // Бүтцийн нэгжийг албан тушаалтай холбоно (хуучин нэгжийг ижил нэртэй албан тушаалтай тааруулна)
  await ensureColumn('board_units', 'post_id', 'INT NULL AFTER parent_id');
  await pool.query(`UPDATE board_units u JOIN board_posts p ON LOWER(p.label) = LOWER(u.name)
    SET u.post_id = p.id WHERE u.post_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM (SELECT post_id FROM board_units WHERE post_id IS NOT NULL) x WHERE x.post_id = p.id)`);
  await ensureElectionScoping();
  await ensureAppointments();
  await ensureColumn('campaign_contributions', 'donor_contact', 'VARCHAR(150) NULL AFTER donor_name');
  // Тасалбартай арга хэмжээний постер
  await ensureColumn('ticket_events', 'poster', 'MEDIUMBLOB NULL');
  await ensureColumn('ticket_events', 'poster_thumb', 'MEDIUMBLOB NULL');
  await ensureColumn('ticket_events', 'poster_v', 'INT NULL');
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

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { flash, wrap, requireLogin, requirePerm, can } = require('../middleware');
const { clean } = require('../helpers');
const plan = require('../plan');
const sched = require('../electionSchedule');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  const [news] = await pool.query(
    'SELECT id, title, body, pinned, created_at FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 4'
  );
  const [[stats]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE status='approved') AS members,
       (SELECT COUNT(DISTINCT school_id) FROM users WHERE status='approved' AND school_id IS NOT NULL) AS schools`
  );
  await sched.syncAll();
  const [elections] = await pool.query(
    "SELECT * FROM elections WHERE phase <> 'draft' OR auto_schedule = 1 ORDER BY FIELD(phase,'voting','acceptance','nomination','draft','closed'), created_at DESC LIMIT 1"
  );
  const election = elections[0] || null;
  res.render('index', { title: 'Нүүр', news, stats, election, deadline: election ? sched.nextDeadline(election) : null });
}));

router.get('/news', wrap(async (req, res) => {
  const [news] = await pool.query(
    'SELECT id, title, body, pinned, created_at FROM announcements ORDER BY pinned DESC, created_at DESC'
  );
  res.render('news/list', { title: 'Мэдээ, зарлал', news });
}));

router.get('/news/:id', wrap(async (req, res, next) => {
  const [[item]] = await pool.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
  if (!item) return next();
  res.render('news/show', { title: item.title, item });
}));

router.get('/plan', wrap(async (req, res) => {
  const items = await plan.loadItems();
  const view = req.query.view === 'monthly' ? 'monthly' : 'timeline';
  const qYear = Number(req.query.year);
  const year = qYear >= 2000 && qYear <= 2100 ? qYear : plan.defaultYear(items);
  res.render('plan', {
    title: 'Төлөвлөгөө',
    items,
    view,
    timeline: view === 'timeline' ? plan.buildTimeline(items) : null,
    monthly: view === 'monthly' ? plan.buildMonthly(items, year) : null,
  });
}));

router.get('/members', requirePerm('view_members'), wrap(async (req, res) => {
  const q = clean(req.query.q, 80);
  const school = Number(req.query.school) || null;
  const where = ["u.status = 'approved'"];
  const params = [];
  if (q) {
    where.push('(u.name LIKE ? OR u.surname LIKE ? OR u.occupation LIKE ? OR u.city LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (school) {
    where.push('u.school_id = ?');
    params.push(school);
  }
  const [members] = await pool.query(
    `SELECT u.id, u.surname, u.name, u.class_name, u.occupation, u.city, u.role, s.name AS school_name
     FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE ${where.join(' AND ')} ORDER BY s.sort_order, u.name`,
    params
  );
  const [schools] = await pool.query('SELECT * FROM schools ORDER BY sort_order, name');
  res.render('members/list', { title: 'Төгсөгчид', members, schools, q, school });
}));

router.get('/members/:id', requirePerm('view_members'), wrap(async (req, res, next) => {
  const [[member]] = await pool.query(
    `SELECT u.id, u.surname, u.name, u.phone, u.email, u.class_name, u.occupation, u.city, u.bio, u.role, u.created_at,
            s.name AS school_name
     FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.id = ? AND u.status = 'approved'`,
    [req.params.id]
  );
  if (!member) return next();
  if (!can(req.user, 'view_contacts')) {
    member.phone = null;
    member.email = null;
  }
  res.render('members/show', { title: `${member.surname} ${member.name}`, member });
}));

router.get('/me', requireLogin, wrap(async (req, res) => {
  const [requests] = await pool.query(
    'SELECT * FROM change_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
    [req.user.id]
  );
  // Надад ирсэн нэр дэвшүүлэлтүүд (хариу өгөх боломжтой шатанд байгаа)
  const [candidacies] = await pool.query(
    `SELECT c.*, e.title AS election_title, e.phase, e.auto_schedule, e.nomination_start, e.nomination_end,
            e.acceptance_start, e.acceptance_end, e.voting_start, e.voting_end,
            (SELECT COUNT(*) FROM nominations n WHERE n.candidate_id = c.id) AS nomination_count
     FROM candidates c JOIN elections e ON e.id = c.election_id
     WHERE c.user_id = ? AND e.phase IN ('nomination','acceptance','voting')
     ORDER BY e.created_at DESC`,
    [req.user.id]
  );
  for (const c of candidacies) c.canRespond = sched.windowOpen(c, 'respond');
  res.render('me', { title: 'Миний хуудас', requests, candidacies });
}));

router.post('/me/password', requireLogin, wrap(async (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.password || '');
  const [[row]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(current, row.password_hash))) {
    flash(req, 'error', 'Одоогийн нууц үг буруу байна.');
  } else if (next.length < 8) {
    flash(req, 'error', 'Шинэ нууц үг дор хаяж 8 тэмдэгт байх ёстой.');
  } else if (next !== req.body.password2) {
    flash(req, 'error', 'Шинэ нууц үг хоорондоо таарахгүй байна.');
  } else {
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(next, 12), req.user.id]);
    flash(req, 'success', 'Нууц үг амжилттай солигдлоо.');
  }
  res.redirect('/me');
}));

router.post('/me/request', requireLogin, wrap(async (req, res) => {
  const message = clean(req.body.message, 2000);
  if (message.length < 3) {
    flash(req, 'error', 'Хүсэлтээ бичнэ үү.');
  } else {
    const [[{ n }]] = await pool.query(
      "SELECT COUNT(*) AS n FROM change_requests WHERE user_id = ? AND status = 'open'",
      [req.user.id]
    );
    if (n >= 5) {
      flash(req, 'warn', 'Таны 5 хүсэлт шийдвэрлэгдэхийг хүлээж байна. Түр хүлээнэ үү.');
    } else {
      await pool.query('INSERT INTO change_requests (user_id, message) VALUES (?, ?)', [req.user.id, message]);
      flash(req, 'success', 'Хүсэлтийг админд илгээлээ.');
    }
  }
  res.redirect('/me');
}));

module.exports = router;

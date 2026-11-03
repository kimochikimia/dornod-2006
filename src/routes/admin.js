const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { flash, wrap, requireManage, requirePerm, can, canTouch, forbidden } = require('../middleware');
const { clean, PHASES, PHASE_LABELS } = require('../helpers');
const perms = require('../permissions');

const router = express.Router();
router.use(requireManage);

// Хэсэг бүрийн эрх
router.use('/news', requirePerm('manage_news'));
router.use('/plans', requirePerm('manage_plans'));
router.use('/requests', requirePerm('manage_requests'));
router.use('/elections', requirePerm('manage_elections'));
router.use('/schools', requirePerm('manage_schools'));
router.use('/roles', requirePerm('manage_roles'));
router.use('/users', requirePerm('approve_users', 'edit_users'));


async function getTarget(req, res) {
  const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return null;
  if (!canTouch(req.user, user)) {
    forbidden(res);
    return false;
  }
  return user;
}

// ---------- Хянах самбар ----------
router.get('/', wrap(async (req, res) => {
  const [[counts]] = await pool.query(
    `SELECT
      (SELECT COUNT(*) FROM users WHERE status='pending') AS pending,
      (SELECT COUNT(*) FROM users WHERE status='approved') AS approved,
      (SELECT COUNT(*) FROM change_requests WHERE status='open') AS requests,
      (SELECT COUNT(*) FROM announcements) AS news,
      (SELECT COUNT(*) FROM elections WHERE phase NOT IN ('draft','closed')) AS activeElections`
  );
  let pendingUsers = [];
  if (can(req.user, 'approve_users')) {
    [pendingUsers] = await pool.query(
      `SELECT u.*, s.name AS school_name FROM users u LEFT JOIN schools s ON s.id = u.school_id
       WHERE u.status = 'pending' ORDER BY u.created_at LIMIT 10`
    );
  }
  res.render('admin/index', { title: 'Удирдлага', counts, pendingUsers });
}));

// ---------- Эрх, төлөв ----------
router.get('/roles', wrap(async (req, res) => {
  const [counts] = await pool.query("SELECT role, COUNT(*) AS n FROM users WHERE status='approved' GROUP BY role");
  const roleCounts = Object.fromEntries(counts.map((r) => [r.role, r.n]));
  const [staff] = await pool.query(
    `SELECT u.id, u.surname, u.name, u.role, s.name AS school_name FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.role <> 'member' ORDER BY FIELD(u.role,'admin','subadmin','moderator'), u.name`
  );
  res.render('admin/roles', {
    title: 'Эрх, төлөв — Админ', perms, current: perms.rolePerms(), roleCounts, staff,
  });
}));

router.post('/roles', wrap(async (req, res) => {
  await perms.savePermissions(req.body.perms || {});
  flash(req, 'success', 'Эрхийн тохиргоо хадгалагдлаа.');
  res.redirect('/admin/roles');
}));

router.post('/roles/reset', wrap(async (req, res) => {
  await perms.savePermissions(perms.DEFAULTS);
  flash(req, 'success', 'Эрхийг анхны тохиргоонд буцаалаа.');
  res.redirect('/admin/roles');
}));

// ---------- Төгсөгчид ----------
router.get('/users', wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';
  const role = perms.ROLES.includes(req.query.role) ? req.query.role : '';
  const q = clean(req.query.q, 80);
  const where = [];
  const params = [];
  if (status) { where.push('u.status = ?'); params.push(status); }
  if (role) { where.push('u.role = ?'); params.push(role); }
  if (q) {
    where.push('(u.name LIKE ? OR u.surname LIKE ? OR u.phone LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const [users] = await pool.query(
    `SELECT u.*, s.name AS school_name FROM users u LEFT JOIN schools s ON s.id = u.school_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY FIELD(u.status,'pending','approved','rejected'), u.created_at DESC`,
    params
  );
  res.render('admin/users', { title: 'Төгсөгчид — Удирдлага', users, status, role, q });
}));

router.post('/users/:id/status', requirePerm('approve_users'), wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.body.status) ? req.body.status : null;
  const target = await getTarget(req, res);
  if (target === false) return;
  if (status && target && target.id !== req.user.id) {
    // Татгалзсан хэрэглэгчийн сесс loadUser дээр автоматаар хүчингүй болно.
    await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, target.id]);
    flash(req, 'success', status === 'approved' ? 'Бүртгэлийг баталгаажууллаа.' : 'Төлөв шинэчлэгдлээ.');
  }
  res.redirect(req.get('Referer') || '/admin/users');
}));

// Төлөв (Төгсөгч / Модератор / Админ) олгох
router.post('/users/:id/role', requirePerm('manage_roles'), wrap(async (req, res, next) => {
  const target = await getTarget(req, res);
  if (target === false) return;
  if (!target) return next();
  const role = perms.ROLES.includes(req.body.role) ? req.body.role : null;
  if (target.id === req.user.id) {
    flash(req, 'error', 'Өөрийн төлөвийг өөрчлөх боломжгүй.');
  } else if (role) {
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, target.id]);
    flash(req, 'success', `${target.surname} ${target.name}: "${perms.ROLE_LABELS[role]}" төлөвтэй боллоо.`);
  }
  res.redirect(req.get('Referer') || `/admin/users/${target.id}`);
}));

router.get('/users/:id', requirePerm('edit_users'), wrap(async (req, res, next) => {
  const user = await getTarget(req, res);
  if (user === false) return;
  if (!user) return next();
  const [schools] = await pool.query('SELECT * FROM schools ORDER BY sort_order, name');
  res.render('admin/user-edit', { title: 'Төгсөгч засах', user, schools });
}));

router.post('/users/:id', requirePerm('edit_users'), wrap(async (req, res, next) => {
  const target = await getTarget(req, res);
  if (target === false) return;
  if (!target) return next();
  const id = target.id;
  const phone = String(req.body.phone || '').replace(/[\s-]/g, '').slice(0, 20);
  if (!/^\+?\d{8,15}$/.test(phone)) {
    flash(req, 'error', 'Утасны дугаар буруу байна.');
    return res.redirect(`/admin/users/${id}`);
  }
  const [dup] = await pool.query('SELECT id FROM users WHERE phone = ? AND id <> ?', [phone, id]);
  if (dup.length) {
    flash(req, 'error', 'Энэ утасны дугаар өөр хэрэглэгчид бүртгэлтэй байна.');
    return res.redirect(`/admin/users/${id}`);
  }
  // Өөрийн төлөв, бүртгэлийн төлөвийг өөрөө өөрчлөхгүй; эрхгүй бол хуучнаар нь үлдээнэ.
  const self = id === req.user.id;
  const role = !self && can(req.user, 'manage_roles') && perms.ROLES.includes(req.body.role) ? req.body.role : target.role;
  const status = !self && can(req.user, 'approve_users') && ['pending', 'approved', 'rejected'].includes(req.body.status)
    ? req.body.status : target.status;
  await pool.query(
    `UPDATE users SET surname=?, name=?, phone=?, email=?, school_id=?, class_name=?, occupation=?, city=?, bio=?, role=?, status=?
     WHERE id = ?`,
    [clean(req.body.surname, 80), clean(req.body.name, 80), phone, clean(req.body.email, 120) || null,
      Number(req.body.school_id) || null, clean(req.body.class_name, 20) || null, clean(req.body.occupation, 150) || null,
      clean(req.body.city, 100) || null, clean(req.body.bio, 3000) || null, role, status, id]
  );
  flash(req, 'success', 'Мэдээлэл хадгалагдлаа.');
  res.redirect(`/admin/users/${id}`);
}));

router.post('/users/:id/password', requirePerm('edit_users'), wrap(async (req, res, next) => {
  const target = await getTarget(req, res);
  if (target === false) return;
  if (!target) return next();
  const password = String(req.body.password || '');
  if (password.length < 8) {
    flash(req, 'error', 'Нууц үг дор хаяж 8 тэмдэгт байх ёстой.');
  } else {
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 12), target.id]);
    flash(req, 'success', 'Нууц үг шинэчлэгдлээ. Төгсөгчид шинэ нууц үгийг нь мэдэгдээрэй.');
  }
  res.redirect(`/admin/users/${target.id}`);
}));

router.post('/users/:id/delete', requirePerm('edit_users'), wrap(async (req, res, next) => {
  const target = await getTarget(req, res);
  if (target === false) return;
  if (!target) return next();
  if (target.id === req.user.id) {
    flash(req, 'error', 'Өөрийгөө устгах боломжгүй.');
  } else {
    await pool.query('DELETE FROM users WHERE id = ?', [target.id]);
    flash(req, 'success', 'Хэрэглэгч устгагдлаа.');
  }
  res.redirect('/admin/users');
}));

// ---------- Мэдээ ----------
router.get('/news', wrap(async (req, res) => {
  const [news] = await pool.query('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC');
  res.render('admin/news', { title: 'Мэдээ — Админ', news });
}));

router.get('/news/new', (req, res) => {
  res.render('admin/news-form', { title: 'Шинэ мэдээ', item: { title: '', body: '', pinned: 0 } });
});

router.get('/news/:id', wrap(async (req, res, next) => {
  const [[item]] = await pool.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
  if (!item) return next();
  res.render('admin/news-form', { title: 'Мэдээ засах', item });
}));

router.post('/news', wrap(async (req, res) => {
  const title = clean(req.body.title, 200);
  const body = clean(req.body.body, 20000);
  if (!title || !body) {
    flash(req, 'error', 'Гарчиг болон агуулгаа бичнэ үү.');
    return res.redirect('/admin/news/new');
  }
  await pool.query('INSERT INTO announcements (title, body, pinned, author_id) VALUES (?, ?, ?, ?)',
    [title, body, req.body.pinned ? 1 : 0, req.user.id]);
  flash(req, 'success', 'Мэдээ нийтлэгдлээ.');
  res.redirect('/admin/news');
}));

router.post('/news/:id', wrap(async (req, res) => {
  const title = clean(req.body.title, 200);
  const body = clean(req.body.body, 20000);
  if (!title || !body) {
    flash(req, 'error', 'Гарчиг болон агуулгаа бичнэ үү.');
    return res.redirect(`/admin/news/${req.params.id}`);
  }
  await pool.query('UPDATE announcements SET title=?, body=?, pinned=? WHERE id=?',
    [title, body, req.body.pinned ? 1 : 0, req.params.id]);
  flash(req, 'success', 'Мэдээ шинэчлэгдлээ.');
  res.redirect('/admin/news');
}));

router.post('/news/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Мэдээ устгагдлаа.');
  res.redirect('/admin/news');
}));

// ---------- Төлөвлөгөө ----------
const { PLAN_COLORS, loadItems } = require('../plan');

function planFields(body) {
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
  const kind = body.kind === 'milestone' ? 'milestone' : 'task';
  const start = String(body.start_date || '');
  let end = kind === 'milestone' ? null : String(body.end_date || '') || start;
  const errors = [];
  const title = clean(body.title, 200);
  if (!title) errors.push('Ажлын нэрийг бичнэ үү.');
  if (!isDate(start)) errors.push('Эхлэх огноог зөв оруулна уу.');
  if (end && !isDate(end)) errors.push('Дуусах огноог зөв оруулна уу.');
  if (end && isDate(start) && end < start) errors.push('Дуусах огноо эхлэхээс өмнө байж болохгүй.');
  const color = PLAN_COLORS.some((c) => c.hex === body.color) ? body.color : PLAN_COLORS[0].hex;
  return {
    errors,
    fields: {
      title, kind, start_date: start, end_date: end, color,
      description: clean(body.description, 3000) || null,
      responsible: clean(body.responsible, 150) || null,
    },
  };
}

router.get('/plans', wrap(async (req, res) => {
  res.render('admin/plans', { title: 'Төлөвлөгөө — Админ', items: await loadItems() });
}));

router.get('/plans/new', (req, res) => {
  res.render('admin/plan-form', {
    title: 'Шинэ ажил', PLAN_COLORS, errors: [],
    item: { kind: req.query.kind === 'milestone' ? 'milestone' : 'task', title: '', start_date: '', end_date: '', color: PLAN_COLORS[0].hex },
  });
});

router.get('/plans/:id', wrap(async (req, res, next) => {
  const [[item]] = await pool.query(
    `SELECT *, DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date, DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date
     FROM plan_items WHERE id = ?`, [req.params.id]);
  if (!item) return next();
  res.render('admin/plan-form', { title: 'Ажил засах', PLAN_COLORS, errors: [], item });
}));

router.post('/plans', wrap(async (req, res) => {
  const { errors, fields } = planFields(req.body);
  if (errors.length) {
    return res.status(400).render('admin/plan-form', { title: 'Шинэ ажил', PLAN_COLORS, errors, item: fields });
  }
  await pool.query('INSERT INTO plan_items SET ?', [fields]);
  flash(req, 'success', 'Төлөвлөгөөнд нэмэгдлээ.');
  res.redirect('/admin/plans');
}));

router.post('/plans/:id', wrap(async (req, res) => {
  const { errors, fields } = planFields(req.body);
  if (errors.length) {
    return res.status(400).render('admin/plan-form', { title: 'Ажил засах', PLAN_COLORS, errors, item: { ...fields, id: req.params.id } });
  }
  await pool.query('UPDATE plan_items SET ? WHERE id = ?', [fields, req.params.id]);
  flash(req, 'success', 'Хадгалагдлаа.');
  res.redirect('/admin/plans');
}));

router.post('/plans/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM plan_items WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Устгагдлаа.');
  res.redirect('/admin/plans');
}));

// ---------- Сургуулиуд ----------
router.get('/schools', wrap(async (req, res) => {
  const [schools] = await pool.query(
    `SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id) AS user_count
     FROM schools s ORDER BY s.sort_order, s.name`
  );
  res.render('admin/schools', { title: 'Сургуулиуд — Админ', schools });
}));

router.post('/schools', wrap(async (req, res) => {
  const name = clean(req.body.name, 120);
  if (name) {
    try {
      await pool.query('INSERT INTO schools (name, category, sort_order) VALUES (?, ?, ?)', [name, clean(req.body.category, 80) || null, Number(req.body.sort_order) || 0]);
      flash(req, 'success', 'Сургууль нэмэгдлээ.');
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      flash(req, 'error', 'Ийм нэртэй сургууль бүртгэлтэй байна.');
    }
  }
  res.redirect('/admin/schools');
}));

router.post('/schools/:id', wrap(async (req, res) => {
  const name = clean(req.body.name, 120);
  if (name) {
    try {
      await pool.query('UPDATE schools SET name=?, category=?, sort_order=? WHERE id=?', [name, clean(req.body.category, 80) || null, Number(req.body.sort_order) || 0, req.params.id]);
      flash(req, 'success', 'Хадгалагдлаа.');
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      flash(req, 'error', 'Ийм нэртэй сургууль бүртгэлтэй байна.');
    }
  }
  res.redirect('/admin/schools');
}));

router.post('/schools/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM schools WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Сургууль устгагдлаа.');
  res.redirect('/admin/schools');
}));

// ---------- Засварын хүсэлтүүд ----------
router.get('/requests', wrap(async (req, res) => {
  const [requests] = await pool.query(
    `SELECT r.*, u.surname, u.name, u.phone FROM change_requests r JOIN users u ON u.id = r.user_id
     ORDER BY FIELD(r.status,'open','done'), r.created_at DESC LIMIT 200`
  );
  res.render('admin/requests', { title: 'Хүсэлтүүд — Админ', requests });
}));

router.post('/requests/:id', wrap(async (req, res) => {
  const status = req.body.status === 'open' ? 'open' : 'done';
  await pool.query('UPDATE change_requests SET status=?, admin_note=? WHERE id=?',
    [status, clean(req.body.admin_note, 500) || null, req.params.id]);
  flash(req, 'success', 'Хүсэлт шинэчлэгдлээ.');
  res.redirect('/admin/requests');
}));

// ---------- Сонгууль ----------
function electionFields(body) {
  const seats = Math.min(Math.max(Number(body.seats) || 1, 1), 50);
  const maxChoices = Math.min(Math.max(Number(body.max_choices) || seats, 1), 50);
  return {
    title: clean(body.title, 200),
    description: clean(body.description, 10000) || null,
    seats,
    max_choices: maxChoices,
    show_live_results: body.show_live_results ? 1 : 0,
  };
}

router.get('/elections', wrap(async (req, res) => {
  const [elections] = await pool.query(
    `SELECT e.*,
      (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id) AS candidate_count,
      (SELECT COUNT(*) FROM ballots b WHERE b.election_id = e.id) AS ballot_count
     FROM elections e ORDER BY e.created_at DESC`
  );
  res.render('admin/elections', { title: 'Сонгууль — Админ', elections });
}));

router.get('/elections/new', (req, res) => {
  res.render('admin/election-form', {
    title: 'Шинэ сонгууль',
    e: {
      title: 'Төгсөгчдийн удирдах зөвлөлийн сонгууль',
      description: '',
      seats: 7,
      max_choices: 7,
      show_live_results: 1,
    },
  });
});

router.post('/elections', wrap(async (req, res) => {
  const f = electionFields(req.body);
  if (!f.title) {
    flash(req, 'error', 'Сонгуулийн нэрийг бичнэ үү.');
    return res.redirect('/admin/elections/new');
  }
  const [r] = await pool.query('INSERT INTO elections SET ?', [f]);
  flash(req, 'success', 'Сонгууль үүслээ. Бэлэн болмогц "Нэр дэвшүүлэх" шатыг эхлүүлнэ үү.');
  res.redirect(`/admin/elections/${r.insertId}`);
}));

router.get('/elections/:id', wrap(async (req, res, next) => {
  const [[e]] = await pool.query('SELECT * FROM elections WHERE id = ?', [req.params.id]);
  if (!e) return next();
  const [candidates] = await pool.query(
    `SELECT c.*, u.surname, u.name, u.phone, s.name AS school_name,
       (SELECT COUNT(*) FROM nominations n WHERE n.candidate_id = c.id) AS nomination_count
     FROM candidates c JOIN users u ON u.id = c.user_id LEFT JOIN schools s ON s.id = u.school_id
     WHERE c.election_id = ? ORDER BY FIELD(c.status,'accepted','pending','declined'), c.votes DESC, u.name`,
    [e.id]
  );
  const [[{ ballots }]] = await pool.query('SELECT COUNT(*) AS ballots FROM ballots WHERE election_id = ?', [e.id]);
  res.render('admin/election-manage', { title: e.title, e, candidates, ballots, PHASES, PHASE_LABELS });
}));

router.post('/elections/:id', wrap(async (req, res) => {
  const f = electionFields(req.body);
  if (!f.title) {
    flash(req, 'error', 'Сонгуулийн нэрийг бичнэ үү.');
  } else {
    await pool.query('UPDATE elections SET ? WHERE id = ?', [f, req.params.id]);
    flash(req, 'success', 'Сонгуулийн тохиргоо хадгалагдлаа.');
  }
  res.redirect(`/admin/elections/${req.params.id}`);
}));

router.post('/elections/:id/phase', wrap(async (req, res, next) => {
  const [[e]] = await pool.query('SELECT * FROM elections WHERE id = ?', [req.params.id]);
  if (!e) return next();
  const back = `/admin/elections/${e.id}`;
  const target = ['draft', ...PHASES].includes(req.body.phase) ? req.body.phase : null;
  const [[{ ballots }]] = await pool.query('SELECT COUNT(*) AS ballots FROM ballots WHERE election_id = ?', [e.id]);

  if (!target || target === e.phase) return res.redirect(back);
  if (ballots > 0 && !['voting', 'closed'].includes(target)) {
    flash(req, 'error', 'Санал өгөгдсөн тул өмнөх шат руу буцах боломжгүй.');
    return res.redirect(back);
  }
  if (target === 'voting') {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM candidates WHERE election_id = ? AND status = 'accepted'", [e.id]);
    if (n === 0) {
      flash(req, 'error', 'Зөвшөөрсөн нэр дэвшигч байхгүй тул санал хураалт эхлүүлэх боломжгүй.');
      return res.redirect(back);
    }
    await pool.query(
      'UPDATE elections SET phase = ?, voting_started_at = COALESCE(voting_started_at, NOW()), voting_ended_at = NULL, eligible_count = NULL WHERE id = ?',
      [target, e.id]
    );
  } else if (target === 'closed') {
    const [[{ eligible }]] = await pool.query("SELECT COUNT(*) AS eligible FROM users WHERE status = 'approved'");
    await pool.query('UPDATE elections SET phase = ?, voting_ended_at = NOW(), eligible_count = ? WHERE id = ?', [target, eligible, e.id]);
  } else {
    await pool.query('UPDATE elections SET phase = ? WHERE id = ?', [target, e.id]);
  }
  flash(req, 'success', `Сонгуулийн шат: "${PHASE_LABELS[target]}" боллоо.`);
  res.redirect(back);
}));

router.post('/elections/:id/candidates/:cid', wrap(async (req, res) => {
  const back = `/admin/elections/${req.params.id}`;
  const [[e]] = await pool.query('SELECT phase FROM elections WHERE id = ?', [req.params.id]);
  if (!e || ['voting', 'closed'].includes(e.phase)) {
    flash(req, 'error', 'Санал хураалт эхэлсэн тул нэр дэвшигчийг өөрчлөх боломжгүй.');
    return res.redirect(back);
  }
  if (req.body.action === 'remove') {
    await pool.query('DELETE FROM candidates WHERE id = ? AND election_id = ?', [req.params.cid, req.params.id]);
    flash(req, 'success', 'Нэр дэвшигчийг хаслаа.');
  }
  res.redirect(back);
}));

router.post('/elections/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM elections WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Сонгууль устгагдлаа.');
  res.redirect('/admin/elections');
}));

module.exports = router;

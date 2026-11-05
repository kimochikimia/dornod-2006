const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { flash, wrap, requireManage, requirePerm, can, canTouch, forbidden } = require('../middleware');
const { clean, PHASES, PHASE_LABELS } = require('../helpers');
const perms = require('../permissions');
const sched = require('../electionSchedule');
const { fromUbInput, parsePhoto, normalizeFacebook, parseDocFile } = require('../helpers');
const h = require('../helpers');
const photos = require('../photos');
const { parseCity } = require('../locations');
const { electionStats } = require('../electionStats');

const router = express.Router();
router.use(requireManage);

// Хэсэг бүрийн эрх
router.use('/news', requirePerm('manage_news'));
router.use('/plans', requirePerm('manage_plans'));
router.use('/gallery', requirePerm('manage_gallery'));
router.use('/campaigns', requirePerm('manage_campaigns'));
router.use('/requests', requirePerm('manage_requests'));
// Удирдах зөвлөл = сонгууль бүрийн ажлын орчин. Сонгуулийн шатыг manage_elections,
// албан тушаал / томилгоо / бүтэц / баримт бичгийг manage_board эрхээр удирдана.
router.use('/elections', (req, res, next) => {
  if (/^\/\d+\/(posts|board|structure|documents)(\/|$)/.test(req.path)) return requirePerm('manage_board')(req, res, next);
  if (req.method === 'GET' && req.path === '/') return requirePerm('manage_elections', 'manage_board')(req, res, next);
  return requirePerm('manage_elections')(req, res, next);
});
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
      (SELECT COUNT(*) FROM elections WHERE phase NOT IN ('draft','closed')) AS activeElections,
      (SELECT COUNT(*) FROM campaign_contributions WHERE status='pending') AS campaignPending`
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
  const place = parseCity(req.body.city_choice, req.body.city_other, target.city);
  if (place.error) {
    flash(req, 'error', place.error);
    return res.redirect(`/admin/users/${id}`);
  }
  const facebook = normalizeFacebook(req.body.facebook);
  if (facebook === false) {
    flash(req, 'error', 'Facebook линк буруу байна (ж: facebook.com/нэр).');
    return res.redirect(`/admin/users/${id}`);
  }
  // Өөрийн төлөв, бүртгэлийн төлөвийг өөрөө өөрчлөхгүй; эрхгүй бол хуучнаар нь үлдээнэ.
  const self = id === req.user.id;
  const role = !self && can(req.user, 'manage_roles') && perms.ROLES.includes(req.body.role) ? req.body.role : target.role;
  const status = !self && can(req.user, 'approve_users') && ['pending', 'approved', 'rejected'].includes(req.body.status)
    ? req.body.status : target.status;
  const professions = h.parseProfessions(req.body.prof_field, req.body.prof_title);
  await pool.query(
    `UPDATE users SET surname=?, name=?, phone=?, email=?, school_id=?, class_name=?, occupation=?, professions=?, employment=?, workplace=?, position_level=?, position=?,
       city=?, facebook=?, bio=?, role=?, status=?
     WHERE id = ?`,
    [clean(req.body.surname, 80), clean(req.body.name, 80), phone, clean(req.body.email, 120) || null,
      Number(req.body.school_id) || null, clean(req.body.class_name, 20) || null,
      h.professionsText(professions) || null, professions.length ? JSON.stringify(professions) : null,
      h.employmentKey(req.body.employment), clean(req.body.workplace, 150) || null,
      h.positionKey(req.body.position_level), clean(req.body.position, 150) || null,
      place.city, facebook || null, clean(req.body.bio, 3000) || null, role, status, id]
  );
  flash(req, 'success', 'Мэдээлэл хадгалагдлаа.');
  res.redirect(`/admin/users/${id}`);
}));

router.post('/users/:id/photo', requirePerm('edit_users'), wrap(async (req, res, next) => {
  const target = await getTarget(req, res);
  if (target === false) return;
  if (!target) return next();
  if (req.body.action === 'delete') {
    await photos.deletePhoto(target.id);
    flash(req, 'success', 'Зураг устгагдлаа.');
  } else {
    const photo = parsePhoto(req.body.photo_data);
    if (!photo) flash(req, 'error', 'Зураг сонгоно уу.');
    else if (photo.error) flash(req, 'error', photo.error);
    else {
      await photos.savePhoto(target.id, photo);
      flash(req, 'success', 'Зураг шинэчлэгдлээ.');
    }
  }
  res.redirect(`/admin/users/${target.id}`);
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
  res.render('admin/news-form', { title: 'Шинэ мэдээ', item: { title: '', body: '', pinned: 0 }, photos: [] });
});

router.get('/news/:id', wrap(async (req, res, next) => {
  const [[item]] = await pool.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
  if (!item) return next();
  const [photos] = await pool.query('SELECT id FROM news_photos WHERE announcement_id = ? ORDER BY id', [item.id]);
  res.render('admin/news-form', { title: 'Мэдээ засах', item, photos });
}));

// Мэдээ хадгалах. Шинэ зурагтай бол браузер эхлээд JSON-оор хадгалж (id авна), дараа нь зургуудаа нэг нэгээр хуулна.
async function saveNews(req, res, id) {
  const wantsJson = (req.get('Accept') || '').includes('application/json');
  const title = clean(req.body.title, 200);
  const body = clean(req.body.body, 20000);
  if (!title || !body) {
    const msg = 'Гарчиг болон агуулгаа бичнэ үү.';
    if (wantsJson) return res.status(400).json({ error: msg });
    flash(req, 'error', msg);
    return res.redirect(id ? `/admin/news/${id}` : '/admin/news/new');
  }
  if (id) {
    await pool.query('UPDATE announcements SET title=?, body=?, pinned=? WHERE id=?',
      [title, body, req.body.pinned ? 1 : 0, id]);
    const remove = [].concat(req.body.remove_photo || []).map(Number).filter(Boolean);
    if (remove.length) await pool.query('DELETE FROM news_photos WHERE announcement_id = ? AND id IN (?)', [id, remove]);
  } else {
    const [r] = await pool.query('INSERT INTO announcements (title, body, pinned, author_id) VALUES (?, ?, ?, ?)',
      [title, body, req.body.pinned ? 1 : 0, req.user.id]);
    id = r.insertId;
  }
  flash(req, 'success', req.params.id ? 'Мэдээ шинэчлэгдлээ.' : 'Мэдээ нийтлэгдлээ.');
  if (wantsJson) return res.json({ ok: true, id });
  res.redirect('/admin/news');
}

router.post('/news', wrap((req, res) => saveNews(req, res, null)));

router.post('/news/:id', wrap(async (req, res, next) => {
  const [[item]] = await pool.query('SELECT id FROM announcements WHERE id = ?', [req.params.id]);
  if (!item) return next();
  return saveNews(req, res, item.id);
}));

// Мэдээний зураг: браузер дээр шахсан JPEG (бүтэн + жижиг), нэг удаад нэг зураг — JSON буцаана
router.post('/news/:id/photos', wrap(async (req, res) => {
  const [[item]] = await pool.query('SELECT id FROM announcements WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Мэдээ олдсонгүй.' });
  const data = gallery.parseJpeg(req.body.data, gallery.MAX_PHOTO);
  const thumb = gallery.parseJpeg(req.body.thumb, gallery.MAX_THUMB);
  if (!data || !thumb) return res.status(400).json({ error: 'Зураг буруу эсвэл хэт том байна.' });
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM news_photos WHERE announcement_id = ?', [item.id]);
  if (n >= 30) return res.status(400).json({ error: 'Нэг мэдээнд дээд тал нь 30 зураг.' });
  const dim = (v) => Math.min(Math.max(parseInt(v, 10) || 0, 0), 20000) || null;
  const [r] = await pool.query('INSERT INTO news_photos SET ?', [{
    announcement_id: item.id, data, thumb, width: dim(req.body.w), height: dim(req.body.h), uploaded_by: req.user.id,
  }]);
  res.json({ ok: true, id: r.insertId });
}));

router.post('/news/:id/delete', wrap(async (req, res) => {
  const rx = require('../reactions');
  const [cs] = await pool.query('SELECT id FROM news_comments WHERE announcement_id = ?', [req.params.id]);
  await rx.deleteFor('comment', cs.map((c) => c.id));
  await rx.deleteFor('news', [Number(req.params.id)]);
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
  const mapUrl = h.normalizeMapUrl(body.map_url);
  if (mapUrl === false) errors.push('Google Maps линк буруу байна (ж: https://maps.app.goo.gl/...).');
  const color = PLAN_COLORS.some((c) => c.hex === body.color) ? body.color : PLAN_COLORS[0].hex;
  return {
    errors,
    fields: {
      title, kind, start_date: start, end_date: end, color,
      description: clean(body.description, 3000) || null,
      responsible: clean(body.responsible, 150) || null,
      location: clean(body.location, 200) || null,
      map_url: mapUrl || (mapUrl === false ? String(body.map_url || '').trim().slice(0, 1000) : null),
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

// ---------- Удирдах зөвлөл: сонгууль бүрийн албан тушаал, томилгоо, бүтэц, баримт бичиг ----------
const board = require('../board');
const BOARD_SECTIONS = ['posts', 'board', 'structure', 'documents'];

// Сонгуулийн ажлын орчин: req.election, res.locals.eb (= /admin/elections/:id).
// Хүчингүй болсон сонгуулийн зөвлөлийн мэдээлэл архив тул засахгүй.
router.use('/elections/:eid', wrap(async (req, res, next) => {
  if (!/^\d+$/.test(req.params.eid)) return next();
  const [[e]] = await pool.query('SELECT * FROM elections WHERE id = ?', [req.params.eid]);
  if (!e) return next();
  e.status = board.electionStatus(e, await board.currentElection());
  req.election = e;
  res.locals.ctxElection = e;
  res.locals.eb = `/admin/elections/${e.id}`;
  const section = req.path.split('/')[1];
  if (req.method === 'POST' && section === 'board' && e.status === 'invalid') {
    flash(req, 'error', 'Ирц хүрээгүй тул сонгууль хүчингүй — зөвлөл томилогдохгүй.');
    return res.redirect(`${res.locals.eb}/board`);
  }
  if (req.method === 'POST' && BOARD_SECTIONS.includes(section) && e.status === 'superseded') {
    flash(req, 'error', 'Энэ сонгууль хүчингүй болсон тул зөвлөлийн мэдээллийг засах боломжгүй (архив).');
    return res.redirect(`${res.locals.eb}/${section}`);
  }
  next();
}));

// Хуучин хаягууд (/admin/board..., /admin/documents...) → хүчинтэй сонгуулийн харгалзах хэсэг
router.get(/^\/(board|documents)(\/.*)?$/, requirePerm('manage_board'), wrap(async (req, res) => {
  const [, sec, rest = ''] = req.path.match(/^\/(board|documents)(\/.*)?$/);
  if (sec === 'documents' && /^\/\d+$/.test(rest)) {
    const [[d]] = await pool.query('SELECT election_id FROM board_documents WHERE id = ?', [rest.slice(1)]);
    if (d && d.election_id) return res.redirect(`/admin/elections/${d.election_id}/documents${rest}`);
  }
  const target = (await board.currentElection()) || (await board.latestElection());
  if (!target) return res.redirect('/admin/elections');
  const to = sec === 'documents' ? 'documents' : ({ '/posts': 'posts', '/structure': 'structure' }[rest] || 'board');
  res.redirect(`/admin/elections/${target.id}/${to}`);
}));

// ----- Баримт бичиг -----
function documentFields(body) {
  const status = body.status === 'approved' ? 'approved' : 'draft';
  const approved = /^\d{4}-\d{2}-\d{2}$/.test(body.approved_at || '') ? body.approved_at : null;
  return {
    title: clean(body.title, 200),
    purpose: clean(body.purpose, 500) || null,
    sort_order: Number(body.sort_order) || 100,
    status,
    doc_number: clean(body.doc_number, 50) || null,
    approved_at: status === 'approved' ? approved : null,
    decision: clean(body.decision, 200) || null,
    content: String(body.content || '').replace(/\r\n?/g, '\n').slice(0, 500000) || null,
  };
}

async function loadDocForm(id, electionId) {
  const [[d]] = await pool.query(
    `SELECT id, election_id, sort_order, title, purpose, status, doc_number, decision, content, file_name, file_size,
            draft_name, draft_size, DATE_FORMAT(draft_at, '%Y.%m.%d') AS draft_at,
            DATE_FORMAT(approved_at, '%Y-%m-%d') AS approved_at FROM board_documents WHERE id = ? AND election_id = ?`,
    [id, electionId]);
  return d || null;
}

router.get('/elections/:eid/documents', wrap(async (req, res) => {
  const [docs] = await pool.query(
    `SELECT id, sort_order, title, purpose, status, doc_number, file_name, file_size,
            draft_name, draft_size, DATE_FORMAT(draft_at, '%Y.%m.%d') AS draft_at,
            DATE_FORMAT(approved_at, '%Y.%m.%d') AS approved_at, CHAR_LENGTH(COALESCE(content, '')) AS content_len
     FROM board_documents WHERE election_id = ? ORDER BY sort_order, id`,
    [req.election.id]
  );
  res.render('admin/documents', { title: 'Баримт бичиг — Удирдлага', docs });
}));

router.get('/elections/:eid/documents/new', wrap(async (req, res) => {
  const [[{ next }]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM board_documents WHERE election_id = ?', [req.election.id]);
  res.render('admin/document-form', { title: 'Шинэ баримт бичиг', d: { sort_order: next, status: 'draft' }, errors: [] });
}));

router.get('/elections/:eid/documents/:id', wrap(async (req, res, next) => {
  const d = await loadDocForm(req.params.id, req.election.id);
  if (!d) return next();
  res.render('admin/document-form', { title: d.title, d, errors: [] });
}));

async function saveDocument(req, res, id) {
  const eid = req.election.id;
  const f = documentFields(req.body);
  const errors = [];
  if (!f.title) errors.push('Баримт бичгийн нэрийг бичнэ үү.');
  if (f.status === 'approved' && !f.approved_at) errors.push('Батлагдсан огноог оруулна уу.');
  if (f.status === 'approved' && !f.content && !req.body.file_data && !(id && (await loadDocForm(id, eid)).file_name)) {
    errors.push('Батлагдсан баримт бичигт агуулга бичих эсвэл файл хавсаргана уу.');
  }
  const file = parseDocFile(req.body.file_data, req.body.file_name);
  if (file && file.error) errors.push(file.error);
  if (errors.length) {
    const existing = id ? await loadDocForm(id, eid) : {};
    return res.status(400).render('admin/document-form', { title: f.title || 'Баримт бичиг', d: { ...existing, ...f, id }, errors });
  }
  let docId = id;
  if (id) await pool.query('UPDATE board_documents SET ? WHERE id = ? AND election_id = ?', [f, id, eid]);
  else [{ insertId: docId }] = await pool.query('INSERT INTO board_documents SET ?', [{ ...f, election_id: eid }]);
  if (file) {
    await pool.query('UPDATE board_documents SET file_name = ?, file_mime = ?, file_size = ?, file_data = ? WHERE id = ?',
      [file.name, file.mime, file.buf.length, file.buf, docId]);
  } else if (req.body.remove_file) {
    await pool.query('UPDATE board_documents SET file_name = NULL, file_mime = NULL, file_size = NULL, file_data = NULL WHERE id = ?', [docId]);
  }
  if (f.status === 'approved') {
    flash(req, 'success', `"${f.title}" батлагдсан баримт бичгээр нийтлэгдлээ.`);
  } else if (f.content || file || (id && (await loadDocForm(docId, eid)).file_name)) {
    flash(req, 'warn', `"${f.title}" хадгалагдлаа. Төлөв нь "Батлагдаагүй" тул эцсийн хувилбар нийтэд харагдахгүй — нийтлэх бол "Батлагдсан" болгоно уу.`);
  } else {
    flash(req, 'success', `"${f.title}" хадгалагдлаа.`);
  }
  res.redirect(`/admin/elections/${eid}/documents`);
}

router.post('/elections/:eid/documents', wrap(async (req, res) => saveDocument(req, res, null)));
router.post('/elections/:eid/documents/:id', wrap(async (req, res, next) => {
  if (!(await loadDocForm(req.params.id, req.election.id))) return next();
  return saveDocument(req, res, Number(req.params.id));
}));

// Баримт бичгийн төсөл оруулах / солих / устгах
router.post('/elections/:eid/documents/:id/draft', wrap(async (req, res, next) => {
  const d = await loadDocForm(req.params.id, req.election.id);
  if (!d) return next();
  const base = `/admin/elections/${req.election.id}/documents`;
  const back = req.body.back === 'form' ? `${base}/${d.id}` : base;
  if (req.body.action === 'delete') {
    await pool.query(
      'UPDATE board_documents SET draft_name = NULL, draft_mime = NULL, draft_size = NULL, draft_data = NULL, draft_at = NULL WHERE id = ?',
      [d.id]
    );
    flash(req, 'success', `"${d.title}"-ийн төслийг устгалаа.`);
    return res.redirect(back);
  }
  const file = parseDocFile(req.body.file_data, req.body.file_name);
  if (!file) flash(req, 'error', 'Төслийн файлаа сонгоно уу.');
  else if (file.error) flash(req, 'error', file.error);
  else {
    await pool.query(
      'UPDATE board_documents SET draft_name = ?, draft_mime = ?, draft_size = ?, draft_data = ?, draft_at = NOW() WHERE id = ?',
      [file.name, file.mime, file.buf.length, file.buf, d.id]
    );
    flash(req, 'success', `"${d.title}"-ийн төсөл оруулагдлаа. Баталгаажсан төгсөгчид татаж авах боломжтой.`);
  }
  res.redirect(back);
}));

router.post('/elections/:eid/documents/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM board_documents WHERE id = ? AND election_id = ?', [req.params.id, req.election.id]);
  flash(req, 'success', 'Баримт бичиг устгагдлаа.');
  res.redirect(`/admin/elections/${req.election.id}/documents`);
}));

// ----- Томилгоо (нэг гишүүн олон албан тушаал хашиж болно) -----
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const namesOf = (list) => list.map((p) => `${p.surname} ${p.name}`).join(', ');

// Томилгоо нэмэх / засах. Орон тоо 1 албан тушаалд өөр хүн томилбол өмнөх хүний тэр томилгоо цуцлагдана
// (өөр албан тушаалгүй үлдвэл чөлөөтэй "Гишүүн" албан тушаалд, эсвэл "Томилогдоогүй" болно).
async function saveAppointment(e, memberId, body, apptId) {
  const posts = await board.loadPosts(e.id);
  const p = posts.find((x) => x.id === Number(body.post_id));
  if (!p) return { error: 'Албан тушаал сонгоно уу.' };
  const [[dup]] = await pool.query('SELECT id FROM board_appointments WHERE member_id = ? AND post_id = ? AND id <> ?', [memberId, p.id, apptId || 0]);
  if (dup) return { error: `Энэ гишүүн "${p.label}" албан тушаалд аль хэдийн томилогдсон байна.` };
  if (p.seats > 1) {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM board_appointments WHERE post_id = ? AND id <> ?', [p.id, apptId || 0]);
    if (n >= p.seats) return { error: `"${p.label}" албан тушаалын орон тоо (${p.seats}) дүүрсэн байна.` };
  }
  const f = { post_id: p.id, appointed_at: isDate(body.appointed_at) ? body.appointed_at : null, decision: clean(body.decision, 200) || null };
  if (apptId) await pool.query('UPDATE board_appointments SET ? WHERE id = ?', [f, apptId]);
  else await pool.query('INSERT INTO board_appointments SET ?', [{ member_id: memberId, ...f }]);
  if (body.term !== undefined) await pool.query('UPDATE board_members SET term = ? WHERE id = ?', [clean(body.term, 50) || null, memberId]);

  let vacated = [];
  if (p.seats === 1) {
    [vacated] = await pool.query(
      `SELECT a.id, a.member_id, u.surname, u.name FROM board_appointments a
       JOIN board_members b ON b.id = a.member_id JOIN users u ON u.id = b.user_id
       WHERE a.post_id = ? AND a.member_id <> ?`,
      [p.id, memberId]
    );
    for (const v of vacated) {
      await pool.query('DELETE FROM board_appointments WHERE id = ?', [v.id]);
      const [[{ left }]] = await pool.query('SELECT COUNT(*) AS `left` FROM board_appointments WHERE member_id = ?', [v.member_id]);
      if (!left) {
        const fb = board.fallbackPost(await board.loadPosts(e.id));
        if (fb && fb.id !== p.id) await pool.query('INSERT INTO board_appointments (member_id, post_id) VALUES (?, ?)', [v.member_id, fb.id]);
      }
      await board.syncMember(v.member_id);
    }
  }
  await board.syncMember(memberId);
  return { post: p, vacated };
}
const vacatedMsg = (r) => (r.vacated && r.vacated.length ? ` ${namesOf(r.vacated)} "${r.post.label}" албан тушаалаас чөлөөлөгдлөө.` : '');

// Сонгуулийн ялагчдын user_id
async function winnerIds(e) {
  if (e.phase !== 'closed') return [];
  const stats = await electionStats(e);
  const ids = (stats.candidates || []).filter((c) => c.winner).map((c) => c.id);
  if (!ids.length) return [];
  const [rows] = await pool.query('SELECT user_id FROM candidates WHERE id IN (?)', [ids]);
  return rows.map((r) => r.user_id);
}

router.get('/elections/:eid/board', wrap(async (req, res) => {
  const e = req.election;
  const [members] = await pool.query(
    `SELECT b.*, DATE_FORMAT(b.appointed_at, '%Y-%m-%d') AS appointed_at, u.surname, u.name, u.photo_v, s.name AS school_name
     FROM board_members b JOIN users u ON u.id = b.user_id LEFT JOIN schools s ON s.id = u.school_id
     WHERE b.election_id = ?
     ORDER BY ${board.POST_ORDER_SQL}, u.name`,
    [e.id]
  );
  const [candidates] = await pool.query(
    `SELECT u.id, u.surname, u.name, s.name AS school_name FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.status = 'approved' AND u.id NOT IN (SELECT user_id FROM board_members WHERE election_id = ?)
     ORDER BY u.name, u.surname`,
    [e.id]
  );
  const winners = await winnerIds(e);
  const inBoard = new Set(members.map((m) => m.user_id));
  res.render('admin/board', {
    title: 'Томилгоо — Удирдлага', members, candidates, posts: await board.loadPosts(e.id), appts: await board.loadAppointments(e.id),
    winners: winners.length, notImported: winners.filter((id) => !inBoard.has(id)).length, winnerIds: winners,
    today: h.ubInput(new Date()).slice(0, 10),
  });
}));

router.post('/elections/:eid/board', wrap(async (req, res) => {
  const e = req.election;
  const back = `/admin/elections/${e.id}/board`;
  if (e.phase !== 'closed') {
    flash(req, 'error', 'Сонгууль дууссаны дараа зөвлөлийн гишүүдийг нэмнэ.');
    return res.redirect(back);
  }
  const [[u]] = await pool.query("SELECT id, surname, name FROM users WHERE id = ? AND status = 'approved'", [Number(req.body.user_id)]);
  if (!u) {
    flash(req, 'error', 'Баталгаажсан төгсөгч сонгоно уу.');
    return res.redirect(back);
  }
  let memberId;
  try {
    [{ insertId: memberId }] = await pool.query('INSERT INTO board_members (user_id, election_id, post, position) VALUES (?, ?, ?, ?)',
      [u.id, e.id, board.UNASSIGNED, board.UNASSIGNED_LABEL]);
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    flash(req, 'warn', 'Энэ төгсөгч энэ сонгуулийн зөвлөлд аль хэдийн байна.');
    return res.redirect(back);
  }
  let msg = `${u.surname} ${u.name} зөвлөлд нэмэгдлээ.`;
  if (Number(req.body.post_id)) {
    const r = await saveAppointment(e, memberId, req.body, null);
    msg += r.error ? ` Томилгоо хийгдсэнгүй: ${r.error}` : vacatedMsg(r);
  }
  flash(req, 'success', msg);
  res.redirect(back);
}));

// Энэ сонгуулиар сонгогдсон гишүүдийг зөвлөлд нэмэх (албан тушаалгүйгээр — хурлаар томилно)
router.post('/elections/:eid/board/import', wrap(async (req, res) => {
  const e = req.election;
  const back = `/admin/elections/${e.id}/board`;
  if (e.phase !== 'closed') {
    flash(req, 'error', 'Сонгууль дуусаагүй байна.');
    return res.redirect(back);
  }
  const winners = await winnerIds(e);
  let added = 0;
  for (const userId of winners) {
    const [r] = await pool.query(
      'INSERT IGNORE INTO board_members (user_id, post, position, election_id) VALUES (?, ?, ?, ?)',
      [userId, board.UNASSIGNED, board.UNASSIGNED_LABEL, e.id]
    );
    added += r.affectedRows;
  }
  flash(req, 'success', `${winners.length} сонгогдсон гишүүнээс ${added} нь шинээр нэмэгдлээ. Зөвлөлийн хурлын шийдвэрээр албан тушаалд томилно уу.`);
  res.redirect(back);
}));

async function boardMember(req) {
  const [[m]] = await pool.query('SELECT id FROM board_members WHERE id = ? AND election_id = ?', [req.params.bid, req.election.id]);
  return m || null;
}

// Томилгоо нэмэх
router.post('/elections/:eid/board/:bid/appoint', wrap(async (req, res, next) => {
  const m = await boardMember(req);
  if (!m) return next();
  const r = await saveAppointment(req.election, m.id, req.body, null);
  flash(req, r.error ? 'error' : 'success', r.error || `"${r.post.label}" албан тушаалд томилогдлоо.` + vacatedMsg(r));
  res.redirect(`/admin/elections/${req.election.id}/board#m${m.id}`);
}));

// Томилгоо засах
router.post('/elections/:eid/board/:bid/appoint/:aid', wrap(async (req, res, next) => {
  const m = await boardMember(req);
  if (!m) return next();
  const [[a]] = await pool.query('SELECT id FROM board_appointments WHERE id = ? AND member_id = ?', [req.params.aid, m.id]);
  if (!a) return next();
  const r = await saveAppointment(req.election, m.id, req.body, a.id);
  flash(req, r.error ? 'error' : 'success', r.error || 'Томилгоо хадгалагдлаа.' + vacatedMsg(r));
  res.redirect(`/admin/elections/${req.election.id}/board#m${m.id}`);
}));

// Томилгоо цуцлах (гишүүн зөвлөлд үлдэнэ)
router.post('/elections/:eid/board/:bid/appoint/:aid/delete', wrap(async (req, res, next) => {
  const m = await boardMember(req);
  if (!m) return next();
  await pool.query('DELETE FROM board_appointments WHERE id = ? AND member_id = ?', [req.params.aid, m.id]);
  await board.syncMember(m.id);
  flash(req, 'success', 'Томилгоо цуцлагдлаа.');
  res.redirect(`/admin/elections/${req.election.id}/board#m${m.id}`);
}));

router.post('/elections/:eid/board/:bid/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM board_members WHERE id = ? AND election_id = ?', [req.params.bid, req.election.id]);
  flash(req, 'success', 'Зөвлөлөөс хасагдлаа.');
  res.redirect(`/admin/elections/${req.election.id}/board`);
}));

// ----- Албан тушаал -----
router.get('/elections/:eid/posts', wrap(async (req, res) => {
  const posts = await board.loadPosts(req.election.id);
  const total = posts.reduce((s, p) => s + (p.seats || 0), 0);
  res.render('admin/board-posts', { title: 'Албан тушаал — Удирдлага', posts, total, KINDS: board.POST_KINDS });
}));

async function savePost(req, res, existing) {
  const e = req.election;
  const back = `/admin/elections/${e.id}/posts` + (existing ? `#p${existing.id}` : '');
  const fail = (msg) => { flash(req, 'error', msg); res.redirect(back); };
  const label = clean(req.body.label, 100);
  if (!label) return fail('Албан тушаалын нэрийг бичнэ үү.');
  if (label.toLowerCase() === board.UNASSIGNED_LABEL.toLowerCase()) return fail(`"${board.UNASSIGNED_LABEL}" нь системийн төлөв тул өөр нэр сонгоно уу.`);
  const kind = board.POST_KIND_LABELS[req.body.kind] ? req.body.kind : null;
  if (!kind) return fail('Албан тушаалын төрлийг сонгоно уу.');
  // Дарга, удирдлага: орон тоо автоматаар 1. Гишүүн: орон тоог заавал оруулна.
  let seats = 1;
  if (kind === 'member') {
    seats = parseInt(req.body.seats, 10);
    if (!(seats >= 1 && seats <= 999)) return fail('Гишүүн төрлийн орон тоог оруулна уу.');
  }
  const exceptId = existing ? existing.id : 0;
  const [[dup]] = await pool.query('SELECT id FROM board_posts WHERE election_id = ? AND LOWER(label) = LOWER(?) AND id <> ?', [e.id, label, exceptId]);
  if (dup) return fail(`"${label}" нэртэй албан тушаал аль хэдийн байна.`);
  if (kind === 'head') {
    const [[head]] = await pool.query("SELECT label FROM board_posts WHERE election_id = ? AND kind = 'head' AND id <> ?", [e.id, exceptId]);
    if (head) return fail(`"Дарга" төрлийн албан тушаал нэг л байна ("${head.label}").`);
  }
  // Нийт орон тоо = сонгуулиар сонгох гишүүдийн тоо
  const [[{ total }]] = await pool.query('SELECT COALESCE(SUM(seats), 0) AS total FROM board_posts WHERE election_id = ? AND id <> ?', [e.id, exceptId]);
  if (Number(total) + seats > e.seats) {
    return fail(`Нийт орон тоо сонгуулиар сонгох гишүүдийн тооноос (${e.seats}) хэтэрнэ: бусад албан тушаал ${total}, энэ ${seats}.`);
  }
  const fields = { label, kind, seats };
  if (existing) {
    await pool.query('UPDATE board_posts SET ? WHERE id = ?', [fields, existing.id]);
    // Томилогдсон гишүүдийн харагдах нэрийг шинэчилнэ
    const [holders] = await pool.query('SELECT member_id FROM board_appointments WHERE post_id = ?', [existing.id]);
    for (const x of holders) await board.syncMember(x.member_id);
    let msg = 'Албан тушаал хадгалагдлаа.';
    const n = holders.length;
    if (n > seats) msg += ` Анхаар: орон тоо ${seats} боловч ${n} хүн томилогдсон байна — томилгоогоо засна уу.`;
    flash(req, 'success', msg);
    return res.redirect(back);
  }
  const [r] = await pool.query('INSERT INTO board_posts SET ?', [{ election_id: e.id, code: board.newPostCode(), ...fields }]);
  flash(req, 'success', `"${label}" албан тушаал нэмэгдлээ.`);
  res.redirect(`/admin/elections/${e.id}/posts#p${r.insertId}`);
}

router.post('/elections/:eid/posts', wrap(async (req, res) => savePost(req, res, null)));

router.post('/elections/:eid/posts/:pid', wrap(async (req, res, next) => {
  const [[p]] = await pool.query('SELECT * FROM board_posts WHERE id = ? AND election_id = ?', [req.params.pid, req.election.id]);
  if (!p) return next();
  return savePost(req, res, p);
}));

router.post('/elections/:eid/posts/:pid/delete', wrap(async (req, res) => {
  const [[p]] = await pool.query('SELECT * FROM board_posts WHERE id = ? AND election_id = ?', [req.params.pid, req.election.id]);
  if (p) {
    const [holders] = await pool.query('SELECT member_id FROM board_appointments WHERE post_id = ?', [p.id]);
    await pool.query('DELETE FROM board_appointments WHERE post_id = ?', [p.id]);
    const r = { affectedRows: holders.length };
    // Бүтцэд байсан бол: доорх албан тушаалууд нэг түвшин дээш шилжээд, нэгж нь устна
    const [units] = await pool.query('SELECT id, parent_id FROM board_units WHERE post_id = ?', [p.id]);
    for (const u of units) {
      await pool.query('UPDATE board_units SET parent_id = ? WHERE parent_id = ?', [u.parent_id, u.id]);
      await pool.query('DELETE FROM board_units WHERE id = ?', [u.id]);
    }
    await pool.query('DELETE FROM board_posts WHERE id = ?', [p.id]);
    for (const x of holders) await board.syncMember(x.member_id);
    flash(req, 'success', `"${p.label}" устгагдлаа.` + (r.affectedRows ? ` ${r.affectedRows} гишүүний энэ томилгоо цуцлагдлаа.` : ''));
  }
  res.redirect(`/admin/elections/${req.election.id}/posts`);
}));

// ----- Бүтэц -----
router.get('/elections/:eid/structure', wrap(async (req, res) => {
  const { tree, flat } = await board.loadStructure(req.election.id);
  res.render('admin/board-structure', { title: 'Зөвлөлийн бүтэц — Удирдлага', tree, flat, posts: await board.loadPosts(req.election.id) });
}));

async function saveUnit(req, res, id) {
  const e = req.election;
  const back = `/admin/elections/${e.id}/structure` + (id ? `#u${id}` : '');
  const fail = (msg) => { flash(req, 'error', msg); res.redirect(back); };
  const [[post]] = await pool.query('SELECT id, label FROM board_posts WHERE id = ? AND election_id = ?', [Number(req.body.post_id) || 0, e.id]);
  if (!post) return fail('Албан тушаал сонгоно уу. Албан тушаалыг «Албан тушаал» хэсэгт үүсгэнэ.');
  const [[used]] = await pool.query('SELECT id FROM board_units WHERE post_id = ? AND id <> ?', [post.id, id || 0]);
  if (used) return fail(`"${post.label}" бүтцэд аль хэдийн орсон байна.`);
  const { flat } = await board.loadStructure(e.id);
  const byId = new Map(flat.map((u) => [u.id, u]));
  let parent = Number(req.body.parent_id) || null;
  if (parent && !byId.has(parent)) parent = null;
  if (id && parent && (parent === id || byId.get(id).descendants.includes(parent))) {
    return fail('Албан тушаалыг өөрийнхөө эсвэл доод албан тушаалынхаа доор оруулж болохгүй.');
  }
  const order = parseInt(req.body.sort_order, 10);
  const fields = {
    election_id: e.id, post_id: post.id, name: post.label, parent_id: parent,
    sort_order: Number.isFinite(order) ? Math.max(0, Math.min(order, 9999)) : 100,
  };
  if (id) await pool.query('UPDATE board_units SET ? WHERE id = ?', [fields, id]);
  else id = (await pool.query('INSERT INTO board_units SET ?', [fields]))[0].insertId;
  flash(req, 'success', 'Бүтэц хадгалагдлаа.');
  res.redirect(`/admin/elections/${e.id}/structure#u${id}`);
}

router.post('/elections/:eid/structure', wrap(async (req, res) => saveUnit(req, res, null)));

router.post('/elections/:eid/structure/:uid', wrap(async (req, res, next) => {
  const [[u]] = await pool.query('SELECT id FROM board_units WHERE id = ? AND election_id = ?', [req.params.uid, req.election.id]);
  if (!u) return next();
  return saveUnit(req, res, u.id);
}));

router.post('/elections/:eid/structure/:uid/delete', wrap(async (req, res) => {
  const [[u]] = await pool.query('SELECT id, parent_id FROM board_units WHERE id = ? AND election_id = ?', [req.params.uid, req.election.id]);
  if (u) {
    // Доорх албан тушаалуудыг устгахгүй — нэг түвшин дээш шилжүүлнэ.
    await pool.query('UPDATE board_units SET parent_id = ? WHERE parent_id = ?', [u.parent_id, u.id]);
    await pool.query('DELETE FROM board_units WHERE id = ?', [u.id]);
    flash(req, 'success', 'Бүтцээс хасагдлаа.');
  }
  res.redirect(`/admin/elections/${req.election.id}/structure`);
}));

// ---------- Фото альбом ----------
const gallery = require('../gallery');

function albumFields(body) {
  return {
    title: clean(body.title, 150),
    description: clean(body.description, 500) || null,
    event_date: /^\d{4}-\d{2}-\d{2}$/.test(body.event_date || '') ? body.event_date : null,
    is_public: body.is_public ? 1 : 0,
  };
}

router.get('/gallery', wrap(async (req, res) => {
  const [albums] = await pool.query(
    `SELECT a.*, DATE_FORMAT(a.event_date, '%Y.%m.%d') AS event_date_text,
            (SELECT COUNT(*) FROM gallery_photos p WHERE p.album_id = a.id) AS photo_count,
            COALESCE(a.cover_photo_id, (SELECT p.id FROM gallery_photos p WHERE p.album_id = a.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1)) AS cover_id
     FROM gallery_albums a ORDER BY COALESCE(a.event_date, DATE(a.created_at)) DESC, a.id DESC`
  );
  res.render('admin/gallery', { title: 'Фото альбом — Удирдлага', albums });
}));

router.post('/gallery', wrap(async (req, res) => {
  const f = albumFields(req.body);
  if (!f.title) {
    flash(req, 'error', 'Альбомын нэрийг бичнэ үү.');
    return res.redirect('/admin/gallery');
  }
  const [r] = await pool.query('INSERT INTO gallery_albums SET ?', [{ ...f, created_by: req.user.id }]);
  flash(req, 'success', `"${f.title}" альбом үүслээ. Одоо зургаа оруулна уу.`);
  res.redirect(`/admin/gallery/${r.insertId}`);
}));

router.get('/gallery/:id', wrap(async (req, res, next) => {
  const album = await gallery.getAlbum(req.params.id);
  if (!album) return next();
  res.render('admin/gallery-album', { title: `${album.title} — Фото альбом`, album, photos: await gallery.albumPhotos(album.id) });
}));

router.post('/gallery/:id', wrap(async (req, res, next) => {
  const album = await gallery.getAlbum(req.params.id);
  if (!album) return next();
  const f = albumFields(req.body);
  if (!f.title) {
    flash(req, 'error', 'Альбомын нэрийг бичнэ үү.');
  } else {
    await pool.query('UPDATE gallery_albums SET ? WHERE id = ?', [f, album.id]);
    flash(req, 'success', 'Альбом хадгалагдлаа.');
  }
  res.redirect(`/admin/gallery/${album.id}`);
}));

router.post('/gallery/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM gallery_albums WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Альбом бүх зурагтайгаа устгагдлаа.');
  res.redirect('/admin/gallery');
}));

// Зураг оруулах: браузер дээр шахсан JPEG (бүтэн + жижиг), нэг удаад нэг зураг — JSON буцаана
router.post('/gallery/:id/photos', wrap(async (req, res) => {
  const album = await gallery.getAlbum(req.params.id);
  if (!album) return res.status(404).json({ error: 'Альбом олдсонгүй.' });
  const data = gallery.parseJpeg(req.body.data, gallery.MAX_PHOTO);
  const thumb = gallery.parseJpeg(req.body.thumb, gallery.MAX_THUMB);
  if (!data || !thumb) return res.status(400).json({ error: 'Зураг буруу эсвэл хэт том байна.' });
  const dim = (v) => Math.min(Math.max(parseInt(v, 10) || 0, 0), 20000) || null;
  const [r] = await pool.query('INSERT INTO gallery_photos SET ?', [{
    album_id: album.id, data, thumb, width: dim(req.body.w), height: dim(req.body.h),
    caption: clean(req.body.caption, 300) || null, uploaded_by: req.user.id,
  }]);
  res.json({ ok: true, id: r.insertId });
}));

router.post('/gallery/:id/photos/:pid', wrap(async (req, res) => {
  const back = `/admin/gallery/${Number(req.params.id)}#ph${Number(req.params.pid)}`;
  if (req.body.action === 'cover') {
    await pool.query(
      'UPDATE gallery_albums a JOIN gallery_photos p ON p.album_id = a.id SET a.cover_photo_id = p.id WHERE a.id = ? AND p.id = ?',
      [req.params.id, req.params.pid]
    );
    flash(req, 'success', 'Альбомын нүүр зураг солигдлоо.');
  } else if (req.body.action === 'delete') {
    await pool.query('UPDATE gallery_albums SET cover_photo_id = NULL WHERE id = ? AND cover_photo_id = ?', [req.params.id, req.params.pid]);
    await pool.query('DELETE FROM gallery_photos WHERE id = ? AND album_id = ?', [req.params.pid, req.params.id]);
    flash(req, 'success', 'Зураг устгагдлаа.');
  } else {
    await pool.query('UPDATE gallery_photos SET caption = ? WHERE id = ? AND album_id = ?',
      [clean(req.body.caption, 300) || null, req.params.pid, req.params.id]);
    flash(req, 'success', 'Тайлбар хадгалагдлаа.');
  }
  res.redirect(back);
}));

// ---------- Аян хөтөлбөр ----------
const cmp = require('../campaigns');
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));

function campaignFields(body) {
  const errors = [];
  const f = {
    title: clean(body.title, 200),
    summary: clean(body.summary, 500) || null,
    body: clean(body.body, 20000) || null,
    goal_amount: null,
    needs: clean(body.needs, 1000) || null,
    bank_info: clean(body.bank_info, 1000) || null,
    contact: clean(body.contact, 300) || null,
    start_date: isDay(body.start_date) ? body.start_date : null,
    end_date: isDay(body.end_date) ? body.end_date : null,
    status: body.status === 'closed' ? 'closed' : 'active',
  };
  if (!f.title) errors.push('Аяны нэрийг бичнэ үү.');
  if (clean(body.goal_amount, 30)) {
    f.goal_amount = cmp.parseAmount(body.goal_amount);
    if (!f.goal_amount) errors.push('Зорилтот дүнг зөв оруулна уу (жишээ нь 5000000).');
  }
  if (f.start_date && f.end_date && f.end_date < f.start_date) errors.push('Дуусах огноо эхлэх огнооноос өмнө байж болохгүй.');
  return { errors, fields: f };
}

// Браузер дээр шахсан нүүр зураг (заавал биш). Буруу бол алдаа, байхгүй бол null.
function campaignCover(body) {
  if (!body.cover) return { cover: null };
  const cover = gallery.parseJpeg(body.cover, gallery.MAX_PHOTO);
  const thumb = gallery.parseJpeg(body.cover_thumb, gallery.MAX_THUMB);
  if (!cover || !thumb) return { error: 'Нүүр зураг буруу эсвэл хэт том байна.' };
  return { cover: { cover, cover_thumb: thumb, cover_v: Math.floor(Date.now() / 1000) % 2000000000 } };
}

const blankCampaign = () => ({ title: '', summary: '', body: '', goal_amount: null, needs: '', bank_info: '', contact: '', start_input: '', end_input: '', status: 'active' });

router.get('/campaigns', wrap(async (req, res) => {
  res.render('admin/campaigns', { title: 'Аян хөтөлбөр — Удирдлага', campaigns: await cmp.list(), cmp });
}));

router.get('/campaigns/new', (req, res) => {
  res.render('admin/campaign-form', { title: 'Шинэ аян', item: blankCampaign(), errors: [] });
});

router.get('/campaigns/:id(\\d+)/edit', wrap(async (req, res, next) => {
  const item = await cmp.get(req.params.id);
  if (!item) return next();
  res.render('admin/campaign-form', { title: 'Аян засах', item, errors: [] });
}));

// Маягтын алдаатай үед бөглөсөн утгуудыг буцааж харуулна
const formBack = (fields, id, cover_v) => ({ ...fields, id, cover_v, start_input: fields.start_date || '', end_input: fields.end_date || '' });

router.post('/campaigns', wrap(async (req, res) => {
  const { errors, fields } = campaignFields(req.body);
  const c = campaignCover(req.body);
  if (c.error) errors.push(c.error);
  if (errors.length) return res.status(400).render('admin/campaign-form', { title: 'Шинэ аян', item: formBack(fields), errors });
  const [r] = await pool.query('INSERT INTO campaigns SET ?', [{ ...fields, ...(c.cover || {}), created_by: req.user.id }]);
  flash(req, 'success', 'Аян нийтлэгдлээ.');
  res.redirect(`/admin/campaigns/${r.insertId}`);
}));

router.post('/campaigns/:id(\\d+)/edit', wrap(async (req, res, next) => {
  const item = await cmp.get(req.params.id);
  if (!item) return next();
  const { errors, fields } = campaignFields(req.body);
  const c = campaignCover(req.body);
  if (c.error) errors.push(c.error);
  if (errors.length) return res.status(400).render('admin/campaign-form', { title: 'Аян засах', item: formBack(fields, item.id, item.cover_v), errors });
  const cover = c.cover || (req.body.remove_cover ? { cover: null, cover_thumb: null, cover_v: null } : {});
  await pool.query('UPDATE campaigns SET ? WHERE id = ?', [{ ...fields, ...cover }, item.id]);
  flash(req, 'success', 'Хадгалагдлаа.');
  res.redirect(`/admin/campaigns/${item.id}`);
}));

router.post('/campaigns/:id(\\d+)/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM campaigns WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Аян бүх дэмжлэгийн бүртгэлтэйгээ устгагдлаа.');
  res.redirect('/admin/campaigns');
}));

// Аяны дэмжлэгийг удирдах: хянагдаж буйг баталгаажуулах, гараар нэмэх
// Хандивлагчаар сонгох баталгаажсан төгсөгчид
async function donorMembers() {
  const [rows] = await pool.query(
    `SELECT u.id, u.surname, u.name, u.class_name, s.name AS school_name FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.status = 'approved' ORDER BY u.surname, u.name`
  );
  return rows;
}

async function renderCampaignAdmin(res, campaign, errors = [], form = {}) {
  const all = await cmp.contributions(campaign.id, ['pending', 'confirmed', 'rejected']);
  res.status(errors.length ? 400 : 200).render('admin/campaign', {
    title: `${campaign.title} — Аян хөтөлбөр`, campaign, cmp, errors, form, members: await donorMembers(),
    pending: all.filter((c) => c.status === 'pending'),
    confirmed: all.filter((c) => c.status === 'confirmed'),
    rejected: all.filter((c) => c.status === 'rejected'),
  });
}

router.get('/campaigns/:id(\\d+)', wrap(async (req, res, next) => {
  const campaign = await cmp.get(req.params.id);
  if (!campaign) return next();
  await renderCampaignAdmin(res, campaign);
}));

// Удирдлага гараар бүртгэх — бүртгэлтэй төгсөгчөөс сонгох эсвэл бүртгэлгүй хандивлагчийн мэдээллийг оруулах. Шууд баталгаажна.
router.post('/campaigns/:id(\\d+)/contributions', wrap(async (req, res, next) => {
  const campaign = await cmp.get(req.params.id);
  if (!campaign) return next();
  const { errors, fields } = cmp.contributionFields(req.body);
  const donor = { user_id: null, donor_name: null, donor_contact: null };
  if (req.body.donor_type === 'member') {
    const [[u]] = await pool.query("SELECT id FROM users WHERE id = ? AND status = 'approved'", [Number(req.body.user_id) || 0]);
    if (u) donor.user_id = u.id;
    else errors.push('Хандивлагч төгсөгчийг жагсаалтаас сонгоно уу.');
  } else {
    donor.donor_name = clean(req.body.donor_name, 150);
    donor.donor_contact = clean(req.body.donor_contact, 150) || null;
    if (!donor.donor_name) errors.push('Хандивлагчийн нэрийг бичнэ үү.');
  }
  if (errors.length) return renderCampaignAdmin(res, campaign, errors, req.body);
  await pool.query('INSERT INTO campaign_contributions SET ?', [{
    ...fields, ...donor, campaign_id: campaign.id, status: 'confirmed', reviewed_by: req.user.id, reviewed_at: new Date(),
  }]);
  flash(req, 'success', 'Дэмжлэг бүртгэгдлээ.');
  res.redirect(`/admin/campaigns/${campaign.id}#confirmed`);
}));

router.post('/campaigns/:id(\\d+)/contributions/:cid(\\d+)', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const cid = Number(req.params.cid);
  const action = req.body.action;
  if (action === 'delete') {
    await pool.query('DELETE FROM campaign_contributions WHERE id = ? AND campaign_id = ?', [cid, id]);
    flash(req, 'success', 'Устгагдлаа.');
  } else if (['confirmed', 'rejected', 'pending'].includes(action)) {
    await pool.query('UPDATE campaign_contributions SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND campaign_id = ?',
      [action, req.user.id, new Date(), cid, id]);
    flash(req, 'success', { confirmed: 'Баталгаажлаа.', rejected: 'Татгалзлаа.', pending: 'Хянагдаж буй руу буцаалаа.' }[action]);
  }
  res.redirect(`/admin/campaigns/${id}`);
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
  const f = {
    title: clean(body.title, 200),
    description: clean(body.description, 10000) || null,
    seats,
    max_choices: maxChoices,
    min_turnout: Math.min(Math.max(Number.isFinite(parseInt(body.min_turnout, 10)) ? parseInt(body.min_turnout, 10) : 50, 0), 100),
    show_live_results: body.show_live_results ? 1 : 0,
    auto_schedule: body.auto_schedule ? 1 : 0,
  };
  // Хуваарь: маягтаас Улаанбаатарын цагаар ирнэ, UTC Date болгож хадгална.
  for (const s of sched.STEPS) {
    f[s.start] = fromUbInput(body[s.start]);
    f[s.end] = fromUbInput(body[s.end]);
  }
  const errors = [];
  if (!f.title) errors.push('Сонгуулийн нэрийг бичнэ үү.');
  errors.push(...sched.validateSchedule(f));
  return { f, errors };
}

async function renderManage(req, res, e, extra = {}) {
  const [candidates] = await pool.query(
    `SELECT c.*, u.surname, u.name, u.phone, s.name AS school_name,
       (SELECT COUNT(*) FROM nominations n WHERE n.candidate_id = c.id) AS nomination_count
     FROM candidates c JOIN users u ON u.id = c.user_id LEFT JOIN schools s ON s.id = u.school_id
     WHERE c.election_id = ? ORDER BY FIELD(c.status,'accepted','pending','declined'), c.votes DESC, u.name`,
    [e.id]
  );
  const [[{ ballots }]] = await pool.query('SELECT COUNT(*) AS ballots FROM ballots WHERE election_id = ?', [e.id]);
  // Дууссан сонгуулийн үр дүн: сонгогдсон гишүүд + зөвлөлд орсон / томилогдсон эсэх
  let results = null;
  if (e.phase === 'closed') {
    const stats = await electionStats(e);
    const winners = (stats.candidates || []).filter((c) => c.winner);
    if (winners.length) {
      const [rows] = await pool.query(
        `SELECT c.id AS cid, u.id AS user_id, u.surname, u.name AS first_name, u.phone, u.photo_v, b.id AS member_id, b.post, b.position
         FROM candidates c JOIN users u ON u.id = c.user_id
         LEFT JOIN board_members b ON b.user_id = c.user_id AND b.election_id = c.election_id
         WHERE c.id IN (?)`,
        [winners.map((w) => w.id)]
      );
      const byId = new Map(rows.map((r) => [r.cid, r]));
      for (const w of winners) Object.assign(w, byId.get(w.id));
    }
    results = {
      winners, tie: stats.tie, tiedOut: (stats.candidates || []).filter((c) => c.tiedOut),
      ballots: stats.ballots, eligible: stats.eligible, turnout: stats.turnout,
      minTurnout: stats.minTurnout, quorumMet: stats.quorumMet, invalid: stats.invalid,
    };
  }
  res.status(extra.errors && extra.errors.length ? 400 : 200).render('admin/election-manage', {
    title: e.title, e, form: extra.form || e, errors: extra.errors || [], candidates, ballots, results, PHASES, PHASE_LABELS,
    rd: await sched.readiness(e), blocked: await sched.blockReason(e),
    auto: sched.hasSchedule(e), deadline: sched.nextDeadline(e), times: sched.stepTimes(e),
  });
}

router.get('/elections', wrap(async (req, res) => {
  await sched.syncAll();
  const [elections] = await pool.query(
    `SELECT e.*,
      (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id) AS candidate_count,
      (SELECT COUNT(*) FROM ballots b WHERE b.election_id = e.id) AS ballot_count
     FROM elections e ORDER BY e.created_at DESC`
  );
  const cur = await board.currentElection();
  for (const e of elections) e.status = board.electionStatus(e, cur);
  res.render('admin/elections', { title: 'Удирдах зөвлөл — Сонгууль', elections });
}));

router.get('/elections/new', (req, res) => {
  res.render('admin/election-form', {
    title: 'Шинэ сонгууль',
    errors: [],
    e: {
      title: 'Төгсөгчдийн удирдах зөвлөлийн сонгууль',
      description: '',
      seats: 7,
      max_choices: 7,
      min_turnout: 50,
      show_live_results: 1,
      auto_schedule: 0,
    },
  });
});

router.post('/elections', wrap(async (req, res) => {
  const { f, errors } = electionFields(req.body);
  if (errors.length) {
    return res.status(400).render('admin/election-form', { title: 'Шинэ сонгууль', e: f, errors });
  }
  f.number = await board.nextElectionNumber(h.ubInput(new Date()).slice(0, 4));
  const [r] = await pool.query('INSERT INTO elections SET ?', [f]);
  await board.seedElection({ id: r.insertId, seats: f.seats });
  flash(req, 'success', `№ ${f.number} сонгууль үүслээ. ` + (f.auto_schedule
    ? 'Хуваарийн дагуу шатууд автоматаар солигдоно.'
    : 'Бэлэн болмогц "Нэр дэвшүүлэх" шатыг эхлүүлнэ үү.'));
  res.redirect(`/admin/elections/${r.insertId}`);
}));

router.get('/elections/:id', wrap(async (req, res, next) => {
  let [[e]] = await pool.query('SELECT * FROM elections WHERE id = ?', [req.params.id]);
  if (!e) return next();
  e = await sched.syncElection(e);
  await renderManage(req, res, e);
}));

router.post('/elections/:id', wrap(async (req, res, next) => {
  const [[e]] = await pool.query('SELECT * FROM elections WHERE id = ?', [req.params.id]);
  if (!e) return next();
  if (e.phase === 'closed') {
    flash(req, 'error', 'Сонгуулийн үр дүн гарсан тул тохиргоог өөрчлөх боломжгүй.');
    return res.redirect(`/admin/elections/${e.id}`);
  }
  const { f, errors } = electionFields(req.body);
  if (errors.length) return renderManage(req, res, e, { form: { ...e, ...f }, errors });
  await pool.query('UPDATE elections SET ? WHERE id = ?', [f, e.id]);
  const [[fresh]] = await pool.query('SELECT * FROM elections WHERE id = ?', [e.id]);
  const synced = await sched.syncElection(fresh);
  flash(req, 'success', synced.phase !== e.phase
    ? `Тохиргоо хадгалагдлаа. Хуваарийн дагуу шат "${PHASE_LABELS[synced.phase]}" боллоо.`
    : 'Сонгуулийн тохиргоо хадгалагдлаа.');
  res.redirect(`/admin/elections/${e.id}`);
}));

router.post('/elections/:id/phase', wrap(async (req, res, next) => {
  const [[e]] = await pool.query('SELECT * FROM elections WHERE id = ?', [req.params.id]);
  if (!e) return next();
  const back = `/admin/elections/${e.id}`;
  const target = ['draft', ...PHASES].includes(req.body.phase) ? req.body.phase : null;
  const [[{ ballots }]] = await pool.query('SELECT COUNT(*) AS ballots FROM ballots WHERE election_id = ?', [e.id]);

  if (!target || target === e.phase) return res.redirect(back);
  if (sched.hasSchedule(e)) {
    flash(req, 'warn', 'Сонгууль хуваарийн дагуу автоматаар явж байна. Гараар удирдах бол тохиргооноос автомат горимыг унтраана уу.');
    return res.redirect(back);
  }
  if (ballots > 0 && !['voting', 'closed'].includes(target)) {
    flash(req, 'error', 'Санал өгөгдсөн тул өмнөх шат руу буцах боломжгүй.');
    return res.redirect(back);
  }
  const gate = sched.forwardGate(e.phase, target, await sched.readiness(e));
  if (gate) {
    flash(req, 'error', gate);
    return res.redirect(back);
  }
  if (target === 'voting') {
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

// Хуваарьтай сонгуулийг хугацаанаас нь өмнө дараагийн шат руу шилжүүлэх:
// дараагийн шатны эхлэхийг "одоо", өмнөх шатны дуусахыг "одоо" болгоно (дуусах хугацаанууд хэвээр).
router.post('/elections/:id/advance', wrap(async (req, res, next) => {
  let [[e]] = await pool.query('SELECT * FROM elections WHERE id = ?', [req.params.id]);
  if (!e) return next();
  const back = `/admin/elections/${e.id}`;
  e = await sched.syncElection(e);
  if (!sched.hasSchedule(e)) return res.redirect(back);
  const target = { draft: 'nomination', nomination: 'acceptance', acceptance: 'voting', voting: 'closed' }[e.phase];
  if (!target) return res.redirect(back);

  const gate = sched.forwardGate(e.phase, target, await sched.readiness(e));
  if (gate) {
    flash(req, 'error', gate);
    return res.redirect(back);
  }
  // MySQL DATETIME миллисекундийг дээш тоймлодог тул бүхэл секунд хүртэл тайрна.
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const earlier = (d) => (d && new Date(d) < now ? new Date(d) : now);
  const upd = {};
  if (target === 'nomination') {
    upd.nomination_start = now;
  } else if (target === 'acceptance') {
    upd.nomination_end = earlier(e.nomination_end);
    upd.acceptance_start = now;
  } else if (target === 'voting') {
    upd.nomination_end = earlier(e.nomination_end);
    upd.acceptance_end = earlier(e.acceptance_end);
    upd.voting_start = now;
  } else {
    upd.voting_end = now;
  }
  // Шинэ шатны дуусах хугацаа өнгөрсөн байвал (ер нь болохгүй) 1 цаг сунгана.
  const endKey = { nomination: 'nomination_end', acceptance: 'acceptance_end', voting: 'voting_end' }[target];
  if (endKey && new Date(e[endKey]) <= now) upd[endKey] = new Date(now.getTime() + 3600e3);

  await pool.query('UPDATE elections SET ? WHERE id = ?', [upd, e.id]);
  const [[fresh]] = await pool.query('SELECT * FROM elections WHERE id = ?', [e.id]);
  const synced = await sched.syncElection(fresh);
  flash(req, 'success', `"${PHASE_LABELS[synced.phase]}" шат одоо эхэллээ. Хуваарь шинэчлэгдсэн.`);
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
  for (const t of ['board_units', 'board_members', 'board_posts', 'board_documents']) {
    await pool.query(`DELETE FROM ${t} WHERE election_id = ?`, [req.params.id]);
  }
  await pool.query('DELETE FROM elections WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Сонгууль устгагдлаа.');
  res.redirect('/admin/elections');
}));

module.exports = router;

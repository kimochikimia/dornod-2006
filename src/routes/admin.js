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
router.use('/board', requirePerm('manage_board'));
router.use('/documents', requirePerm('manage_board'));
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

// ---------- Зөвлөлийн баримт бичиг ----------
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

async function loadDocForm(id) {
  const [[d]] = await pool.query(
    `SELECT id, sort_order, title, purpose, status, doc_number, decision, content, file_name, file_size,
            draft_name, draft_size, DATE_FORMAT(draft_at, '%Y.%m.%d') AS draft_at,
            DATE_FORMAT(approved_at, '%Y-%m-%d') AS approved_at FROM board_documents WHERE id = ?`, [id]);
  return d || null;
}

router.get('/documents', wrap(async (req, res) => {
  const [docs] = await pool.query(
    `SELECT id, sort_order, title, purpose, status, doc_number, file_name, file_size,
            draft_name, draft_size, DATE_FORMAT(draft_at, '%Y.%m.%d') AS draft_at,
            DATE_FORMAT(approved_at, '%Y.%m.%d') AS approved_at, CHAR_LENGTH(COALESCE(content, '')) AS content_len
     FROM board_documents ORDER BY sort_order, id`
  );
  res.render('admin/documents', { title: 'Баримт бичиг — Удирдлага', docs });
}));

router.get('/documents/new', wrap(async (req, res) => {
  const [[{ next }]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM board_documents');
  res.render('admin/document-form', { title: 'Шинэ баримт бичиг', d: { sort_order: next, status: 'draft' }, errors: [] });
}));

router.get('/documents/:id', wrap(async (req, res, next) => {
  const d = await loadDocForm(req.params.id);
  if (!d) return next();
  res.render('admin/document-form', { title: d.title, d, errors: [] });
}));

async function saveDocument(req, res, id) {
  const f = documentFields(req.body);
  const errors = [];
  if (!f.title) errors.push('Баримт бичгийн нэрийг бичнэ үү.');
  if (f.status === 'approved' && !f.approved_at) errors.push('Батлагдсан огноог оруулна уу.');
  if (f.status === 'approved' && !f.content && !req.body.file_data && !(id && (await loadDocForm(id)).file_name)) {
    errors.push('Батлагдсан баримт бичигт агуулга бичих эсвэл файл хавсаргана уу.');
  }
  const file = parseDocFile(req.body.file_data, req.body.file_name);
  if (file && file.error) errors.push(file.error);
  if (errors.length) {
    const existing = id ? await loadDocForm(id) : {};
    return res.status(400).render('admin/document-form', { title: f.title || 'Баримт бичиг', d: { ...existing, ...f, id }, errors });
  }
  let docId = id;
  if (id) await pool.query('UPDATE board_documents SET ? WHERE id = ?', [f, id]);
  else [{ insertId: docId }] = await pool.query('INSERT INTO board_documents SET ?', [f]);
  if (file) {
    await pool.query('UPDATE board_documents SET file_name = ?, file_mime = ?, file_size = ?, file_data = ? WHERE id = ?',
      [file.name, file.mime, file.buf.length, file.buf, docId]);
  } else if (req.body.remove_file) {
    await pool.query('UPDATE board_documents SET file_name = NULL, file_mime = NULL, file_size = NULL, file_data = NULL WHERE id = ?', [docId]);
  }
  if (f.status === 'approved') {
    flash(req, 'success', `"${f.title}" батлагдсан баримт бичгээр нийтлэгдлээ.`);
  } else if (f.content || file || (id && (await loadDocForm(docId)).file_name)) {
    flash(req, 'warn', `"${f.title}" хадгалагдлаа. Төлөв нь "Батлагдаагүй" тул эцсийн хувилбар нийтэд харагдахгүй — нийтлэх бол "Батлагдсан" болгоно уу.`);
  } else {
    flash(req, 'success', `"${f.title}" хадгалагдлаа.`);
  }
  res.redirect('/admin/documents');
}

router.post('/documents', wrap(async (req, res) => saveDocument(req, res, null)));
router.post('/documents/:id', wrap(async (req, res, next) => {
  if (!(await loadDocForm(req.params.id))) return next();
  return saveDocument(req, res, Number(req.params.id));
}));

// Баримт бичгийн төсөл оруулах / солих / устгах
router.post('/documents/:id/draft', wrap(async (req, res, next) => {
  const d = await loadDocForm(req.params.id);
  if (!d) return next();
  const back = req.body.back === 'form' ? `/admin/documents/${d.id}` : '/admin/documents';
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

router.post('/documents/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM board_documents WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Баримт бичиг устгагдлаа.');
  res.redirect('/admin/documents');
}));

// ---------- Удирдах зөвлөл ----------
const board = require('../board');

function boardFields(body) {
  const post = board.POST_KEYS.includes(body.post) ? body.post : 'unassigned';
  const appointed = /^\d{4}-\d{2}-\d{2}$/.test(body.appointed_at || '') ? body.appointed_at : null;
  return {
    post,
    position: board.POST_BY_KEY[post].label,
    appointed_at: post === 'unassigned' ? null : appointed,
    decision: post === 'unassigned' ? null : clean(body.decision, 200) || null,
    responsibilities: clean(body.responsibilities, 3000) || null,
    term: clean(body.term, 50) || null,
  };
}

// Дарга, нарийн бичиг, санхүүч тус бүр ганц хүн: шинээр томилоход өмнөх хүн "Зөвлөлийн гишүүн" болно.
async function vacateSinglePost(post, exceptId) {
  const p = board.POST_BY_KEY[post];
  if (!p || !p.single) return [];
  const [prev] = await pool.query(
    `SELECT b.id, u.surname, u.name FROM board_members b JOIN users u ON u.id = b.user_id WHERE b.post = ? AND b.id <> ?`,
    [post, exceptId || 0]
  );
  if (prev.length) {
    await pool.query("UPDATE board_members SET post = 'member', position = ? WHERE id IN (?)",
      [board.POST_BY_KEY.member.label, prev.map((r) => r.id)]);
  }
  return prev;
}

router.get('/board', wrap(async (req, res) => {
  const [members] = await pool.query(
    `SELECT b.*, DATE_FORMAT(b.appointed_at, '%Y-%m-%d') AS appointed_at, u.surname, u.name, u.photo_v, s.name AS school_name
     FROM board_members b JOIN users u ON u.id = b.user_id LEFT JOIN schools s ON s.id = u.school_id
     ORDER BY ${board.POST_ORDER_SQL}, u.name`
  );
  const [candidates] = await pool.query(
    `SELECT u.id, u.surname, u.name, s.name AS school_name FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.status = 'approved' AND u.id NOT IN (SELECT user_id FROM board_members)
     ORDER BY u.name, u.surname`
  );
  const [closed] = await pool.query("SELECT id, title, voting_ended_at FROM elections WHERE phase = 'closed' ORDER BY voting_ended_at DESC");
  res.render('admin/board', {
    title: 'Удирдах зөвлөл — Удирдлага', members, candidates, closed, POSTS: board.POSTS, today: h.ubInput(new Date()).slice(0, 10),
  });
}));

router.post('/board', wrap(async (req, res) => {
  const userId = Number(req.body.user_id);
  const [[u]] = await pool.query("SELECT id, surname, name FROM users WHERE id = ? AND status = 'approved'", [userId]);
  if (!u) {
    flash(req, 'error', 'Баталгаажсан төгсөгч сонгоно уу.');
    return res.redirect('/admin/board');
  }
  const f = boardFields(req.body);
  try {
    const [r] = await pool.query('INSERT INTO board_members SET ?', [{ user_id: u.id, ...f }]);
    const prev = await vacateSinglePost(f.post, r.insertId);
    flash(req, 'success', `${u.surname} ${u.name} зөвлөлд нэмэгдлээ.` + (prev.length ? ` ${prev.map((p) => `${p.surname} ${p.name}`).join(', ')} "Зөвлөлийн гишүүн" боллоо.` : ''));
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    flash(req, 'warn', 'Энэ төгсөгч зөвлөлд аль хэдийн байна.');
  }
  res.redirect('/admin/board');
}));

// Дууссан сонгуулийн сонгогдсон гишүүдийг зөвлөлд нэмэх (албан тушаалгүйгээр — хурлаар томилно)
router.post('/board/import', wrap(async (req, res) => {
  const [[e]] = await pool.query("SELECT * FROM elections WHERE id = ? AND phase = 'closed'", [req.body.election_id]);
  if (!e) {
    flash(req, 'error', 'Дууссан сонгууль сонгоно уу.');
    return res.redirect('/admin/board');
  }
  const stats = await electionStats(e);
  const winners = (stats.candidates || []).filter((c) => c.winner);
  let added = 0;
  for (const w of winners) {
    const [[cand]] = await pool.query('SELECT user_id FROM candidates WHERE id = ?', [w.id]);
    const [r] = await pool.query(
      "INSERT IGNORE INTO board_members (user_id, post, position, election_id) VALUES (?, 'unassigned', ?, ?)",
      [cand.user_id, board.POST_BY_KEY.unassigned.label, e.id]
    );
    added += r.affectedRows;
  }
  flash(req, 'success', `"${e.title}"-оос ${winners.length} сонгогдсон гишүүн байна: ${added} нь шинээр нэмэгдлээ. Зөвлөлийн хурлын шийдвэрээр албан тушаалд томилно уу.`);
  res.redirect('/admin/board');
}));

// ---------- Зөвлөлийн бүтэц ----------
router.get('/board/structure', wrap(async (req, res) => {
  const { tree, flat } = await board.loadStructure();
  const [members] = await pool.query(
    `SELECT b.id, b.post, b.position, u.surname, u.name FROM board_members b JOIN users u ON u.id = b.user_id
     ORDER BY ${board.POST_ORDER_SQL}, u.name`
  );
  res.render('admin/board-structure', { title: 'Зөвлөлийн бүтэц — Удирдлага', tree, flat, members });
}));

async function saveUnit(req, res, id) {
  const back = '/admin/board/structure' + (id ? `#u${id}` : '');
  const name = clean(req.body.name, 150);
  if (!name) {
    flash(req, 'error', 'Нэгжийн нэрийг бичнэ үү.');
    return res.redirect(back);
  }
  const { flat } = await board.loadStructure();
  const byId = new Map(flat.map((u) => [u.id, u]));
  let parent = Number(req.body.parent_id) || null;
  if (parent && !byId.has(parent)) parent = null;
  if (id && parent && (parent === id || byId.get(id).descendants.includes(parent))) {
    flash(req, 'error', 'Нэгжийг өөрийнхөө эсвэл доод нэгжийнхээ доор оруулж болохгүй.');
    return res.redirect(back);
  }
  const [bm] = await pool.query('SELECT id FROM board_members');
  const valid = new Set(bm.map((m) => m.id));
  let head = Number(req.body.head_member_id) || null;
  if (head && !valid.has(head)) head = null;
  const memberIds = [...new Set([].concat(req.body.member_ids ?? []).map(Number))].filter((m) => valid.has(m));
  if (head && !memberIds.includes(head)) memberIds.unshift(head);
  const order = parseInt(req.body.sort_order, 10);
  const fields = {
    name, parent_id: parent, head_member_id: head,
    description: clean(req.body.description, 500) || null,
    sort_order: Number.isFinite(order) ? Math.max(0, Math.min(order, 9999)) : 100,
  };
  if (id) await pool.query('UPDATE board_units SET ? WHERE id = ?', [fields, id]);
  else id = (await pool.query('INSERT INTO board_units SET ?', [fields]))[0].insertId;
  await pool.query('DELETE FROM board_unit_members WHERE unit_id = ?', [id]);
  if (memberIds.length) {
    await pool.query('INSERT INTO board_unit_members (unit_id, member_id) VALUES ?', [memberIds.map((m) => [id, m])]);
  }
  flash(req, 'success', 'Бүтэц хадгалагдлаа.');
  res.redirect(`/admin/board/structure#u${id}`);
}

router.post('/board/structure', wrap(async (req, res) => saveUnit(req, res, null)));

router.post('/board/structure/:uid', wrap(async (req, res, next) => {
  const [[u]] = await pool.query('SELECT id FROM board_units WHERE id = ?', [req.params.uid]);
  if (!u) return next();
  return saveUnit(req, res, u.id);
}));

router.post('/board/structure/:uid/delete', wrap(async (req, res) => {
  const [[u]] = await pool.query('SELECT id, parent_id FROM board_units WHERE id = ?', [req.params.uid]);
  if (u) {
    // Дэд нэгжүүдийг устгахгүй — нэг түвшин дээш шилжүүлнэ.
    await pool.query('UPDATE board_units SET parent_id = ? WHERE parent_id = ?', [u.parent_id, u.id]);
    await pool.query('DELETE FROM board_units WHERE id = ?', [u.id]);
    flash(req, 'success', 'Нэгж устгагдлаа.');
  }
  res.redirect('/admin/board/structure');
}));

router.post('/board/:bid', wrap(async (req, res, next) => {
  const [[m]] = await pool.query('SELECT id FROM board_members WHERE id = ?', [req.params.bid]);
  if (!m) return next();
  const f = boardFields(req.body);
  await pool.query('UPDATE board_members SET ? WHERE id = ?', [f, m.id]);
  const prev = await vacateSinglePost(f.post, m.id);
  flash(req, 'success', 'Томилгоо хадгалагдлаа.' + (prev.length ? ` ${prev.map((p) => `${p.surname} ${p.name}`).join(', ')} "Зөвлөлийн гишүүн" боллоо.` : ''));
  res.redirect(`/admin/board#m${m.id}`);
}));

router.post('/board/:bid/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM board_members WHERE id = ?', [req.params.bid]);
  flash(req, 'success', 'Зөвлөлөөс хасагдлаа.');
  res.redirect('/admin/board');
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
  res.status(extra.errors && extra.errors.length ? 400 : 200).render('admin/election-manage', {
    title: e.title, e, form: extra.form || e, errors: extra.errors || [], candidates, ballots, PHASES, PHASE_LABELS,
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
  res.render('admin/elections', { title: 'Сонгууль — Админ', elections });
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
  const [r] = await pool.query('INSERT INTO elections SET ?', [f]);
  flash(req, 'success', f.auto_schedule
    ? 'Сонгууль үүслээ. Хуваарийн дагуу шатууд автоматаар солигдоно.'
    : 'Сонгууль үүслээ. Бэлэн болмогц "Нэр дэвшүүлэх" шатыг эхлүүлнэ үү.');
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

  if (target === 'voting') {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM candidates WHERE election_id = ? AND status = 'accepted'", [e.id]);
    if (n === 0) {
      flash(req, 'error', 'Зөвшөөрсөн нэр дэвшигч байхгүй тул санал хураалт эхлүүлэх боломжгүй.');
      return res.redirect(back);
    }
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
  await pool.query('DELETE FROM elections WHERE id = ?', [req.params.id]);
  flash(req, 'success', 'Сонгууль устгагдлаа.');
  res.redirect('/admin/elections');
}));

module.exports = router;

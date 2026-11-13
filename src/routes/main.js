const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { flash, wrap, requireLogin, requirePerm, can } = require('../middleware');
const { clean, employmentKey } = require('../helpers');
const h = require('../helpers');
const LOC = require('../locations');
const plan = require('../plan');
const rx = require('../reactions');
const gallery = require('../gallery');
const sched = require('../electionSchedule');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  const [news] = await pool.query(
    `SELECT a.id, a.title, a.body, a.pinned, a.created_at,
            (SELECT p.id FROM news_photos p WHERE p.announcement_id = a.id ORDER BY p.id LIMIT 1) AS cover_id,
            (SELECT COUNT(*) FROM news_photos p WHERE p.announcement_id = a.id) AS photo_count
     FROM announcements a ORDER BY a.pinned DESC, a.created_at DESC LIMIT 4`
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
  const photos = await gallery.latestPhotos(req.user, 9);
  const albums = await gallery.visibleAlbums(req.user, 6);
  const galleryCounts = await gallery.visibleCounts(req.user);
  const planItems = await plan.loadItems();
  const timeline = plan.buildTimeline(planItems);
  const monthly = timeline ? plan.buildMonthly(planItems, plan.defaultYear(planItems)) : null;
  res.render('index', { title: 'Нүүр', news, stats, election, deadline: election ? sched.nextDeadline(election) : null, photos, albums, galleryCounts, timeline, monthly });
}));

router.get('/news', wrap(async (req, res) => {
  const [news] = await pool.query(
    `SELECT a.id, a.title, a.body, a.pinned, a.created_at,
            (SELECT COUNT(*) FROM news_comments c WHERE c.announcement_id = a.id) AS comment_count,
            (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'news' AND r.target_id = a.id) AS reaction_count,
            (SELECT p.id FROM news_photos p WHERE p.announcement_id = a.id ORDER BY p.id LIMIT 1) AS cover_id,
            (SELECT COUNT(*) FROM news_photos p WHERE p.announcement_id = a.id) AS photo_count
     FROM announcements a ORDER BY a.pinned DESC, a.created_at DESC`
  );
  res.render('news/list', { title: 'Мэдээ, зарлал', news });
}));

router.get('/news/:id', wrap(async (req, res, next) => {
  const [[item]] = await pool.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
  if (!item) return next();
  const [comments] = await pool.query(
    `SELECT c.id, c.user_id, c.body, c.created_at, u.surname, u.name, u.photo_v
     FROM news_comments c JOIN users u ON u.id = c.user_id
     WHERE c.announcement_id = ? ORDER BY c.created_at, c.id`,
    [item.id]
  );
  const uid = req.user && req.user.id;
  const newsReact = await rx.loadOne('news', item.id, uid);
  const commentReact = await rx.loadReactions('comment', comments.map((c) => c.id), uid);
  const [photos] = await pool.query('SELECT id, width, height FROM news_photos WHERE announcement_id = ? ORDER BY id', [item.id]);
  res.render('news/show', { title: item.title, item, comments, newsReact, commentReact, photos });
}));

// Мэдээний зураг (мэдээ нийтэд нээлттэй): ?s=t бол жижиг хувилбар
router.get('/news/photo/:id', wrap(async (req, res, next) => {
  const thumb = req.query.s === 't';
  const [[p]] = await pool.query(`SELECT ${thumb ? 'thumb' : 'data'} AS img FROM news_photos WHERE id = ?`, [req.params.id]);
  if (!p) return next();
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(p.img);
}));

// Сэтгэгдэл бичих: нэвтэрсэн хэрэглэгч (татгалзсан бүртгэлээс бусад)
router.post('/news/:id/comments', requireLogin, wrap(async (req, res, next) => {
  const [[item]] = await pool.query('SELECT id FROM announcements WHERE id = ?', [req.params.id]);
  if (!item) return next();
  const back = `/news/${item.id}#comments`;
  if (req.user.status === 'rejected') {
    flash(req, 'error', 'Таны бүртгэл татгалзсан тул сэтгэгдэл бичих боломжгүй.');
    return res.redirect(back);
  }
  const body = clean(req.body.body, 2000);
  if (!body) {
    flash(req, 'error', 'Сэтгэгдлээ бичнэ үү.');
    return res.redirect(back);
  }
  const [[recent]] = await pool.query(
    'SELECT COUNT(*) AS n FROM news_comments WHERE user_id = ? AND created_at > NOW() - INTERVAL 15 SECOND', [req.user.id]
  );
  if (recent.n) {
    flash(req, 'warn', 'Түр хүлээгээд дахин бичнэ үү.');
    return res.redirect(back);
  }
  const [r] = await pool.query('INSERT INTO news_comments (announcement_id, user_id, body) VALUES (?, ?, ?)', [item.id, req.user.id, body]);
  res.redirect(`/news/${item.id}#c${r.insertId}`);
}));

// Сэтгэгдэл устгах: өөрийнхөө эсвэл мэдээ удирдах эрхтэй бол
router.post('/news/:id/comments/:cid/delete', requireLogin, wrap(async (req, res) => {
  const [[c]] = await pool.query('SELECT id, user_id FROM news_comments WHERE id = ? AND announcement_id = ?', [req.params.cid, req.params.id]);
  if (c && (c.user_id === req.user.id || can(req.user, 'manage_news'))) {
    await pool.query('DELETE FROM news_comments WHERE id = ?', [c.id]);
    await rx.deleteFor('comment', [c.id]);
    flash(req, 'success', 'Сэтгэгдэл устгагдлаа.');
  }
  res.redirect(`/news/${Number(req.params.id)}#comments`);
}));

// Reaction дарах / солих / буцаах. JS-ээс дуудвал шинэчилсэн мөрийн HTML-ийг буцаана.
router.post('/react', requireLogin, wrap(async (req, res) => {
  const wantsJson = (req.get('Accept') || '').includes('application/json');
  const type = rx.TYPES.includes(req.body.type) ? req.body.type : null;
  const id = Number(req.body.id) || 0;
  const emoji = rx.REACTION_KEYS.includes(req.body.emoji) ? req.body.emoji : '';
  const back = typeof req.body.back === 'string' && req.body.back.startsWith('/') && !req.body.back.startsWith('//') ? req.body.back : '/news';
  const fail = (code, msg) => (wantsJson ? res.status(code).json({ error: msg }) : (flash(req, 'error', msg), res.redirect(back)));
  if (!type || !id || !(await rx.targetExists(type, id))) return fail(404, 'Олдсонгүй.');
  if (req.user.status === 'rejected') return fail(403, 'Таны бүртгэл татгалзсан байна.');
  await rx.setReaction(type, id, req.user.id, emoji);
  if (!wantsJson) return res.redirect(back);
  const r = await rx.loadOne(type, id, req.user.id);
  res.render('partials/reactions', { type, id, r, back, small: type === 'comment' }, (err, html) => {
    if (err) return res.status(500).json({ error: 'Алдаа гарлаа.' });
    res.json({ html });
  });
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

// Төгсөгчийн зураг: зөвхөн нэвтэрсэн хэрэглэгчид
router.get('/photos/:id', requireLogin, wrap(async (req, res, next) => {
  const [[p]] = await pool.query('SELECT mime, data FROM user_photos WHERE user_id = ?', [req.params.id]);
  if (!p) return next();
  res.set('Content-Type', p.mime);
  res.set('Cache-Control', 'private, max-age=604800'); // ?v= өөрчлөгдөхөд шинэчлэгдэнэ
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(p.data);
}));

// ---------- Фото альбом ----------
router.get('/gallery', wrap(async (req, res) => {
  res.render('gallery/list', { title: 'Фото альбом', albums: await gallery.visibleAlbums(req.user) });
}));

router.get('/gallery/:id', wrap(async (req, res, next) => {
  const album = await gallery.getAlbum(req.params.id);
  if (!gallery.canView(album, req.user)) {
    if (album && !req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return next();
  }
  res.render('gallery/album', { title: album.title, album, photos: await gallery.albumPhotos(album.id) });
}));

// Зураг: ?s=t бол жижиг хувилбар. Нийтийн альбомынх хэн ч, бусдынх зөвхөн баталгаажсан төгсөгчид.
router.get('/gallery/photo/:id', wrap(async (req, res, next) => {
  const thumb = req.query.s === 't';
  const [[p]] = await pool.query(
    `SELECT ${thumb ? 'p.thumb' : 'p.data'} AS img, a.is_public FROM gallery_photos p JOIN gallery_albums a ON a.id = p.album_id WHERE p.id = ?`,
    [req.params.id]
  );
  if (!p || !gallery.canView(p, req.user)) return next();
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', `${p.is_public ? 'public' : 'private'}, max-age=2592000, immutable`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(p.img);
}));

// Төгсөгчдийн товчоо статистик (бүх баталгаажсан хэрэглэгчээр, шүүлтүүрээс үл хамаарна).
// full=false (нэвтрээгүй) үед ажил эрхлэлт, хот, мэргэжлийн задаргааг гаргахгүй.
async function memberStats(full) {
  const [rows] = await pool.query(
    `SELECT u.gender, u.school_id, u.employment, u.city, u.professions, u.created_at, u.photo_v, u.facebook, u.email, u.workplace, s.name AS school_name, s.sort_order
     FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.status = 'approved'`
  );
  const total = rows.length;
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const gender = { male: 0, female: 0, unknown: 0 };
  const bySchool = new Map();
  const byEmp = {};
  const byCity = {};
  let mnCount = 0;
  let abroadCount = 0;
  const byProf = {};
  const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
  let recent = 0;
  for (const r of rows) {
    const g = r.gender === 'male' || r.gender === 'female' ? r.gender : 'unknown';
    gender[g]++;
    if (new Date(r.created_at).getTime() >= monthAgo) recent++;
    const sk = r.school_id || 0;
    if (!bySchool.has(sk)) bySchool.set(sk, { id: r.school_id, name: r.school_name || 'Сургууль тодорхойгүй', order: r.sort_order ?? 9999, n: 0, male: 0, female: 0 });
    const s = bySchool.get(sk);
    s.n++;
    if (g !== 'unknown') s[g]++;
    if (r.employment) byEmp[r.employment] = (byEmp[r.employment] || 0) + 1;
    const place = LOC.placeGroup(r.city);
    if (place) {
      if (!byCity[place.key]) byCity[place.key] = { label: (place.abroad ? '🌐 ' : '') + place.label, n: 0 };
      byCity[place.key].n++;
      if (place.abroad) abroadCount++; else mnCount++;
    }
    const fields = new Set(h.readProfessions(r).map((p) => p.field).filter(Boolean));
    for (const f of fields) byProf[f] = (byProf[f] || 0) + 1;
  }
  const list = (obj, label) => Object.entries(obj)
    .map(([k, n]) => ({ key: k, label: label ? label(k) : k, n, pct: pct(n) }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const schools = [...bySchool.values()]
    .map((s) => ({ ...s, pct: pct(s.n) }))
    .sort((a, b) => b.n - a.n || a.order - b.order);
  const [[{ pending }]] = await pool.query("SELECT COUNT(*) AS pending FROM users WHERE status = 'pending'");
  const [[{ schoolTotal }]] = await pool.query('SELECT COUNT(*) AS schoolTotal FROM schools');
  // Мэдээллийн бүрдэл: талбар бүрийг бөглөсөн хүний тоо
  const filled = (fn) => rows.filter(fn).length;
  const completeness = [
    ['Зурагтай', (r) => r.photo_v],
    ['Хүйс', (r) => r.gender],
    ['Ажил эрхлэлт', (r) => r.employment],
    ['Мэргэжил', (r) => h.readProfessions(r).length],
    ['Амьдарч буй газар', (r) => (r.city || '').trim()],
    ['Ажлын газар', (r) => (r.workplace || '').trim()],
    ['Facebook', (r) => r.facebook],
    ['И-мэйл', (r) => r.email],
  ].map(([label, fn]) => { const n = filled(fn); return { label, n, pct: pct(n) }; });
  const fullProfiles = filled((r) => r.photo_v && r.gender && r.employment && h.readProfessions(r).length && (r.city || '').trim());
  const cityList = Object.values(byCity)
    .map((c) => ({ label: c.label, n: c.n, pct: pct(c.n) }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const profList = list(byProf, (k) => h.PROFESSION_LABELS[k] || k);
  const working = ['public', 'private', 'business', 'abroad'].reduce((a, k) => a + (byEmp[k] || 0), 0);
  const empFilled = Object.values(byEmp).reduce((a, b) => a + b, 0);
  return {
    pending, schoolTotal, mnCount, abroadCount, completeness, fullProfiles, fullPct: pct(fullProfiles),
    cityCount: cityList.length, topCity: cityList[0] || null,
    cityFilled: cityList.reduce((a, c) => a + c.n, 0),
    working, workingPct: empFilled ? Math.round((working / empFilled) * 100) : 0,
    abroad: byEmp.abroad || 0, empFilledCount: empFilled,
    profCount: profList.length, topProf: profList[0] || null,
    total, recent, gender, genderPct: { male: pct(gender.male), female: pct(gender.female), unknown: pct(gender.unknown) },
    schools, schoolCount: schools.filter((s) => s.id).length,
    full,
    employment: full ? list(byEmp, (k) => h.EMPLOYMENT_LABELS[k] || k) : [],
    employmentFilled: full ? Object.values(byEmp).reduce((a, b) => a + b, 0) : 0,
    cities: full ? cityList : [],
    professions: full ? profList : [],
  };
}

router.get('/members', wrap(async (req, res) => {
  const guest = !req.user; // бүртгэлгүй: зөвхөн нэр, сургууль
  const q = clean(req.query.q, 80);
  const school = Number(req.query.school) || null;
  const employment = guest ? null : employmentKey(req.query.employment);
  const where = ["u.status = 'approved'"];
  const params = [];
  if (q && guest) {
    where.push('(u.name LIKE ? OR u.surname LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  } else if (q) {
    where.push('(u.name LIKE ? OR u.surname LIKE ? OR u.occupation LIKE ? OR u.workplace LIKE ? OR u.city LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (school) {
    where.push('u.school_id = ?');
    params.push(school);
  }
  if (employment) {
    where.push('u.employment = ?');
    params.push(employment);
  }
  const [members] = await pool.query(
    `SELECT u.id, u.surname, u.name, u.class_name, u.role, u.photo_v, s.name AS school_name
            ${guest ? '' : ', u.occupation, u.employment, u.workplace, u.city'}
     FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE ${where.join(' AND ')} ORDER BY s.sort_order, u.name`,
    params
  );
  const [schools] = await pool.query('SELECT * FROM schools ORDER BY sort_order, name');
  const stats = await memberStats(!guest);
  res.render('members/list', { title: 'Төгсөгчид', members, schools, q, school, employment, stats });
}));

router.get('/members/:id', requireLogin, wrap(async (req, res, next) => {
  const [[member]] = await pool.query(
    `SELECT u.id, u.surname, u.name, u.gender, u.phone, u.email, u.facebook, u.photo_v, u.class_name, u.occupation, u.professions, u.employment, u.workplace, u.position_level, u.position,
            u.city, u.bio, u.role, u.created_at,
            s.name AS school_name
     FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.id = ? AND u.status = 'approved'`,
    [req.params.id]
  );
  if (!member) return next();
  if (!can(req.user, 'view_contacts')) {
    member.phone = null;
    member.email = null;
    member.facebook = null;
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

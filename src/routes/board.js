const express = require('express');
const { pool } = require('../db');
const { wrap, can, requireMember } = require('../middleware');
const sched = require('../electionSchedule');
const board = require('../board');

const router = express.Router();

// Удирдах зөвлөл: гишүүд + явагдаж буй сонгууль (дээр) + сонгуулийн түүх (доор)
router.get('/', wrap(async (req, res) => {
  await sched.syncAll();
  const showContacts = can(req.user, 'view_contacts');

  const [members] = await pool.query(
    `SELECT b.id, b.user_id, b.post, b.position, b.responsibilities, b.term, b.decision,
            DATE_FORMAT(b.appointed_at, '%Y.%m.%d') AS appointed_at,
            u.surname, u.name, u.class_name, u.occupation, u.city, u.photo_v, u.phone, u.email, u.facebook,
            s.name AS school_name
     FROM board_members b JOIN users u ON u.id = b.user_id
     LEFT JOIN schools s ON s.id = u.school_id
     ORDER BY ${board.POST_ORDER_SQL}, u.name`
  );
  if (!showContacts) for (const m of members) { m.phone = null; m.email = null; m.facebook = null; }

  const isManager = can(req.user, 'manage_elections');
  const [elections] = await pool.query(
    `SELECT e.*,
       (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id AND c.status='accepted') AS accepted_count,
       (SELECT COUNT(*) FROM ballots b WHERE b.election_id = e.id) AS ballot_count
     FROM elections e ${isManager ? '' : "WHERE e.phase <> 'draft' OR e.auto_schedule = 1"}
     ORDER BY e.created_at DESC`
  );
  const active = elections.filter((e) => ['nomination', 'acceptance', 'voting'].includes(e.phase) || (e.phase === 'draft' && sched.hasSchedule(e)));
  const others = elections.filter((e) => !active.includes(e));
  for (const e of active) e.deadline = sched.nextDeadline(e);

  const [documents] = await pool.query(
    `SELECT id, sort_order, title, purpose, status, doc_number, DATE_FORMAT(approved_at, '%Y.%m.%d') AS approved_at, file_name,
            draft_name IS NOT NULL AS has_draft
     FROM board_documents ORDER BY sort_order, id`
  );

  res.render('board', {
    title: 'Удирдах зөвлөл', members, active, others, documents });
}));

// Баримт бичиг унших
async function getDocument(req, withFile = false) {
  const [[d]] = await pool.query(
    `SELECT id, sort_order, title, purpose, status, doc_number, decision, content, file_name, file_mime, file_size,
            draft_name, draft_mime, draft_size, DATE_FORMAT(draft_at, '%Y.%m.%d') AS draft_at,
            DATE_FORMAT(approved_at, '%Y.%m.%d') AS approved_at, updated_at${withFile === 'file' ? ', file_data' : withFile === 'draft' ? ', draft_data' : ''}
     FROM board_documents WHERE id = ?`,
    [req.params.id]
  );
  return d || null;
}

router.get('/documents/:id', wrap(async (req, res, next) => {
  const d = await getDocument(req);
  if (!d) return next();
  const canEdit = can(req.user, 'manage_board');
  const [siblings] = await pool.query('SELECT id, sort_order, title, status FROM board_documents ORDER BY sort_order, id');
  res.render('document', {
    title: d.title, d, canEdit, siblings,
    showDraft: d.status === 'approved' || canEdit,
    canGetDraft: !!(req.user && req.user.status === 'approved'),
  });
}));

function sendDoc(req, res, buf, mime, name) {
  res.set('Content-Type', mime);
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=300');
  res.send(buf);
}

// Батлагдсан баримт: хэн ч үзэж, татаж авна
router.get('/documents/:id/file', wrap(async (req, res, next) => {
  const d = await getDocument(req, 'file');
  if (!d || !d.file_data) return next();
  if (d.status !== 'approved' && !can(req.user, 'manage_board')) return next();
  sendDoc(req, res, d.file_data, d.file_mime, d.file_name);
}));

// Төсөл: зөвхөн нэвтэрсэн, баталгаажсан төгсөгчид
router.get('/documents/:id/draft', requireMember, wrap(async (req, res, next) => {
  const d = await getDocument(req, 'draft');
  if (!d || !d.draft_data) return next();
  sendDoc(req, res, d.draft_data, d.draft_mime, d.draft_name);
}));

module.exports = router;

const express = require('express');
const { pool } = require('../db');
const { flash, wrap, requireMember, requirePerm, can } = require('../middleware');
const { clean } = require('../helpers');
const { electionStats } = require('../electionStats');
const sched = require('../electionSchedule');

const router = express.Router();

// Хуваарьтай сонгуулийн шатыг шинэчилж буцаана. Ноорог нь зөвхөн удирдлагад,
// харин хуваарьтай (эхлээгүй) сонгууль нийтэд харагдана.
async function getElection(req) {
  let [[e]] = await pool.query('SELECT * FROM elections WHERE id = ?', [req.params.id]);
  if (!e) return null;
  e = await sched.syncElection(e);
  if (e.phase === 'draft' && !sched.hasSchedule(e) && !can(req.user, 'manage_elections')) return null;
  return e;
}

router.get('/', wrap(async (req, res) => {
  await sched.syncAll();
  const isAdmin = can(req.user, 'manage_elections');
  const [elections] = await pool.query(
    `SELECT e.*,
       (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id AND c.status='accepted') AS accepted_count,
       (SELECT COUNT(*) FROM ballots b WHERE b.election_id = e.id) AS ballot_count
     FROM elections e ${isAdmin ? '' : "WHERE e.phase <> 'draft' OR e.auto_schedule = 1"}
     ORDER BY e.created_at DESC`
  );
  res.render('elections/list', { title: 'Сонгууль', elections });
}));

router.get('/:id', wrap(async (req, res, next) => {
  const e = await getElection(req);
  if (!e) return next();

  const [candidates] = await pool.query(
    `SELECT c.*, u.surname, u.name, u.occupation, u.class_name, u.photo_v, s.name AS school_name,
            (SELECT COUNT(*) FROM nominations n WHERE n.candidate_id = c.id) AS nomination_count
     FROM candidates c JOIN users u ON u.id = c.user_id
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE c.election_id = ?
     ORDER BY FIELD(c.status,'accepted','pending','declined'), nomination_count DESC, u.name`,
    [e.id]
  );
  const [nominations] = await pool.query(
    `SELECT n.candidate_id, n.reason, n.created_at, n.nominator_id, u.surname, u.name
     FROM nominations n JOIN candidates c ON c.id = n.candidate_id
     JOIN users u ON u.id = n.nominator_id
     WHERE c.election_id = ? ORDER BY n.created_at`,
    [e.id]
  );
  const nomsByCandidate = {};
  for (const n of nominations) (nomsByCandidate[n.candidate_id] ||= []).push(n);

  let myCandidacy = null;
  let hasVoted = false;
  let members = [];
  let myNominations = new Set();
  if (req.user && req.user.status === 'approved') {
    myCandidacy = candidates.find((c) => c.user_id === req.user.id) || null;
    const [[b]] = await pool.query('SELECT id FROM ballots WHERE election_id = ? AND voter_id = ?', [e.id, req.user.id]);
    hasVoted = !!b;
    myNominations = new Set(nominations.filter((n) => n.nominator_id === req.user.id).map((n) => n.candidate_id));
    if (sched.windowOpen(e, 'nominate')) {
      [members] = await pool.query(
        `SELECT u.id, u.surname, u.name, s.name AS school_name FROM users u
         LEFT JOIN schools s ON s.id = u.school_id
         WHERE u.status = 'approved' ORDER BY u.name, u.surname`
      );
    }
  }

  const counts = { accepted: 0, pending: 0, declined: 0 };
  for (const c of candidates) counts[c.status]++;

  const stats = ['voting', 'closed'].includes(e.phase) ? await electionStats(e) : null;

  res.render('elections/show', {
    title: e.title,
    e,
    candidates,
    nomsByCandidate,
    myCandidacy,
    myNominations,
    hasVoted,
    members,
    counts,
    nominationTotal: nominations.length,
    stats,
    windows: { nominate: sched.windowOpen(e, 'nominate'), respond: sched.windowOpen(e, 'respond'), vote: sched.windowOpen(e, 'vote') },
    deadline: sched.nextDeadline(e),
    times: sched.stepTimes(e),
  });
}));

router.get('/:id/live.json', wrap(async (req, res) => {
  const e = await getElection(req);
  if (!e) return res.status(404).json({ error: 'not found' });
  res.set('Cache-Control', 'no-store');
  if (!['voting', 'closed'].includes(e.phase)) return res.json({ phase: e.phase });
  res.json(await electionStats(e));
}));

// 1-р шат: нэр дэвшүүлэх (өөрийгөө эсвэл бусдыг)
router.post('/:id/nominate', requirePerm('nominate'), wrap(async (req, res, next) => {
  const e = await getElection(req);
  if (!e) return next();
  const back = `/elections/${e.id}`;
  if (!sched.windowOpen(e, 'nominate')) {
    flash(req, 'error', 'Одоогоор нэр дэвшүүлэх хугацаа биш байна.');
    return res.redirect(back);
  }
  const nomineeId = Number(req.body.nominee_id);
  const reason = clean(req.body.reason, 1000);
  const [[nominee]] = await pool.query("SELECT id, surname, name FROM users WHERE id = ? AND status = 'approved'", [nomineeId]);
  if (!nominee) {
    flash(req, 'error', 'Нэр дэвшүүлэх төгсөгчөө сонгоно уу.');
    return res.redirect(back);
  }
  const isSelf = nominee.id === req.user.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO candidates (election_id, user_id, status, responded_at)
       VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
      [e.id, nominee.id, isSelf ? 'accepted' : 'pending', isSelf ? new Date() : null]
    );
    const [[cand]] = await conn.query('SELECT id, status FROM candidates WHERE election_id = ? AND user_id = ? FOR UPDATE', [e.id, nominee.id]);
    // Өөрийгөө дэвшүүлбэл автоматаар зөвшөөрсөнд тооцно.
    if (isSelf && cand.status !== 'accepted') {
      await conn.query("UPDATE candidates SET status='accepted', responded_at=NOW() WHERE id = ?", [cand.id]);
    }
    const [r] = await conn.query(
      'INSERT IGNORE INTO nominations (candidate_id, nominator_id, reason) VALUES (?, ?, ?)',
      [cand.id, req.user.id, reason || null]
    );
    await conn.commit();
    if (r.affectedRows === 0) flash(req, 'info', `Та ${nominee.surname} ${nominee.name}-г аль хэдийн нэр дэвшүүлсэн байна.`);
    else if (isSelf) flash(req, 'success', 'Та өөрийгөө нэр дэвшүүллээ. Танд амжилт хүсье!');
    else flash(req, 'success', `${nominee.surname} ${nominee.name}-г нэр дэвшүүллээ. Тэрээр зөвшөөрсний дараа саналын хуудсанд орно.`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  res.redirect(back);
}));

// 2-р шат: нэр дэвшигч зөвшөөрөх / татгалзах
router.post('/:id/respond', requireMember, wrap(async (req, res, next) => {
  const e = await getElection(req);
  if (!e) return next();
  const back = req.body.back === 'me' ? '/me' : `/elections/${e.id}`;
  if (!sched.windowOpen(e, 'respond')) {
    flash(req, 'error', 'Одоогоор нэр дэвшихээ зөвшөөрөх хугацаа биш байна.');
    return res.redirect(back);
  }
  const action = req.body.action === 'accept' ? 'accepted' : req.body.action === 'decline' ? 'declined' : null;
  if (!action) return res.redirect(back);
  // Маягтад мөрийн хөтөлбөрийн талбар байвал л шинэчилнэ (жишээ нь "Татгалзах" товч нь хуучныг устгахгүй).
  const hasStatement = Object.prototype.hasOwnProperty.call(req.body, 'statement');
  const [r] = hasStatement
    ? await pool.query(
      'UPDATE candidates SET status = ?, statement = ?, responded_at = NOW() WHERE election_id = ? AND user_id = ?',
      [action, clean(req.body.statement, 3000) || null, e.id, req.user.id]
    )
    : await pool.query(
      'UPDATE candidates SET status = ?, responded_at = NOW() WHERE election_id = ? AND user_id = ?',
      [action, e.id, req.user.id]
    );
  if (r.affectedRows === 0) flash(req, 'error', 'Таныг энэ сонгуульд нэр дэвшүүлээгүй байна.');
  else if (action === 'accepted') flash(req, 'success', 'Та нэр дэвшихийг зөвшөөрлөө. Таны нэр саналын хуудсанд орно.');
  else flash(req, 'info', 'Та нэр дэвшихээс татгалзлаа.');
  res.redirect(back);
}));

// 3-р шат: санал өгөх (нууц санал — хэнд өгснийг хадгалахгүй)
router.post('/:id/vote', requirePerm('vote'), wrap(async (req, res, next) => {
  const e = await getElection(req);
  if (!e) return next();
  const back = `/elections/${e.id}`;
  if (!sched.windowOpen(e, 'vote')) {
    flash(req, 'error', 'Одоогоор санал өгөх хугацаа биш байна.');
    return res.redirect(back);
  }
  let choices = req.body.choices;
  if (!Array.isArray(choices)) choices = choices ? [choices] : [];
  choices = [...new Set(choices.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (choices.length < 1 || choices.length > e.max_choices) {
    flash(req, 'error', `1-ээс ${e.max_choices} хүртэлх нэр дэвшигч сонгоно уу.`);
    return res.redirect(back);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    try {
      await conn.query('INSERT INTO ballots (election_id, voter_id, school_id) VALUES (?, ?, ?)', [e.id, req.user.id, req.user.school_id]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        await conn.rollback();
        flash(req, 'warn', 'Та энэ сонгуульд аль хэдийн саналаа өгсөн байна.');
        return res.redirect(back);
      }
      throw err;
    }
    const [r] = await conn.query(
      "UPDATE candidates SET votes = votes + 1 WHERE election_id = ? AND status = 'accepted' AND id IN (?)",
      [e.id, choices]
    );
    if (r.affectedRows !== choices.length) {
      await conn.rollback();
      flash(req, 'error', 'Саналын хуудас буруу байна. Хуудсаа дахин ачаалаад оролдоно уу.');
      return res.redirect(back);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  flash(req, 'success', 'Таны санал амжилттай бүртгэгдлээ. Баярлалаа!');
  res.redirect(back);
}));

module.exports = router;

const express = require('express');
const { pool } = require('../db');
const { wrap, can } = require('../middleware');
const sched = require('../electionSchedule');

const router = express.Router();

// Удирдах зөвлөл: гишүүд + явагдаж буй сонгууль (дээр) + сонгуулийн түүх (доор)
router.get('/', wrap(async (req, res) => {
  await sched.syncAll();
  const showContacts = can(req.user, 'view_contacts');

  const [members] = await pool.query(
    `SELECT b.id, b.user_id, b.position, b.responsibilities, b.term, b.sort_order,
            u.surname, u.name, u.class_name, u.occupation, u.city, u.photo_v, u.phone, u.email, u.facebook,
            s.name AS school_name
     FROM board_members b JOIN users u ON u.id = b.user_id
     LEFT JOIN schools s ON s.id = u.school_id
     ORDER BY b.sort_order, b.id`
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

  res.render('board', { title: 'Удирдах зөвлөл', members, active, others });
}));

module.exports = router;

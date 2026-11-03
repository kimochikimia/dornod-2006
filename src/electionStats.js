const { pool } = require('./db');
const { hourKey, fmtDate, PHASE_LABELS } = require('./helpers');

// Сонгуулийн явц, үр дүнгийн статистик. /elections/:id/live.json болон хуудсанд ашиглана.
async function electionStats(e) {
  const id = e.id;

  const [[{ eligibleNow }]] = await pool.query("SELECT COUNT(*) AS eligibleNow FROM users WHERE status = 'approved'");
  const eligible = e.phase === 'closed' && e.eligible_count != null ? e.eligible_count : eligibleNow;

  const [ballotRows] = await pool.query(
    `SELECT b.created_at, s.name AS school_name FROM ballots b
     LEFT JOIN schools s ON s.id = b.school_id
     WHERE b.election_id = ? ORDER BY b.created_at`,
    [id]
  );
  const ballots = ballotRows.length;

  // Цаг тутмын идэвх
  const hourly = [];
  const hourIndex = new Map();
  for (const b of ballotRows) {
    const k = hourKey(b.created_at);
    if (!hourIndex.has(k)) {
      hourIndex.set(k, hourly.length);
      hourly.push({ label: k, count: 0 });
    }
    hourly[hourIndex.get(k)].count++;
  }

  // Сургуулиар оролцоо
  const [bySchoolRows] = await pool.query(
    `SELECT s.name,
            (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.status = 'approved') AS members,
            (SELECT COUNT(*) FROM ballots b WHERE b.election_id = ? AND b.school_id = s.id) AS voted
     FROM schools s ORDER BY s.sort_order, s.name`,
    [id]
  );
  const bySchool = bySchoolRows
    .filter((r) => r.members > 0 || r.voted > 0)
    .map((r) => ({
      name: r.name,
      members: r.members,
      voted: r.voted,
      pct: r.members ? Math.round((r.voted / r.members) * 1000) / 10 : 0,
    }));

  // Сүүлд санал өгсөн (нэргүй — зөвхөн сургууль, цаг)
  const recent = ballotRows
    .slice(-8)
    .reverse()
    .map((b) => ({ school: b.school_name || 'Сургууль тодорхойгүй', at: fmtDate(b.created_at) }));

  const showTally = e.phase === 'closed' || (e.phase === 'voting' && !!e.show_live_results);
  let candidates = null;
  let tie = false;
  if (showTally) {
    const [rows] = await pool.query(
      `SELECT c.id, c.votes, u.surname, u.name, s.name AS school_name
       FROM candidates c JOIN users u ON u.id = c.user_id
       LEFT JOIN schools s ON s.id = u.school_id
       WHERE c.election_id = ? AND c.status = 'accepted'
       ORDER BY c.votes DESC, u.name`,
      [id]
    );
    const cutoff = rows.length >= e.seats ? rows[e.seats - 1].votes : 0;
    candidates = rows.map((r, i) => ({
      id: r.id,
      name: `${r.surname} ${r.name}`,
      school: r.school_name || '',
      votes: r.votes,
      rank: i + 1,
      pct: ballots ? Math.round((r.votes / ballots) * 1000) / 10 : 0,
      // Эрэмбэлсэн тул сүүлийн суудлын саналаас багагүй бол сонгогдсон (тэнцсэн бол бүгд тэмдэглэгдэнэ).
      winner: r.votes > 0 && r.votes >= cutoff,
    }));
    tie = candidates.filter((c) => c.winner).length > e.seats;
  }

  const [[{ totalVotes }]] = await pool.query(
    "SELECT COALESCE(SUM(votes),0) AS totalVotes FROM candidates WHERE election_id = ? AND status='accepted'",
    [id]
  );

  return {
    id,
    phase: e.phase,
    phaseLabel: PHASE_LABELS[e.phase],
    seats: e.seats,
    eligible,
    ballots,
    turnout: eligible ? Math.round((ballots / eligible) * 1000) / 10 : 0,
    avgChoices: ballots ? Math.round((Number(totalVotes) / ballots) * 10) / 10 : 0,
    hourly,
    bySchool,
    recent,
    showTally,
    candidates,
    tie,
    startedAt: fmtDate(e.voting_started_at),
    endedAt: fmtDate(e.voting_ended_at),
    updatedAt: fmtDate(new Date()),
  };
}

module.exports = { electionStats };

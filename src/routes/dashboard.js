// src/routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('./_auth_helper') || null; // if you have a shared auth helper; otherwise use inline auth

// If you don't have a central auth helper, copy the authMiddleware from your other routes:
// function authMiddleware(req,res,next){ ... }

function adminOrTrainer(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not authenticated' });
  if (!['admin', 'trainer'].includes(req.user.role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

// GET /api/dashboard/stats
// Returns: totalAttempts, avgScore, bestScore, attemptsLast7Days, totalUsers, deedsWithPdf
router.get('/stats', authMiddleware, adminOrTrainer, async (req, res) => {
  try {
    const qTotal = await db.query('SELECT COUNT(*)::int AS total FROM attempts');
    const qAvg = await db.query('SELECT ROUND(AVG(total_score))::int AS avg FROM attempts');
    const qBest = await db.query('SELECT COALESCE(MAX(total_score),0)::int AS best FROM attempts');
    const qUsers = await db.query('SELECT COUNT(*)::int AS total_users FROM users');
    const qDeeds = await db.query("SELECT COUNT(*)::int AS deeds_with_pdf FROM deeds WHERE filepath IS NOT NULL AND filepath <> ''");

    // attempts per day last 7 days
    const q7 = await db.query(`
      SELECT to_char(created_at::date, 'YYYY-MM-DD') as day, COUNT(*)::int AS attempts
      FROM attempts
      WHERE created_at >= now() - interval '7 days'
      GROUP BY day ORDER BY day
    `);

    res.json({
      totalAttempts: qTotal.rows[0].total,
      avgScore: qAvg.rows[0].avg || 0,
      bestScore: qBest.rows[0].best || 0,
      totalUsers: qUsers.rows[0].total_users,
      deedsWithPdf: qDeeds.rows[0].deeds_with_pdf,
      last7Days: q7.rows
    });
  } catch (err) {
    console.error('dashboard/stats error', err);
    res.status(500).json({ error: 'failed to compute stats' });
  }
});

// GET /api/dashboard/attempts?userId=&limit=&offset=
// Returns paginated attempts, newest first
router.get('/attempts', authMiddleware, adminOrTrainer, async (req, res) => {
  try {
    const userId = req.query.userId ? parseInt(req.query.userId,10) : null;
    const limit = Math.min(100, parseInt(req.query.limit || '50', 10));
    const offset = parseInt(req.query.offset || '0', 10);

    let q;
    if (userId) {
      q = await db.query(`
        SELECT a.*, u.username, d.filename
        FROM attempts a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN deeds d ON d.id = a.deed_id
        WHERE a.user_id = $1
        ORDER BY a.created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]);
    } else {
      q = await db.query(`
        SELECT a.*, u.username, d.filename
        FROM attempts a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN deeds d ON d.id = a.deed_id
        ORDER BY a.created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);
    }
    res.json({ attempts: q.rows });
  } catch (err) {
    console.error('dashboard/attempts error', err);
    res.status(500).json({ error: 'failed to load attempts' });
  }
});

// GET /api/dashboard/users
router.get('/users', authMiddleware, adminOrTrainer, async (req,res) => {
  try {
    const q = await db.query('SELECT id, username, role, created_at FROM users ORDER BY username');
    res.json({ users: q.rows });
  } catch(err){
    console.error('dashboard/users error', err);
    res.status(500).json({ error: 'failed to load users' });
  }
});

// GET /api/dashboard/export?userId=&since=&until=
// Exports attempts as CSV (server-side) — returns CSV text
router.get('/export', authMiddleware, adminOrTrainer, async (req, res) => {
  try {
    const userId = req.query.userId ? parseInt(req.query.userId,10) : null;
    const since = req.query.since || null;
    const until = req.query.until || null;

    let where = [];
    let params = [];
    let idx = 1;
    if (userId) { where.push(`a.user_id = $${idx++}`); params.push(userId); }
    if (since) { where.push(`a.created_at >= $${idx++}`); params.push(since); }
    if (until) { where.push(`a.created_at <= $${idx++}`); params.push(until); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const q = await db.query(`
      SELECT a.id, a.user_id, u.username, a.deed_id, d.filename, a.total_score, a.time_taken_seconds, a.feedback, a.created_at
      FROM attempts a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN deeds d ON d.id = a.deed_id
      ${whereClause}
      ORDER BY a.created_at DESC
    `, params);

    // Build CSV
    const rows = q.rows;
    let csv = 'attempt_id,username,deed_id,deed_filename,score,time_seconds,feedback,created_at\n';
    for (const r of rows) {
      const safe = (v) => {
        if (v === null || v === undefined) return '';
        return String(v).replace(/"/g, '""');
      };
      csv += `${r.id},"${safe(r.username)}",${r.deed_id},"${safe(r.filename)}",${r.total_score},${r.time_taken_seconds},"${safe(r.feedback)}","${r.created_at.toISOString()}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="attempts-export.csv"');
    res.send(csv);
  } catch (err) {
    console.error('dashboard/export error', err);
    res.status(500).json({ error: 'failed to export attempts' });
  }
});

module.exports = router;

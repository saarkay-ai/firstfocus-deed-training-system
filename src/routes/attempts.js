const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const bearerToken = req.headers.authorization?.split(' ')[1];
  const cookieToken = req.cookies && req.cookies.token;
  const token = bearerToken || cookieToken;

  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Create an attempt (trainee/trainer/admin)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      deed_id,
      grantor,
      grantee,
      recording_date,
      dated_date,
      document_type,
      county_name,
      county_state,
      apn,
      recording_book,
      recording_page,
      instrument_number,
      total_score,
      time_taken_seconds,
      feedback
    } = req.body;

    if (!deed_id) {
      return res.status(400).json({ error: 'deed_id is required' });
    }

    const result = await db.query(
      `INSERT INTO attempts (
        deed_id,
        user_id,
        grantor,
        grantee,
        recording_date,
        dated_date,
        document_type,
        county_name,
        county_state,
        apn,
        recording_book,
        recording_page,
        instrument_number,
        total_score,
        time_taken_seconds,
        feedback
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      RETURNING *`,
      [
        deed_id,
        userId,
        grantor || null,
        grantee || null,
        recording_date || null,
        dated_date || null,
        document_type || null,
        county_name || null,
        county_state || null,
        apn || null,
        recording_book || null,
        recording_page || null,
        instrument_number || null,
        total_score || 0,
        time_taken_seconds || 0,
        feedback || null
      ]
    );

    res.json({ attempt: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to save attempt' });
  }
});

// Get attempts for current user (for dashboard later)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const q = await db.query(
      `SELECT a.*, d.filename
       FROM attempts a
       LEFT JOIN deeds d ON a.deed_id = d.id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC`,
      [userId]
    );
    res.json({ attempts: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load attempts' });
  }
});

module.exports = router;

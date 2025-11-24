const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

function auth(req, res, next){
  const bearer = (req.headers.authorization || '').split(' ')[1] || req.cookies && req.cookies.token;
  const token = bearer;
  if(!token) return res.status(401).json({ error: 'not authenticated' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret'); next(); } catch(e){ return res.status(401).json({ error: 'invalid token' }); }
}

// submit attempt
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { deed_id, grantor, grantee, recording_date, dated_date, document_type, county_name, county_state, apn, recording_book, recording_page, instrument_number, total_score, time_taken_seconds, feedback } = req.body;
    const r = await db.query(
      `INSERT INTO attempts (user_id, deed_id, grantor, grantee, recording_date, dated_date, document_type, county_name, county_state, apn, recording_book, recording_page, instrument_number, total_score, time_taken_seconds, feedback)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [userId, deed_id || null, grantor || null, grantee || null, recording_date || null, dated_date || null, document_type || null, county_name||null, county_state||null, apn||null, recording_book||null, recording_page||null, instrument_number||null, total_score || 0, time_taken_seconds || 0, feedback ? feedback : null]
    );
    res.json({ attempt: r.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'db error' }); }
});

router.get('/me', auth, async (req, res) => {
  const r = await db.query('SELECT * FROM attempts WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ attempts: r.rows });
});

router.get('/', auth, async (req, res) => {
  if(!['trainer','admin'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  const q = await db.query('SELECT a.*, u.username FROM attempts a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC');
  res.json({ attempts: q.rows });
});

module.exports = router;

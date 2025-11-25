// src/routes/attempts.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.split(' ')[1] : null;
  const token = bearer || (req.cookies && req.cookies.token);
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// normalize helper for string comparison
function norm(str) {
  if (!str) return '';
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

// compute score & feedback based on deed truth vs attempt
function computeScore(truth, attempt) {
  let total = 0;
  const feedback = [];

  // 1. Grantor (20)
  if (truth.grantor) {
    if (norm(truth.grantor) === norm(attempt.grantor)) {
      total += 20;
    } else {
      feedback.push('Grantor mismatch');
    }
  } else {
    feedback.push('Grantor truth not set for this deed');
  }

  // 2. Grantee (20)
  if (truth.grantee) {
    if (norm(truth.grantee) === norm(attempt.grantee)) {
      total += 20;
    } else {
      feedback.push('Grantee mismatch');
    }
  } else {
    feedback.push('Grantee truth not set for this deed');
  }

  // 3. Recording Date (20)
  if (truth.recording_date) {
    if (norm(truth.recording_date) === norm(attempt.recording_date)) {
      total += 20;
    } else {
      feedback.push('Recording Date mismatch');
    }
  } else {
    feedback.push('Recording Date truth not set for this deed');
  }

  // 4. Dated Date (20)
  if (truth.dated_date) {
    if (norm(truth.dated_date) === norm(attempt.dated_date)) {
      total += 20;
    } else {
      feedback.push('Dated Date mismatch');
    }
  } else {
    feedback.push('Dated Date truth not set for this deed');
  }

  // 5. Recording information (Book + Page + Instrument) -> 20 total, partial
  let recPossible = 0;
  let recMatches = 0;

  const fields = [
    { key: 'recording_book', label: 'Recording Book' },
    { key: 'recording_page', label: 'Recording Page' },
    { key: 'instrument_number', label: 'Instrument Number' }
  ];

  fields.forEach(f => {
    const truthVal = truth[f.key];
    const attemptVal = attempt[f.key];
    if (truthVal) {
      recPossible++;
      if (norm(truthVal) === norm(attemptVal)) {
        recMatches++;
      } else {
        feedback.push(f.label + ' mismatch');
      }
    }
  });

  if (recPossible > 0) {
    const fieldScore = Math.round((recMatches / recPossible) * 20);
    total += fieldScore;
  } else {
    feedback.push('Recording info (Book/Page/Instrument) truth not fully set for this deed');
  }

  const fbText = feedback.join('; ');
  return { total, feedback: fbText };
}

// POST /api/attempts  -> save attempt with score
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
      time_taken_seconds
    } = req.body;

    if (!deed_id) {
      return res.status(400).json({ error: 'deed_id required' });
    }

    // Load truth from deeds
    const deedResult = await db.query(
      `SELECT id, grantor, grantee, recording_date, dated_date,
              recording_book, recording_page, instrument_number
       FROM deeds
       WHERE id = $1`,
      [deed_id]
    );
    if (deedResult.rowCount === 0) {
      return res.status(404).json({ error: 'deed not found' });
    }
    const truth = deedResult.rows[0];

    const attemptData = {
      grantor: grantor || '',
      grantee: grantee || '',
      recording_date: recording_date || '',
      dated_date: dated_date || '',
      recording_book: recording_book || '',
      recording_page: recording_page || '',
      instrument_number: instrument_number || ''
    };

    const { total, feedback } = computeScore(truth, attemptData);

    const ins = await db.query(
      `INSERT INTO attempts (
          user_id,
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
          feedback,
          time_taken_seconds
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING *`,
      [
        userId,
        deed_id,
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
        total,
        feedback || null,
        time_taken_seconds || null
      ]
    );

    return res.json({
      attempt: ins.rows[0],
      score: total,
      feedback
    });
  } catch (err) {
    console.error('Error saving attempt:', err);
    return res.status(500).json({ error: 'failed to save attempt' });
  }
});

// (Optional) GET attempts for current user
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      `SELECT a.*, d.filename
       FROM attempts a
       LEFT JOIN deeds d ON d.id = a.deed_id
       WHERE a.user_id = $1
       ORDER BY a.id DESC
       LIMIT 100`,
      [userId]
    );
    res.json({ attempts: result.rows });
  } catch (err) {
    console.error('Error loading attempts:', err);
    res.status(500).json({ error: 'failed to load attempts' });
  }
});

module.exports = router;

// src/routes/attempts.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

// ============================
// Auth middleware
// ============================
function authMiddleware(req, res, next) {
  const bearer = (req.headers.authorization || '').split(' ')[1];
  const token = bearer || (req.cookies && req.cookies.token);
  if (!token) return res.status(401).json({ error: 'not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// ============================
// Scoring helpers
// ============================
function normStr(value) {
  if (value === null || value === undefined) return '';
  return value
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[.,]/g, '')   // remove dots/commas
    .replace(/\s+/g, ' ');  // collapse multiple spaces
}

function scoreAttempt(truth, attempt) {
  // 5 buckets × 20 points = 100
  let total = 0;
  const details = [];

  // Grantor (20)
  const tGrantor = normStr(truth.grantor);
  const aGrantor = normStr(attempt.grantor);
  if (tGrantor && aGrantor && tGrantor === aGrantor) {
    total += 20;
    details.push('Grantor correct');
  } else if (tGrantor) {
    details.push('Grantor mismatch');
  }

  // Grantee (20)
  const tGrantee = normStr(truth.grantee);
  const aGrantee = normStr(attempt.grantee);
  if (tGrantee && aGrantee && tGrantee === aGrantee) {
    total += 20;
    details.push('Grantee correct');
  } else if (tGrantee) {
    details.push('Grantee mismatch');
  }

  // Recording Date (20)
  const tRecDate = normStr(truth.recording_date);
  const aRecDate = normStr(attempt.recording_date);
  if (tRecDate && aRecDate && tRecDate === aRecDate) {
    total += 20;
    details.push('Recording Date correct');
  } else if (tRecDate) {
    details.push('Recording Date mismatch');
  }

  // Dated Date (20)
  const tDated = normStr(truth.dated_date);
  const aDated = normStr(attempt.dated_date);
  if (tDated && aDated && tDated === aDated) {
    total += 20;
    details.push('Dated Date correct');
  } else if (tDated) {
    details.push('Dated Date mismatch');
  }

  // Recording Info (20 total, split over book/page/instrument)
  const tBook = normStr(truth.recording_book);
  const tPage = normStr(truth.recording_page);
  const tInstr = normStr(truth.instrument_number);

  const aBook = normStr(attempt.recording_book);
  const aPage = normStr(attempt.recording_page);
  const aInstr = normStr(attempt.instrument_number);

  let recPoints = 0;
  const recDetails = [];

  if (tBook) {
    if (tBook === aBook) {
      recPoints += 7;
      recDetails.push('Recording Book correct');
    } else {
      recDetails.push('Recording Book mismatch');
    }
  }
  if (tPage) {
    if (tPage === aPage) {
      recPoints += 7;
      recDetails.push('Recording Page correct');
    } else {
      recDetails.push('Recording Page mismatch');
    }
  }
  if (tInstr) {
    if (tInstr === aInstr) {
      recPoints += 6;
      recDetails.push('Instrument Number correct');
    } else {
      recDetails.push('Instrument Number mismatch');
    }
  }

  if (recPoints > 0) {
    total += recPoints;
  }
  if (recDetails.length > 0) {
    details.push(...recDetails);
  }

  if (details.length === 0) {
    details.push('Attempt saved');
  }

  // Clamp to 0–100
  if (total < 0) total = 0;
  if (total > 100) total = 100;

  return {
    totalScore: total,
    feedback: details.join('. ') + '.'
  };
}

// ============================
// POST /api/attempts
// ============================
// Expects body: {
//   deed_id,
//   grantor, grantee, recording_date, dated_date, document_type,
//   county_name, county_state, apn,
//   recording_book, recording_page, instrument_number,
//   time_taken_seconds
// }
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (!['trainee', 'trainer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

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
      return res.status(400).json({ error: 'deed_id is required' });
    }

    // 1) Load truth data from deeds table
    const dq = await db.query(
      `
      SELECT
        grantor,
        grantee,
        recording_date,
        dated_date,
        recording_book,
        recording_page,
        instrument_number
      FROM deeds
      WHERE id = $1
    `,
      [deed_id]
    );

    if (dq.rowCount === 0) {
      return res.status(404).json({ error: 'deed not found' });
    }

    const truth = dq.rows[0];

    // 2) Calculate score & feedback
    const attemptForScoring = {
      grantor,
      grantee,
      recording_date,
      dated_date,
      recording_book,
      recording_page,
      instrument_number
    };

    const { totalScore, feedback } = scoreAttempt(truth, attemptForScoring);

    // ✅ Prepare JSON feedback payload for DB json/jsonb column
    const feedbackPayload = {
      message: feedback,
      score: totalScore
    };

    // 3) Insert into attempts table
    const aq = await db.query(
      `
      INSERT INTO attempts (
        user_id,
        deed_id,
        grantor,
        grantee,
        recording_date,
        dated_date,
        document_type,
        total_score,
        time_taken_seconds,
        feedback
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `,
      [
        req.user.id,
        deed_id,
        grantor || null,
        grantee || null,
        recording_date || null,
        dated_date || null,
        document_type || null,
        totalScore,
        time_taken_seconds || 0,
        JSON.stringify(feedbackPayload)   // ✅ valid JSON string
      ]
    );

    const attemptRow = aq.rows[0];

    // Frontend expects "score" and "feedback" as a simple string
    return res.json({
      attempt: attemptRow,
      score: totalScore,
      feedback
    });
  } catch (err) {
    console.error('Attempt save error:', err);
    return res.status(500).json({
      error: 'failed to save attempt: ' + (err.message || String(err))
    });
  }
});

// Optional: list attempts for current user
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const q = await db.query(
      `
      SELECT a.*, d.filename
      FROM attempts a
      JOIN deeds d ON d.id = a.deed_id
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC NULLS LAST, a.id DESC
    `,
      [req.user.id]
    );
    return res.json({ attempts: q.rows });
  } catch (err) {
    console.error('Error fetching user attempts:', err);
    return res.status(500).json({ error: 'failed to fetch attempts' });
  }
});

module.exports = router;

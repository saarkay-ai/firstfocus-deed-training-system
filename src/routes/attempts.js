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

// strict text match, trimming whitespace
function strictMatch(a, b) {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  return x === y;
}

// normalize date into MM/DD/YYYY for comparison
// supports "MM/DD/YYYY" and "YYYY-MM-DD"
function normalizeDate(str) {
  if (str === null || str === undefined) return '';
  const s = String(str).trim();
  if (!s) return '';

  // MM/DD/YYYY
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) {
    const mm = m[1];
    const dd = m[2];
    const yyyy = m[3];
    return `${mm}/${dd}/${yyyy}`;
  }

  // YYYY-MM-DD
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const yyyy = m[1];
    const mm = m[2];
    const dd = m[3];
    return `${mm}/${dd}/${yyyy}`;
  }

  // fallback: leave as-is (still strict compare)
  return s;
}

// Create an attempt (with strict scoring on 5 fields)
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
      time_taken_seconds,
      feedback
    } = req.body;

    if (!deed_id) {
      return res.status(400).json({ error: 'deed_id is required' });
    }

    // 1) Load correct values from deed master
    const deedQ = await db.query(
      `SELECT
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
         instrument_number
       FROM deeds
       WHERE id = $1`,
      [deed_id]
    );

    if (!deedQ.rows.length) {
      return res.status(404).json({ error: 'deed not found' });
    }

    const deed = deedQ.rows[0];

    // 2) Strict scoring on 5 main fields, total 100
    const checks = [
      {
        label: 'Grantor',
        key: 'grantor',
        correct: deed.grantor,
        attempt: grantor,
        weight: 20,
        type: 'text'
      },
      {
        label: 'Grantee',
        key: 'grantee',
        correct: deed.grantee,
        attempt: grantee,
        weight: 20,
        type: 'text'
      },
      {
        label: 'Recording Date',
        key: 'recording_date',
        correct: deed.recording_date,
        attempt: recording_date,
        weight: 20,
        type: 'date'
      },
      {
        label: 'Dated Date',
        key: 'dated_date',
        correct: deed.dated_date,
        attempt: dated_date,
        weight: 20,
        type: 'date'
      },
      {
        label: 'Document Type',
        key: 'document_type',
        correct: deed.document_type,
        attempt: document_type,
        weight: 20,
        type: 'text'
      }
    ];

    let total_score = 0;
    const correctFields = [];
    const incorrectDetails = [];

    for (const c of checks) {
      let ok = false;
      if (c.type === 'date') {
        ok = normalizeDate(c.correct) === normalizeDate(c.attempt);
      } else {
        ok = strictMatch(c.correct, c.attempt);
      }

      if (ok) {
        total_score += c.weight;
        correctFields.push(c.label);
      } else {
        const expectedStr =
          c.correct === null || c.correct === undefined || c.correct === ''
            ? '(blank)'
            : String(c.correct);
        const attemptStr =
          c.attempt === null || c.attempt === undefined || c.attempt === ''
            ? '(blank)'
            : String(c.attempt);
        incorrectDetails.push(
          `${c.label}: expected "${expectedStr}" but typed "${attemptStr}"`
        );
      }
    }

    // 3) County & Recording fields – included in feedback (no effect on score)
    const extraFields = [
      {
        label: 'County Name',
        correct: deed.county_name,
        attempt: county_name
      },
      {
        label: 'County State',
        correct: deed.county_state,
        attempt: county_state
      },
      {
        label: 'APN',
        correct: deed.apn,
        attempt: apn
      },
      {
        label: 'Recording Book',
        correct: deed.recording_book,
        attempt: recording_book
      },
      {
        label: 'Recording Page',
const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// Define upload destination
const uploadDir = process.env.UPLOAD_PATH || path.join(__dirname, '..', 'uploads', 'deeds');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Upload setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: (process.env.MAX_UPLOAD_SIZE ? parseInt(process.env.MAX_UPLOAD_SIZE) : 25) * 1024 * 1024 // Default 25 MB
  }
});

// JWT verification middleware
function authMiddleware(req, res, next) {
  const bearerToken = req.headers.authorization?.split(' ')[1];
  const token = bearerToken;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Upload a single deed (admin or trainer only)
router.post('/upload', authMiddleware, upload.single('deed'), async (req, res) => {
  try {
    if (!['trainer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { originalname, filename } = req.file;
    const {
      document_type,
      grantor,
      grantee,
      recording_date,
      dated_date,
      county_name,
      county_state,
      apn,
      recording_book,
      recording_page,
      instrument_number
    } = req.body;

    const result = await db.query(
      `INSERT INTO deeds (
        filename, filepath, document_type, grantor, grantee,
        recording_date, dated_date, county_name, county_state, apn,
        recording_book, recording_page, instrument_number, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        originalname,
        filename,
        document_type || null,
        grantor || null,
        grantee || null,
        recording_date || null,
        dated_date || null,
        county_name || null,
        county_state || null,
        apn || null,
        recording_book || null,
        recording_page || null,
        instrument_number || null,
        req.user.id
      ]
    );

    res.json({ deed: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const AdmZip = require('adm-zip');

// ✅ Same upload root as app.js
const uploadRoot = process.env.UPLOAD_PATH || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

// Multer storage for single PDF
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadRoot);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.pdf';
    const name = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    cb(null, name);
  }
});

const singleUpload = multer({
  storage,
  limits: {
    fileSize: (process.env.MAX_UPLOAD_SIZE ? parseInt(process.env.MAX_UPLOAD_SIZE) : 25) * 1024 * 1024 // 25MB default
  }
});

// Multer memory storage for ZIP
const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (process.env.MAX_UPLOAD_SIZE ? parseInt(process.env.MAX_UPLOAD_SIZE) : 100) * 1024 * 1024 // up to 100MB ZIP
  }
});

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

// ✅ Upload a single deed (PDF)
router.post('/upload', authMiddleware, singleUpload.single('deed'), async (req, res) => {
  try {
    if (!['trainer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const storedName = req.file.filename;      // random name on disk
    const originalname = req.file.originalname;

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
      RETURNING id, filename, filepath, document_type`,
      [
        originalname,
        storedName,                 // filepath = stored random name
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

// ✅ Upload ZIP of multiple deed PDFs
router.post('/upload-zip', authMiddleware, zipUpload.single('zip'), async (req, res) => {
  try {
    if (!['trainer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No ZIP file provided' });
    }

    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch (e) {
      console.error('Invalid ZIP:', e);
      return res.status(400).json({ error: 'Invalid ZIP file' });
    }

    const entries = zip.getEntries().filter(
      (entry) =>
        !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.pdf')
    );

    if (!entries.length) {
      return res.status(400).json({ error: 'No PDF files found inside ZIP' });
    }

    const inserted = [];

    for (const entry of entries) {
      const pdfBuffer = entry.getData();
      const originalname = path.basename(entry.entryName);
      const ext = path.extname(originalname) || '.pdf';
      const storedName = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
      const destPath = path.join(uploadRoot, storedName);

      fs.writeFileSync(destPath, pdfBuffer);

      const result = await db.query(
        `INSERT INTO deeds (
          filename, filepath, document_type, grantor, grantee,
          recording_date, dated_date, county_name, county_state, apn,
          recording_book, recording_page, instrument_number, created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id, filename, filepath`,
        [
          originalname,
          storedName,      // filepath = stored random name
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          req.user.id
        ]
      );

      inserted.push(result.rows[0]);
    }

    res.json({
      count: inserted.length,
      deeds: inserted
    });
  } catch (err) {
    console.error('ZIP upload failed:', err);
    res.status(500).json({ error: 'ZIP upload failed', details: err.message });
  }
});

// ✅ Next deed for user – only those whose file actually exists
router.get('/next', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const q = await db.query(
      `SELECT d.id, d.filename, d.document_type, d.filepath
       FROM deeds d
       WHERE NOT EXISTS (
         SELECT 1 FROM attempts a
         WHERE a.deed_id = d.id
           AND a.user_id = $1
       )
       ORDER BY d.id ASC`,
      [userId]
    );

    const rows = q.rows || [];

    for (const row of rows) {
      if (!row.filepath) continue;
      const fileOnDisk = path.join(uploadRoot, row.filepath);
      if (fs.existsSync(fileOnDisk)) {
        return res.json({ deed: row });
      }
    }

    return res.status(404).json({ error: 'no deeds with available PDF file' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not fetch next deed' });
  }
});

// ✅ Get deed details by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid deed id' });

    const q = await db.query(
      `SELECT
         id, filename, filepath, document_type,
         grantor, grantee, recording_date, dated_date,
         county_name, county_state, apn,
         recording_book, recording_page, instrument_number
       FROM deeds
       WHERE id = $1`,
      [id]
    );

    if (!q.rows.length) {
      return res.status(404).json({ error: 'deed not found' });
    }

    res.json({ deed: q.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load deed' });
  }
});

module.exports = router;

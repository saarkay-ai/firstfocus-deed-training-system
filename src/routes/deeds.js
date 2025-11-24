const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const AdmZip = require('adm-zip');

// Use the SAME upload dir as app.js
// Deeds are stored in: src/uploads/deeds
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads', 'deeds');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer storage for single-PDF upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  }
});

const singleUpload = multer({
  storage,
  limits: {
    fileSize: (process.env.MAX_UPLOAD_SIZE ? parseInt(process.env.MAX_UPLOAD_SIZE) : 25) * 1024 * 1024 // 25MB default
  }
});

// Memory storage for ZIP upload
const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (process.env.MAX_UPLOAD_SIZE ? parseInt(process.env.MAX_UPLOAD_SIZE) : 100) * 1024 * 1024 // 100MB default
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

// ===============================
// SINGLE PDF UPLOAD (ADMIN/TRAINER)
// ===============================
router.post('/upload', authMiddleware, singleUpload.single('deed'), async (req, res) => {
  try {
    if (!['trainer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No deed file uploaded' });
    }

    const { originalname, filename } = req.file;
    const {
      document_type,
      grantor,
      grantee,
      recording_date,
      dated_date
    } = req.body;

    const result = await db.query(
      `INSERT INTO deeds (
        filename,
        filepath,
        document_type,
        grantor,
        grantee,
        recording_date,
        dated_date,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, filename, filepath, document_type`,
      [
        originalname,
        filename,           // stored file name on disk
        document_type || null,
        grantor || null,
        grantee || null,
        recording_date || null,
        dated_date || null,
        req.user.id
      ]
    );

    res.json({ deed: result.rows[0] });
  } catch (err) {
    console.error('Single upload failed:', err);
    res.status(500).json({ error: 'upload failed' });
  }
});

// ===============================
// ZIP UPLOAD (MULTIPLE DEEDS)
// ===============================
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
      const savedName = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
      const destPath = path.join(uploadDir, savedName);

      fs.writeFileSync(destPath, pdfBuffer);

      const result = await db.query(
        `INSERT INTO deeds (
          filename,
          filepath,
          document_type,
          grantor,
          grantee,
          recording_date,
          dated_date,
          created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id, filename, filepath`,
        [
          originalname,
          savedName,
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

// ===============================
// GET NEXT DEED FOR USER
// ===============================
router.get('/next', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const q = await db.query(
      `SELECT d.id, d.filename, d.document_type, d.filepath
       FROM deeds d
       WHERE NOT EXISTS (
         SELECT 1
         FROM attempts a
         WHERE a.deed_id = d.id
           AND a.user_id = $1
       )
       ORDER BY d.id ASC
       LIMIT 1`,
      [userId]
    );

    if (!q.rows.length) {
      return res.status(404).json({ error: 'no more deeds available' });
    }

    res.json({ deed: q.rows[0] });
  } catch (err) {
    console.error('Error fetching next deed:', err);
    res.status(500).json({ error: 'could not fetch next deed' });
  }
});

// ===============================
// GET DEED BY ID (FOR VIEWER)
// ===============================
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid deed id' });

    const q = await db.query(
      `SELECT
         id,
         filename,
         filepath,
         document_type,
         grantor,
         grantee,
         recording_date,
         dated_date
       FROM deeds
       WHERE id = $1`,
      [id]
    );

    if (!q.rows.length) {
      return res.status(404).json({ error: 'deed not found' });
    }

    const deed = q.rows[0];
    res.json({ deed });
  } catch (err) {
    console.error('Error loading deed by id:', err);
    res.status(500).json({ error: 'could not load deed' });
  }
});

module.exports = router;
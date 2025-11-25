// src/routes/deeds.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const xlsx = require('xlsx'); // ✅ Excel support added

// =========================================
// File storage setup (PDFs only)
// =========================================
const uploadDir = process.env.UPLOAD_PATH || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: (process.env.MAX_UPLOAD_MB ? parseInt(process.env.MAX_UPLOAD_MB) : 25) * 1024 * 1024 }
});

// =========================================
// Excel upload storage (in-memory)
// =========================================
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// =================================================
// Auth Helpers
// =================================================
function authMiddleware(req, res, next) {
  const bearer = (req.headers.authorization || '').split(' ')[1];
  const token = bearer || (req.cookies && req.cookies.token);
  if (!token) return res.status(401).json({ error: 'not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// For file/template endpoints (token in URL)
function authFromRequest(req) {
  let token = null;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
  } catch {
    return null;
  }
}

// ======================================================
// Upload Single PDF (Admin/Trainer)
// ======================================================
router.post('/upload', authMiddleware, upload.single('deed'), async (req, res) => {
  try {
    if (!['trainer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    if (!req.file) return res.status(400).json({ error: 'file missing' });

    const { originalname, filename } = req.file;
    const {
      document_type, grantor, grantee, recording_date,
      dated_date, recording_book, recording_page, instrument_number
    } = req.body;

    const q = await db.query(
      `INSERT INTO deeds
        (filename, filepath, document_type, grantor, grantee, recording_date,
         dated_date, recording_book, recording_page, instrument_number, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        originalname, filename,
        document_type || null,
        grantor || null,
        grantee || null,
        recording_date || null,
        dated_date || null,
        recording_book || null,
        recording_page || null,
        instrument_number || null,
        req.user.id
      ]
    );

    res.json({ deed: q.rows[0] });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'upload failed' });
  }
});

// ======================================================
// GET Next Unattempted Deed (Trainer/Trainee)
// ======================================================
router.get('/next', authMiddleware, async (req, res) => {
  try {
    const q = await db.query(`
      SELECT d.*
      FROM deeds d
      LEFT JOIN attempts a ON a.deed_id = d.id AND a.user_id = $1
      WHERE a.id IS NULL
      ORDER BY d.id ASC
      LIMIT 1
    `, [req.user.id]);

    if (q.rowCount === 0)
      return res.status(404).json({ error: 'No more deeds available' });

    return res.json({ deed: q.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'failed to load next deed' });
  }
});

// ======================================================
// Serve PDF file secured
// ======================================================
router.get('/:id/file', authMiddleware, async (req, res) => {
  try {
    const q = await db.query(`SELECT filepath FROM deeds WHERE id=$1`, [req.params.id]);
    if (q.rowCount === 0) return res.status(404).send('Not found');

    const fullPath = path.join(uploadDir, q.rows[0].filepath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).send('File missing');
    }

    return res.sendFile(fullPath);
  } catch {
    return res.status(500).send('Error');
  }
});

// ======================================================
// GET Metadata Template (Excel)
// ======================================================
router.get('/template', (req, res) => {
  const user = authFromRequest(req);
  if (!user || !['admin', 'trainer'].includes(user.role)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  db.query(`
    SELECT filename, grantor, grantee, recording_date, dated_date,
           recording_book, recording_page, instrument_number
    FROM deeds ORDER BY id
  `)
    .then(r => {
      const rows = r.rows || [];
      const data = rows.length ? rows : [{
        filename: '',
        grantor: '',
        grantee: '',
        recording_date: '',
        dated_date: '',
        recording_book: '',
        recording_page: '',
        instrument_number: ''
      }];

      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(wb, ws, 'Metadata');
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="deed_metadata_template.xlsx"'
      );
      res.send(buf);
    })
    .catch(err => {
      console.error('Template error:', err);
      res.status(500).json({ error: 'failed to generate template' });
    });
});

// ======================================================
// Upload Excel Metadata File
// ======================================================
router.post('/metadata', excelUpload.single('file'), async (req, res) => {
  try {
    const user = authFromRequest(req);
    if (!user || !['admin', 'trainer'].includes(user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });

    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

    let updated = 0;
    let notFound = [];

    for (const row of rows) {
      if (!row.filename) continue;

      const r = await db.query(`
        UPDATE deeds SET
          grantor=$2, grantee=$3, recording_date=$4, dated_date=$5,
          recording_book=$6, recording_page=$7, instrument_number=$8
        WHERE filename=$1
        RETURNING id
      `, [
        row.filename.trim(),
        row.grantor || null,
        row.grantee || null,
        row.recording_date || null,
        row.dated_date || null,
        row.recording_book || null,
        row.recording_page || null,
        row.instrument_number || null,
      ]);

      if (r.rowCount === 0) notFound.push(row.filename);
      else updated++;
    }

    return res.json({ message: `Metadata updated for ${updated} deeds`, notFound });
  } catch (err) {
    console.error('Metadata upload error:', err);
    res.status(500).json({ error: 'failed to process metadata' });
  }
});

module.exports = router;

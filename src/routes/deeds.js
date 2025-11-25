// src/routes/deeds.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const xlsx = require('xlsx'); // ✅ Excel support added
// Convert Excel serial date (e.g. 44111) to ISO string "YYYY-MM-DD"
function excelSerialToISO(serial) {
  if (serial === null || serial === undefined || serial === '') return null;
  const n = Number(serial);
  if (Number.isNaN(n)) return null;

  // Excel's "day 1" is 1900-01-01, but with a known off-by-2 bug, this base works well:
  const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30
  const date = new Date(excelEpoch.getTime() + n * 24 * 60 * 60 * 1000);

  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`; // Postgres DATE-compatible
}

// Normalize a date cell from Excel into something Postgres DATE will accept
function normalizeDateValue(val) {
  if (val === null || val === undefined || val === '') return null;

  // If it's numeric (Excel serial), convert
  if (typeof val === 'number') {
    return excelSerialToISO(val);
  }

  const s = val.toString().trim();
  if (!s) return null;

  // If it's digits only (e.g. "44111"), treat as serial too
  if (/^\d+$/.test(s)) {
    return excelSerialToISO(parseInt(s, 10));
  }

  // Otherwise send as string; Postgres can parse many date formats
  return s;
}

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
      return res.status(403).json({ error: 'forbidden: only trainer/admin can upload deeds' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'no file uploaded – please select a PDF' });
    }

    const { originalname, filename } = req.file;
    const {
      document_type,
      grantor,
      grantee,
      recording_date,
      dated_date,
      recording_book,
      recording_page,
      instrument_number
    } = req.body;

    const result = await db.query(
      `
      INSERT INTO deeds (
        filename,
        filepath,
        document_type,
        grantor,
        grantee,
        recording_date,
        dated_date,
        recording_book,
        recording_page,
        instrument_number
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `,
      [
        originalname,
        filename,
        document_type || null,
        grantor || null,
        grantee || null,
        normalizeDateValue(recording_date),
        normalizeDateValue(dated_date),
        recording_book || null,
        recording_page || null,
        instrument_number || null
      ]
    );

    return res.json({ deed: result.rows[0] });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({
      error: 'upload failed: ' + (err.message || String(err))
    });
  }
});
// ======================================================
// TEMP: Upload ZIP of PDFs (placeholder)
// ======================================================
router.post('/upload-zip', authMiddleware, excelUpload.single('zip'), async (req, res) => {
  try {
    if (!['trainer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden: only trainer/admin can upload deeds' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'no ZIP file uploaded – please select a .zip file' });
    }

    // ❗ Placeholder: we are not yet unpacking the ZIP and inserting deeds.
    // For now we just accept the file and respond with a clear message.
    return res.status(501).json({
      error: 'ZIP upload not fully implemented yet – please upload single PDFs for now.'
    });
  } catch (err) {
    console.error('ZIP upload error:', err);
    return res.status(500).json({
      error: 'upload-zip failed: ' + (err.message || String(err))
    });
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

    if (!req.file) {
      return res.status(400).json({ error: 'no file uploaded' });
    }

    let wb;
    try {
      wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    } catch (e) {
      return res.status(400).json({
        error:
          'failed to process metadata: unable to read Excel file, please make sure you used the downloaded template and saved as .xlsx',
        detail: e.message || String(e)
      });
    }

    if (!wb.SheetNames || wb.SheetNames.length === 0) {
      return res.status(400).json({
        error: 'failed to process metadata: no sheets found in Excel file',
        detail: 'Workbook has no SheetNames'
      });
    }

    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      return res.status(400).json({
        error: 'failed to process metadata: first sheet not found in Excel file',
        detail: 'Sheet object undefined'
      });
    }

    let rows;
    try {
      rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
    } catch (e) {
      return res.status(400).json({
        error: 'failed to process metadata: could not parse rows from Excel file',
        detail: e.message || String(e)
      });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        error: 'failed to process metadata: no data rows found in Excel – ensure you filled in the template',
        detail: 'sheet_to_json returned empty array'
      });
    }

    let updated = 0;
    const notFound = [];
    let processed = 0;

    for (const rawRow of rows) {
      processed++;

      // Normalize headers, in case Excel changed capitalization
      const row = {
        filename: (rawRow.filename || rawRow.FILENAME || rawRow['FileName'] || '').toString().trim(),
        grantor: rawRow.grantor || rawRow.GRANTOR || rawRow['Grantor'] || '',
        grantee: rawRow.grantee || rawRow.GRANTEE || rawRow['Grantee'] || '',
        recording_date: rawRow.recording_date || rawRow['recording_date'] || rawRow['Recording Date'] || '',
        dated_date: rawRow.dated_date || rawRow['dated_date'] || rawRow['Dated Date'] || '',
        recording_book: rawRow.recording_book || rawRow['recording_book'] || rawRow['Recording Book'] || '',
        recording_page: rawRow.recording_page || rawRow['recording_page'] || rawRow['Recording Page'] || '',
        instrument_number: rawRow.instrument_number || rawRow['instrument_number'] || rawRow['Instrument Number'] || ''
      };

      if (!row.filename) {
        // Skip blank lines / header row
        continue;
      }

        const r = await db.query(
    `
    UPDATE deeds SET
      grantor=$2,
      grantee=$3,
      recording_date=$4,
      dated_date=$5,
      recording_book=$6,
      recording_page=$7,
      instrument_number=$8
    WHERE filename=$1
    RETURNING id
  `,
    [
      row.filename,
      row.grantor ? row.grantor.toString().trim() : null,
      row.grantee ? row.grantee.toString().trim() : null,

      // ✅ use helper to convert Excel serials like 44111 to "YYYY-MM-DD"
      normalizeDateValue(row.recording_date),
      normalizeDateValue(row.dated_date),

      row.recording_book ? row.recording_book.toString().trim() : null,
      row.recording_page ? row.recording_page.toString().trim() : null,
      row.instrument_number ? row.instrument_number.toString().trim() : null
    ]
  );

      if (r.rowCount === 0) {
        notFound.push(row.filename);
      } else {
        updated++;
      }
    }

    return res.json({
      message: `Processed ${processed} rows. Metadata updated for ${updated} deed(s).`,
      notFound
    });
  } catch (err) {
    console.error('Metadata upload error:', err);
    // ✅ Put the real error message into "error" so the front-end displays it
    return res.status(500).json({
      error: 'failed to process metadata: ' + (err.message || String(err))
    });
  }
});

module.exports = router;

// src/routes/deeds.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// AWS SDK v3
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const UPLOAD_TO_S3 = (process.env.UPLOAD_TO_S3 === 'true' || false);
const S3_BUCKET = process.env.AWS_S3_BUCKET;
const S3_REGION = process.env.AWS_REGION || 'us-east-1';

// Local upload dir (fallback)
const uploadDir = process.env.UPLOAD_PATH || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// S3 client (if enabled)
let s3Client = null;
if (UPLOAD_TO_S3) {
  s3Client = new S3Client({
    region: S3_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    }
  });
}

// We'll accept files into memory first (buffer), then either write to disk or upload to S3
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (process.env.MAX_UPLOAD_MB ? parseInt(process.env.MAX_UPLOAD_MB, 10) : 25) * 1024 * 1024
  }
});

// =========================================
// Auth helpers
// =========================================
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
  } catch (err) {
    return null;
  }
}

// =========================================
// Excel / date helpers (kept from prior impl — safe to include)
// =========================================
function excelSerialToISO(serial) {
  if (serial === null || serial === undefined || serial === '') return null;
  const n = Number(serial);
  if (Number.isNaN(n)) return null;
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(excelEpoch.getTime() + n * 24 * 60 * 60 * 1000);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function normalizeDateValue(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return excelSerialToISO(val);
  const s = val.toString().trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return excelSerialToISO(parseInt(s, 10));
  return s;
}

// ======================================================
// Helper: write buffer to local disk (returns filename)
// ======================================================
function writeBufferToDisk(buffer, originalname) {
  const ext = path.extname(originalname) || '.pdf';
  const filename = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
  const dest = path.join(uploadDir, filename);
  fs.writeFileSync(dest, buffer);
  return filename;
}

// ======================================================
// Helper: upload buffer to S3 (returns key or public URL)
// ======================================================
async function uploadBufferToS3(buffer, originalname, mimetype) {
  if (!s3Client) throw new Error('S3 client not configured');

  const ext = path.extname(originalname) || '.pdf';
  const key = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;

  const params = {
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype || 'application/pdf'
    // Note: do not use ACL public-read unless you want public objects.
  };

  await s3Client.send(new PutObjectCommand(params));

  // Return the key (we store key in DB). For direct access you can build URL:
  // If bucket is public or you configure CloudFront, you can use public URL.
  const publicUrl = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
  return { key, publicUrl };
}

// ======================================================
// Upload single PDF (admin/trainer)
// ======================================================
router.post('/upload', authMiddleware, uploadMemory.single('deed'), async (req, res) => {
  try {
    if (!['trainer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden: only trainer/admin can upload deeds' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'no file uploaded – please select a PDF' });
    }

    const { originalname, mimetype, buffer } = req.file;
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

    // Save file: either to S3 (preferred) or to local disk
    let storedPath = null;
    let publicUrl = null;
    if (UPLOAD_TO_S3) {
      if (!S3_BUCKET) {
        return res.status(500).json({ error: 'S3 bucket not configured in environment' });
      }
      const r = await uploadBufferToS3(buffer, originalname, mimetype);
      // store the s3 key in filepath column. Frontend will build public URL via env or we can return publicUrl
      storedPath = r.key;
      publicUrl = r.publicUrl;
    } else {
      // local disk
      const filename = writeBufferToDisk(buffer, originalname);
      storedPath = filename;
    }

    const q = await db.query(
      `INSERT INTO deeds (
         filename, filepath, document_type, grantor, grantee, recording_date, dated_date,
         recording_book, recording_page, instrument_number
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        originalname,
        storedPath,
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

    const deed = q.rows[0];
    // also return publicUrl (if S3) so frontend can open it immediately
    return res.json({ deed, publicUrl: publicUrl || null });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'upload failed: ' + (err.message || String(err)) });
  }
});

// ======================================================
// Placeholder: upload zip (not implemented)
// ======================================================
router.post('/upload-zip', authMiddleware, uploadMemory.single('zip'), async (req, res) => {
  try {
    if (!['trainer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden: only trainer/admin can upload deeds' });
    }
    if (!req.file) return res.status(400).json({ error: 'no ZIP uploaded' });
    return res.status(501).json({ error: 'ZIP upload not implemented yet — use single uploads or ask me to implement full unzip logic' });
  } catch (err) {
    console.error('ZIP upload error:', err);
    return res.status(500).json({ error: 'upload-zip failed: ' + (err.message || String(err)) });
  }
});

// ======================================================
// GET Next - latest with filepath (unattempted for user)
// ======================================================
router.get('/next', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT d.*
      FROM deeds d
      LEFT JOIN attempts a
        ON a.deed_id = d.id
       AND a.user_id = $1
      WHERE a.id IS NULL
        AND d.filepath IS NOT NULL
        AND d.filepath <> ''
      ORDER BY d.id DESC
      LIMIT 1
    `,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No more deeds with a PDF file available for this user' });
    }

    return res.json({ deed: result.rows[0] });
  } catch (err) {
    console.error('Error in /api/deeds/next:', err);
    return res.status(500).json({ error: 'failed to load next deed' });
  }
});

// ======================================================
// GET deed by id (returns filepath/key)
// ======================================================
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM deeds WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'deed not found' });

    const deed = result.rows[0];

    // If using S3, include a publicUrl if configured to build one
    if (UPLOAD_TO_S3 && deed.filepath) {
      deed.publicUrl = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${deed.filepath}`;
    } else if (!UPLOAD_TO_S3 && deed.filepath) {
      deed.publicUrl = `/uploads/${deed.filepath}`;
    }

    return res.json({ deed });
  } catch (err) {
    console.error('Error in GET /api/deeds/:id:', err);
    return res.status(500).json({ error: 'failed to load deed' });
  }
});

// ======================================================
// Serve local file (if local storage). When using S3, the frontend should open publicUrl.
// ======================================================
router.get('/:id/file', authMiddleware, async (req, res) => {
  try {
    const q = await db.query('SELECT filepath FROM deeds WHERE id=$1', [req.params.id]);
    if (q.rowCount === 0) return res.status(404).send('Not found');
    const fp = q.rows[0].filepath;
    if (!fp) return res.status(404).send('File missing');

    if (UPLOAD_TO_S3) {
      // If S3 is enabled we don't stream from server. Return redirect to public URL (or 403 if you require signed URLs)
      const publicUrl = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${fp}`;
      return res.redirect(publicUrl);
    }

    const fullPath = path.join(uploadDir, fp);
    if (!fs.existsSync(fullPath)) return res.status(404).send('File missing');
    return res.sendFile(fullPath);
  } catch (err) {
    console.error('Error in GET /api/deeds/:id/file:', err);
    return res.status(500).send('Error');
  }
});

// ======================================================
// Template & metadata endpoints kept as earlier — omitted in this snippet for brevity.
// If you had /template and /metadata routes previously, merge them here.
// ======================================================

module.exports = router;

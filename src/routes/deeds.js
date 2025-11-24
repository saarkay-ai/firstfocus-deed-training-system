const express = require('express');
const router = express.Router();
const db = require('../db');
const multer  = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadDir); },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random()*1e6) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: (process.env.MAX_UPLOAD_MB? parseInt(process.env.MAX_UPLOAD_MB):25) * 1024 * 1024 } });

function authMiddleware(req, res, next){
  const bearer = (req.headers.authorization || '').split(' ')[1] || req.cookies && req.cookies.token;
  const token = bearer;
  if(!token) return res.status(401).json({ error: 'not authenticated' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    req.user = payload;
    return next();
  } catch(e){ return res.status(401).json({ error: 'invalid token' }); }
}

// single upload (trainer/admin)
router.post('/upload', authMiddleware, upload.single('deed'), async (req, res) => {
  try {
    if(!['trainer','admin'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    const { originalname, filename } = req.file;
    const { document_type, grantor, grantee, recording_date, dated_date, county_name, county_state, apn, recording_book, recording_page, instrument_number } = req.body;
    const q = await db.query(
      `INSERT INTO deeds (filename, filepath, document_type, grantor, grantee, recording_date, dated_date, county_name, county_state, apn, recording_book, recording_page, instrument_number, created_by) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [originalname, filename, document_type || null, grantor || null, grantee || null, recording_date || null, dated_date || null, county_name||null, county_state||null, apn||null, recording_book||null, recording_page||null, instrument_number||null, req.user.id]
    );
    res.json({ deed: q.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'upload failed' }); }
});

# truncated to fit message
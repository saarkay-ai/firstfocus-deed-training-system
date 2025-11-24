require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const deedsRoutes = require('./routes/deeds');
const attemptsRoutes = require('./routes/attempts');

const app = express();
const PORT = process.env.PORT || 4000;

// =========================
// UPLOAD DIRECTORY (PDFs)
// =========================
// All deed PDFs live in: src/uploads/deeds
const uploadsRoot = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads', 'deeds');
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

// =========================
// SECURITY & MIDDLEWARE
// =========================
app.use(
  helmet({
    frameguard: false,            // allow iframe embedding from GitHub Pages
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CLIENT_URL || true,
    credentials: true
  })
);

const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use(limiter);

// =========================
// STATIC FILES (PDF SERVE)
// =========================
// Any file saved under uploadsRoot is served as:
//   GET /uploads/<filename>
app.use('/uploads', express.static(uploadsRoot));

// =========================
// ROUTES
// =========================
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/deeds', deedsRoutes);
app.use('/api/attempts', attemptsRoutes);

app.get('/', (req, res) =>
  res.json({ ok: true, message: 'Deed Training Backend' })
);

// =========================
// START SERVER
// =========================
app.listen(PORT, () =>
  console.log(`Server listening on port ${PORT}`)
);
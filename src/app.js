require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const db = require('./db');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const deedsRoutes = require('./routes/deeds');
const attemptsRoutes = require('./routes/attempts');

const app = express();
const PORT = process.env.PORT || 4000;

// ensure upload dir exists (root /uploads)
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ✅ Relax Helmet so PDFs can be embedded in iframe from GitHub Pages
app.use(
  helmet({
    frameguard: false,                // allow iframe embedding from other origins
    crossOriginResourcePolicy: false, // allow other origins to load static files
    contentSecurityPolicy: false      // keep CSP simple for now
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

// static uploads – this will also serve /uploads/deeds/...
app.use('/uploads', express.static(uploadDir));

// routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/deeds', deedsRoutes);
app.use('/api/attempts', attemptsRoutes);

app.get('/', (req, res) =>
  res.json({ ok: true, message: 'Deed Training Backend' })
);

app.listen(PORT, () =>
  console.log(`Server listening on port ${PORT}`)
);
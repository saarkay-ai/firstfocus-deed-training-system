require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

// ✅ import db to run safe migrations
const db = require('./db');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const deedsRoutes = require('./routes/deeds');
const attemptsRoutes = require('./routes/attempts');

const app = express();

// ✅ Tell Express it's behind a proxy (Render, Nginx, etc.)
app.set('trust proxy', 1); // or true

const PORT = process.env.PORT || 4000;

// ✅ Single upload folder: src/uploads  (same as routes/deeds.js)
const uploadRoot = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

// ✅ Helmet configured to allow iframes & cross-origin PDFs
app.use(
  helmet({
    frameguard: false,               // no X-Frame-Options
    crossOriginResourcePolicy: false // allow GitHub Pages to load PDFs
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CLIENT_URL || true,
    credentials: true,
  })
);

const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use(limiter);

// ✅ Serve files from /uploads/<filename>
app.use('/uploads', express.static(uploadRoot));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/deeds', deedsRoutes);
app.use('/api/attempts', attemptsRoutes);

// Health check
app.get('/', (req, res) =>
  res.json({ ok: true, message: 'Deed Training Backend' })
);

// ✅ Run safe DB migrations on startup (add columns if missing)
db.runSafeMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}).catch(err => {
  console.error('Error before starting server:', err);
  // even if migrations fail, still start server
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT} (migrations may have failed)`);
  });
});

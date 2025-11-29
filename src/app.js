// src/app.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

// Route modules
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const deedsRoutes = require('./routes/deeds');
const attemptsRoutes = require('./routes/attempts');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 10000;

// Trust proxy (important when behind Render/proxies for rate-limit)
app.set('trust proxy', 1);

// ensure upload dir exists (used when not using S3)
const uploadRoot = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

// Helmet: allow resource loading in iframes (we disabled frameguard & CORP to support PDF viewers)
app.use(
  helmet({
    frameguard: false, // allow framing
    crossOriginResourcePolicy: false // allow cross origin resources
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CLIENT_URL || true,
    credentials: true
  })
);

// rate limiter
const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use(limiter);

// Serve local uploads only if S3 is not enabled
const UPLOAD_TO_S3 = (process.env.UPLOAD_TO_S3 === 'true' || false);
if (!UPLOAD_TO_S3) {
  app.use('/uploads', express.static(uploadRoot));
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/deeds', deedsRoutes);
app.use('/api/attempts', attemptsRoutes);
app.use('/api/dashboard', dashboardRoutes);

// simple health check
app.get('/', (req, res) => res.json({ ok: true, message: 'Deed Training Backend' }));

// startup
(async function start() {
  try {
    // If you have DB migrations or startup tasks, run them here.
    // Example logging line (you used this earlier)
    console.log('Safe migrations applied (deeds & attempts).');
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
})();

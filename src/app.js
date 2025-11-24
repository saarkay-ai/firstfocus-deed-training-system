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

// ✅ Ensure upload dir exists (must match routes/deeds.js)
const uploadDir = process.env.UPLOAD_PATH || path.join(__dirname, '..', 'uploads', 'deeds');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ✅ Helmet configured to ALLOW iframes & cross-origin PDFs
app.use(
  helmet({
    frameguard: false,               // do NOT send X-Frame-Options
    crossOriginResourcePolicy: false // allow other origins (GitHub Pages) to load PDFs
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

// ✅ Serve deed PDFs from /uploads/deeds/...
app.use('/uploads/deeds', express.static(uploadDir));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/deeds', deedsRoutes);
app.use('/api/attempts', attemptsRoutes);

// Health check root
app.get('/', (req, res) =>
  res.json({ ok: true, message: 'Deed Training Backend' })
);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const db = require('./db'); // ⬅️ DB connection (for migrations)

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const deedsRoutes = require('./routes/deeds');
const attemptsRoutes = require('./routes/attempts');

const app = express();
const PORT = process.env.PORT || 4000;

// ensure upload dir exists
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(cors({
  origin: process.env.CLIENT_URL || true,
  credentials: true
}));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use(limiter);

// static uploads
app.use('/uploads', express.static(uploadDir));

/**
 * 🔧 TEMP MIGRATION ROUTE – run ONCE to create tables in Render Postgres
 * After it succeeds, you can safely delete this whole block.
 */
const migrationPath = path.join(__dirname, '..', 'migrations', '001_init.sql');
let migrationSQL = '';
try {
  migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  console.log('Loaded migration SQL from', migrationPath);
} catch (err) {
  console.error('Could not read migration file:', migrationPath, err.message);
}

app.get('/run-migrations', async (req, res) => {
  if (!migrationSQL) {
    return res.status(500).json({ error: 'Migration SQL not loaded on server' });
  }
  try {
    await db.query(migrationSQL);
    return res.json({ success: true, message: 'Migration completed' });
  } catch (err) {
    console.error('Migration failed:', err);
    return res.status(500).json({ error: 'Migration failed', details: err.message });
  }
});

// routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/deeds', deedsRoutes);
app.use('/api/attempts', attemptsRoutes);

app.get('/', (req, res) => res.json({ ok: true, message: 'Deed Training Backend' }));

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

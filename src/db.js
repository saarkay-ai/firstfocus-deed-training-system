// src/db.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

// ✅ Safe migrations: only ADD columns if they don't already exist
async function runSafeMigrations() {
  try {
    // Deeds table – scoring-related columns
    await pool.query(`
      ALTER TABLE deeds
        ADD COLUMN IF NOT EXISTS recording_book TEXT,
        ADD COLUMN IF NOT EXISTS recording_page TEXT,
        ADD COLUMN IF NOT EXISTS instrument_number TEXT
    `);

    // Attempts table – scoring columns
    await pool.query(`
      ALTER TABLE attempts
        ADD COLUMN IF NOT EXISTS total_score INTEGER,
        ADD COLUMN IF NOT EXISTS feedback TEXT
    `);

    console.log('Safe migrations applied (deeds & attempts).');
  } catch (err) {
    // If table doesn't exist or other error, log but don't crash server
    console.error('Error running safe migrations:', err.message || err);
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  runSafeMigrations,
};

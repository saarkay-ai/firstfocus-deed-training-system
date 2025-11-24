const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// signup (open for trainees)
router.post('/signup', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username & password required' });
    const hashed = await bcrypt.hash(password, 12);
    const result = await db.query('INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING id, username, role', [username, hashed, role || 'trainee']);
    const user = result.rows[0];
    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'username taken' });
    console.error(err); res.status(500).json({ error: 'server error' });
  }
});

// login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const q = await db.query('SELECT id, username, password_hash, role FROM users WHERE username = $1', [username]);
    if (!q.rows.length) return res.status(401).json({ error: 'invalid credentials' });
    const user = q.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server error' }); }
});

// logout
router.post('/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

// me
router.get('/me', (req, res) => {
  const token = req.cookies && req.cookies.token || req.headers.authorization && req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  try { const payload = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'dev_secret'); res.json({ user: payload }); } 
  catch (err) { return res.status(401).json({ error: 'invalid token' }); }
});

module.exports = router;

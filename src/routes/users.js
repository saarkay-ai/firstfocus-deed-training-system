const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

function verifyAdmin(req, res, next){
  try {
    const auth = (req.headers.authorization || '').split(' ')[1] || req.cookies && req.cookies.token;
    if(!auth) return res.status(401).json({error:'unauth'});
    const payload = jwt.verify(auth, JWT_SECRET);
    if(payload.role !== 'admin' && payload.role !== 'trainer') return res.status(403).json({error:'forbidden'});
    req.user = payload; next();
  } catch(err){ return res.status(401).json({error:'invalid token'}); }
}

// list users
router.get('/', verifyAdmin, async (req, res) => {
  const q = await db.query('SELECT id, username, role, created_at FROM users ORDER BY id ASC');
  res.json({ users: q.rows });
});

// create user (admin/trainer)
router.post('/', verifyAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if(!username || !password) return res.status(400).json({ error: 'username & password' });
    const hashed = await bcrypt.hash(password, 12);
    const r = await db.query('INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING id, username, role', [username, hashed, role||'trainee']);
    res.json({ user: r.rows[0] });
  } catch(err){ if(err.code === '23505') return res.status(409).json({ error: 'username taken' }); console.error(err); res.status(500).json({ error: 'server error' }); }
});

module.exports = router;

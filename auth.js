/**
 * routes/auth.js
 * ------------------------------------------------------------------
 * Registration & login. Passwords hashed with bcrypt, sessions
 * issued as JWTs — same pattern as your Platinum Bank project.
 * ------------------------------------------------------------------
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const { JWT_SECRET } = require('./middleware');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body || {};

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Username, email and password are all required.' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ message: 'Username must be 3-20 characters (letters, numbers, underscore).' });
    }
    if (!email.includes('@') || !email.includes('.')) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }
    if (db.findUserByUsername(username)) {
      return res.status(409).json({ message: 'That username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: uuidv4(),
      username,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    const users = db.getUsers();
    users.push(user);
    await db.saveUsers(users);

    res.status(201).json({ message: 'Account created. Please log in.' });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    const user = db.findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, username: user.username });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

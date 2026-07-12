/**
 * middleware.js
 * ------------------------------------------------------------------
 * JWT authentication middleware, plus a small request logger and
 * a centralized error handler. Matches the bcrypt/JWT pattern used
 * in your other projects (e.g. Platinum Bank).
 * ------------------------------------------------------------------
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Missing or malformed Authorization header.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token.' });
    }
    req.user = decoded; // { id, username }
    next();
  });
}

function requestLogger(req, res, next) {
  const time = new Date().toISOString();
  console.log(`[${time}] ${req.method} ${req.originalUrl}`);
  next();
}

// Must be registered last, after all routes
function errorHandler(err, req, res, next) {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || 'Internal server error.',
  });
}

module.exports = { authenticateToken, requestLogger, errorHandler, JWT_SECRET };

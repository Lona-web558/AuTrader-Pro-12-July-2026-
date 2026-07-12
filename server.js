/**
 * server.js
 * ------------------------------------------------------------------
 * AuTrader Pro — Bitcoin Wallet Management Backend
 * Express entry point. Flat-file JSON storage, JWT auth, live
 * BTC/ZAR conversion via CoinGecko. Designed to deploy on Render
 * the same way as your other Node backends.
 * ------------------------------------------------------------------
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const db = require('./db');
const { requestLogger, errorHandler } = require('./middleware');
const authRoutes = require('./auth');
const walletRoutes = require('./wallet');

const app = express();
const PORT = process.env.PORT || 3000;

db.ensureDataFiles();

app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.get('/', (req, res) => {
  res.json({
    service: 'AuTrader Pro Bitcoin Wallet Backend',
    status: 'running',
    time: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Not found.' });
});

// Central error handler — must be last
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`AuTrader Bitcoin backend listening on port ${PORT}`);
});

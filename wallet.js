/**
 * wallet.js
 * ------------------------------------------------------------------
 * Core Bitcoin wallet logic:
 *  - fetches a live BTC/ZAR exchange rate (CoinGecko public API, cached)
 *  - validates Bitcoin wallet addresses (legacy / P2SH / bech32)
 *  - converts ZAR trading profit into a BTC-denominated balance
 *  - queues withdrawal requests to a user's Bitcoin address
 *
 * This module manages BALANCES AND RECORDS ONLY. It does not sign
 * or broadcast real Bitcoin transactions — withdrawals are queued
 * as "pending" for manual processing/payout, exactly like your
 * existing bank-withdrawal flow. If you later want on-chain payouts,
 * swap sendPayout() in the withdrawals route for a real exchange/
 * custodial API (e.g. Luno, VALR) — never store or transmit private
 * keys in this codebase.
 * ------------------------------------------------------------------
 */

const express = require('express');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { authenticateToken } = require('./middleware');

const router = express.Router();

const COINGECKO_URL =
  process.env.COINGECKO_API_URL ||
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=zar';

const RATE_CACHE_MS = 60 * 1000; // 60s cache so we don't hammer the API
let rateCache = { rateZarPerBtc: null, fetchedAt: 0 };

/**
 * Fetch the current BTC/ZAR rate, using a short-lived cache.
 */
async function getExchangeRate() {
  const now = Date.now();
  if (rateCache.rateZarPerBtc && now - rateCache.fetchedAt < RATE_CACHE_MS) {
    return rateCache.rateZarPerBtc;
  }

  const res = await fetch(COINGECKO_URL, { timeout: 8000 });
  if (!res.ok) {
    throw new Error(`Failed to fetch BTC/ZAR rate (status ${res.status})`);
  }
  const data = await res.json();
  const rate = data?.bitcoin?.zar;
  if (!rate || typeof rate !== 'number') {
    throw new Error('Unexpected response shape from exchange rate provider');
  }

  rateCache = { rateZarPerBtc: rate, fetchedAt: now };
  return rate;
}

/**
 * Validate a Bitcoin address format:
 *  - Legacy P2PKH: starts with 1
 *  - P2SH: starts with 3
 *  - Bech32 (native segwit): starts with bc1
 * This is a format check only — it does NOT confirm the address
 * is reachable or has ever been used on-chain.
 */
function isValidBtcAddress(address) {
  if (typeof address !== 'string') return false;
  const trimmed = address.trim();
  const legacyOrP2sh = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const bech32 = /^bc1[a-z0-9]{25,59}$/;
  return legacyOrP2sh.test(trimmed) || bech32.test(trimmed);
}

/**
 * Get (or lazily create) a user's wallet record.
 */
function getOrCreateWallet(userId) {
  const wallets = db.getWallets();
  let wallet = wallets.find(w => w.userId === userId);
  if (!wallet) {
    wallet = {
      id: uuidv4(),
      userId,
      zarBalance: 0,       // uninvested/available ZAR balance (trading profits land here)
      btcBalance: 0,        // BTC already converted, awaiting withdrawal
      btcWithdrawn: 0,       // lifetime BTC sent out
      zarWithdrawn: 0,       // lifetime ZAR-equivalent sent out
      createdAt: new Date().toISOString(),
    };
    wallets.push(wallet);
    db.saveWallets(wallets);
  }
  return wallet;
}

function getWalletSummary(userId) {
  const wallet = getOrCreateWallet(userId);
  const pendingWithdrawals = db.getWithdrawals().filter(
    w => w.userId === userId && w.status === 'pending'
  );
  return { wallet, pendingWithdrawals };
}

/**
 * Convert a ZAR amount (e.g. trading profit) into BTC at the live
 * rate, moving it from zarBalance into btcBalance. Logs a transaction.
 */
async function convertZarToBtc(userId, zarAmount) {
  if (!zarAmount || zarAmount <= 0) {
    const err = new Error('Conversion amount must be greater than zero.');
    err.status = 400;
    throw err;
  }

  const wallets = db.getWallets();
  const wallet = wallets.find(w => w.userId === userId) || getOrCreateWallet(userId);

  if (zarAmount > wallet.zarBalance) {
    const err = new Error(
      `Insufficient ZAR balance. Available: R${wallet.zarBalance.toFixed(2)}`
    );
    err.status = 400;
    throw err;
  }

  const rate = await getExchangeRate();
  const btcAmount = zarAmount / rate;

  wallet.zarBalance = +(wallet.zarBalance - zarAmount).toFixed(2);
  wallet.btcBalance = +(wallet.btcBalance + btcAmount).toFixed(8);

  const idx = wallets.findIndex(w => w.userId === userId);
  wallets[idx] = wallet;
  await db.saveWallets(wallets);

  const tx = {
    id: uuidv4(),
    userId,
    type: 'conversion',
    zarAmount,
    btcAmount,
    rateZarPerBtc: rate,
    createdAt: new Date().toISOString(),
  };
  await db.addTransaction(tx);

  return { wallet, transaction: tx };
}

/**
 * Queue a withdrawal of ZAR-denominated balance, converted to BTC
 * at the live rate, to a validated Bitcoin address. Status starts
 * as "pending" for manual payout processing (same pattern as your
 * bank withdrawal flow) — mark it "completed" once you've actually
 * sent the BTC.
 */
async function requestWithdrawal(userId, zarAmount, btcAddress) {
  if (!zarAmount || zarAmount <= 0) {
    const err = new Error('Withdrawal amount must be greater than zero.');
    err.status = 400;
    throw err;
  }
  if (!isValidBtcAddress(btcAddress)) {
    const err = new Error('Invalid Bitcoin wallet address format.');
    err.status = 400;
    throw err;
  }

  const wallets = db.getWallets();
  const wallet = wallets.find(w => w.userId === userId) || getOrCreateWallet(userId);

  if (zarAmount > wallet.zarBalance) {
    const err = new Error(
      `Insufficient balance. Available: R${wallet.zarBalance.toFixed(2)}`
    );
    err.status = 400;
    throw err;
  }

  const rate = await getExchangeRate();
  const btcAmount = zarAmount / rate;

  // Move funds out of the available balance immediately so it can't
  // be double-spent while the payout is pending manual processing.
  wallet.zarBalance = +(wallet.zarBalance - zarAmount).toFixed(2);
  wallet.zarWithdrawn = +(wallet.zarWithdrawn + zarAmount).toFixed(2);

  const idx = wallets.findIndex(w => w.userId === userId);
  wallets[idx] = wallet;
  await db.saveWallets(wallets);

  const withdrawal = {
    id: uuidv4(),
    reference: 'BTC-' + Date.now().toString(36).toUpperCase() + '-' + uuidv4().slice(0, 5).toUpperCase(),
    userId,
    zarAmount,
    btcAmount,
    rateZarPerBtc: rate,
    btcAddress: btcAddress.trim(),
    status: 'pending', // pending -> completed | failed
    submittedAt: new Date().toISOString(),
    completedAt: null,
  };
  await db.addWithdrawal(withdrawal);

  const tx = {
    id: uuidv4(),
    userId,
    type: 'withdrawal_request',
    zarAmount,
    btcAmount,
    rateZarPerBtc: rate,
    reference: withdrawal.reference,
    createdAt: new Date().toISOString(),
  };
  await db.addTransaction(tx);

  return withdrawal;
}

/**
 * Credit trading profit into a user's ZAR wallet balance (called
 * from wherever your trading engine settles a winning trade).
 */
async function creditProfit(userId, zarAmount) {
  if (!zarAmount || zarAmount <= 0) return getOrCreateWallet(userId);
  const wallets = db.getWallets();
  const wallet = wallets.find(w => w.userId === userId) || getOrCreateWallet(userId);
  wallet.zarBalance = +(wallet.zarBalance + zarAmount).toFixed(2);
  const idx = wallets.findIndex(w => w.userId === userId);
  wallets[idx] = wallet;
  await db.saveWallets(wallets);
  return wallet;
}

/**
 * Mark a pending withdrawal as completed (or failed) once you've
 * manually sent the BTC from your exchange/wallet of choice.
 */
async function updateWithdrawalStatus(reference, status) {
  if (!['completed', 'failed', 'pending'].includes(status)) {
    const err = new Error('Invalid status.');
    err.status = 400;
    throw err;
  }
  const withdrawals = db.getWithdrawals();
  const idx = withdrawals.findIndex(w => w.reference === reference);
  if (idx === -1) {
    const err = new Error('Withdrawal reference not found.');
    err.status = 404;
    throw err;
  }
  withdrawals[idx].status = status;
  withdrawals[idx].completedAt = status === 'completed' ? new Date().toISOString() : null;
  await db.saveWithdrawals(withdrawals);
  return withdrawals[idx];
}

// ------------------------------------------------------------------
// Routes — all wallet endpoints require a valid JWT (authenticateToken)
// ------------------------------------------------------------------

// GET /api/wallet  -> wallet balance + any pending withdrawals
router.get('/', authenticateToken, (req, res, next) => {
  try {
    const summary = getWalletSummary(req.user.id);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// GET /api/wallet/rate -> current BTC/ZAR exchange rate
router.get('/rate', authenticateToken, async (req, res, next) => {
  try {
    const rate = await getExchangeRate();
    res.json({ rateZarPerBtc: rate });
  } catch (err) {
    next(err);
  }
});

// POST /api/wallet/convert  { zarAmount }
router.post('/convert', authenticateToken, async (req, res, next) => {
  try {
    const { zarAmount } = req.body || {};
    const result = await convertZarToBtc(req.user.id, Number(zarAmount));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/wallet/withdraw  { zarAmount, btcAddress }
router.post('/withdraw', authenticateToken, async (req, res, next) => {
  try {
    const { zarAmount, btcAddress } = req.body || {};
    const withdrawal = await requestWithdrawal(req.user.id, Number(zarAmount), btcAddress);
    res.status(201).json(withdrawal);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/wallet/withdraw/:reference  { status } -> admin/manual payout update
router.patch('/withdraw/:reference', authenticateToken, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    const updated = await updateWithdrawalStatus(req.params.reference, status);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

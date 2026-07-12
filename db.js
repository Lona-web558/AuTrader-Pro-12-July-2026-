/**
 * db.js
 * ------------------------------------------------------------------
 * Minimal flat-file JSON "database" — matches the rest of the
 * AuTrader / Gold Fundamentals stack (no MongoDB dependency needed
 * for this service). Data lives in /data as JSON files.
 *
 * NOTE: Render's free tier has an EPHEMERAL filesystem — anything
 * written here will be wiped on redeploy/restart. For persistence
 * across deploys, either upgrade to a paid disk, or swap this out
 * for MongoDB Atlas (you already have a cluster: cluster0.gka8ttb.mongodb.net)
 * using the same function signatures below.
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  wallets: path.join(DATA_DIR, 'wallets.json'),
  transactions: path.join(DATA_DIR, 'transactions.json'),
  withdrawals: path.join(DATA_DIR, 'withdrawals.json'),
};

// simple in-process write queue per file, so concurrent requests
// don't clobber each other's writes
const writeQueues = {};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const file of Object.values(FILES)) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8');
  }
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (err) {
    console.error(`[db] Failed to read ${filePath}:`, err.message);
    return [];
  }
}

function writeJson(filePath, data) {
  const key = filePath;
  writeQueues[key] = (writeQueues[key] || Promise.resolve()).then(() => {
    return new Promise((resolve, reject) => {
      const tmpPath = filePath + '.tmp';
      fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8', (err) => {
        if (err) return reject(err);
        fs.rename(tmpPath, filePath, (err2) => {
          if (err2) return reject(err2);
          resolve();
        });
      });
    });
  });
  return writeQueues[key];
}

/* ---------- Users ---------- */
function getUsers() { return readJson(FILES.users); }
function saveUsers(users) { return writeJson(FILES.users, users); }
function findUserByUsername(username) {
  return getUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
}
function findUserById(id) {
  return getUsers().find(u => u.id === id);
}

/* ---------- Wallets (one BTC wallet record per user) ---------- */
function getWallets() { return readJson(FILES.wallets); }
function saveWallets(wallets) { return writeJson(FILES.wallets, wallets); }
function findWalletByUserId(userId) {
  return getWallets().find(w => w.userId === userId);
}

/* ---------- Transactions (conversions, balance changes) ---------- */
function getTransactions() { return readJson(FILES.transactions); }
function saveTransactions(txs) { return writeJson(FILES.transactions, txs); }
function addTransaction(tx) {
  const txs = getTransactions();
  txs.unshift(tx);
  return saveTransactions(txs);
}

/* ---------- Withdrawals (pending/completed BTC payouts) ---------- */
function getWithdrawals() { return readJson(FILES.withdrawals); }
function saveWithdrawals(list) { return writeJson(FILES.withdrawals, list); }
function addWithdrawal(w) {
  const list = getWithdrawals();
  list.unshift(w);
  return saveWithdrawals(list);
}

module.exports = {
  ensureDataFiles,
  getUsers, saveUsers, findUserByUsername, findUserById,
  getWallets, saveWallets, findWalletByUserId,
  getTransactions, saveTransactions, addTransaction,
  getWithdrawals, saveWithdrawals, addWithdrawal,
};

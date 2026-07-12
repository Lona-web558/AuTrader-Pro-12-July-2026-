# AuTrader Pro — Bitcoin Wallet Update

This package contains two things:

1. **`frontend/autrader-pro.html`** — your existing AuTrader Pro UI with PayPal
   removed and replaced by a **"Withdraw to Bitcoin Wallet"** flow.
2. **`backend/`** — a new Node/Express backend that manages Bitcoin wallet
   balances: converting ZAR trading profit to BTC at the live market rate,
   validating wallet addresses, and queuing withdrawals for payout.

---

## What changed in the frontend

- Removed the PayPal withdrawal button, modal, and all related JS
  (`initiatePaypalWithdraw`, `ppAvailBalance`, etc.)
- Added a **"Withdraw to Bitcoin Wallet"** button and modal that:
  - Fetches a live BTC/ZAR rate (from your backend, or directly from
    CoinGecko if no backend URL is configured yet)
  - Validates the BTC address format (legacy `1...`, P2SH `3...`, bech32 `bc1...`)
  - Shows a live BTC estimate as the user types an amount
  - Submits the withdrawal to your backend and logs it in the withdrawal log
    alongside your existing bank withdrawals

To point the frontend at your deployed backend, set this **before** the
script block loads (e.g. in a small inline `<script>` tag near the top of
`<body>`, or by editing the `API_BASE_URL` line directly):

```html
<script>window.AUTRADER_API_BASE = 'https://your-backend.onrender.com';</script>
```

If you leave this unset, the Bitcoin withdrawal flow still works end-to-end
using CoinGecko directly and local logging — handy for testing before your
backend is deployed.

---

## Backend structure

```
backend/
  package.json
  server.js         — Express app entry point
  middleware.js      — JWT auth, request logging, error handler
  wallet.js          — core BTC wallet logic (conversion, validation, withdrawal)
  db.js              — flat-file JSON storage (users, wallets, transactions, withdrawals)
  routes/
    auth.js          — register / login (bcrypt + JWT)
    wallet.js         — wallet API endpoints
  data/              — JSON "database" files (created automatically on first run)
  .env.example       — copy to .env and fill in your own secrets
```

### Install & run locally

```bash
cd backend
npm install
cp .env.example .env
# edit .env — set a real JWT_SECRET
npm start
```

Server runs on `http://localhost:3000` by default.

### Deploy to Render (same pattern as your other Node backends)

1. Push the `backend/` folder to its own GitHub repo (or a subfolder Render
   can target).
2. Create a new **Web Service** on Render, connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables in Render's dashboard: `JWT_SECRET` (and
   `COINGECKO_API_URL` if you want to override the default).
6. ⚠️ **Render's free tier has an ephemeral filesystem** — the flat JSON
   files in `data/` will reset on every redeploy/restart. This mirrors your
   other free-tier deployments. For real persistence, either upgrade to a
   paid disk on Render, or swap `db.js` for your existing MongoDB Atlas
   cluster (`cluster0.gka8ttb.mongodb.net`) — the function signatures in
   `db.js` are written so you can drop in Mongoose calls without touching
   `wallet.js` or the routes.

---

## API reference

| Method | Endpoint                              | Auth | Description |
|--------|----------------------------------------|------|-------------|
| POST   | `/api/auth/register`                   | No   | Create an account |
| POST   | `/api/auth/login`                      | No   | Log in, returns a JWT |
| GET    | `/api/wallet/rate`                     | No   | Live BTC/ZAR rate |
| GET    | `/api/wallet/summary`                  | Yes  | Wallet balances + pending withdrawals |
| POST   | `/api/wallet/credit-profit`            | Yes  | Credit trading profit (ZAR) to the wallet |
| POST   | `/api/wallet/convert`                  | Yes  | Convert ZAR balance to BTC (no withdrawal) |
| POST   | `/api/wallet/withdraw`                 | Yes  | Convert + queue a withdrawal to a BTC address |
| GET    | `/api/wallet/withdrawals`              | Yes  | This user's withdrawal history |
| PATCH  | `/api/wallet/withdrawals/:reference`   | Yes  | Mark a withdrawal completed/failed |

Authenticated requests need `Authorization: Bearer <token>` from
`/api/auth/login`.

---

## Important: how payouts actually happen

This backend tracks balances and **queues** withdrawal requests — it does
**not** hold private keys or broadcast real Bitcoin transactions. Every
withdrawal is created with `status: "pending"`, exactly like your existing
bank-withdrawal flow (manual processing, 1–3 business days).

To actually send the BTC once a request comes in, you have two realistic
options:

1. **Manual, from your own wallet/exchange** (simplest, matches your current
   bank-withdrawal process): check `/api/wallet/withdrawals`, send the BTC
   yourself from wherever you hold it (e.g. Luno, VALR, a hardware wallet),
   then call `PATCH /api/wallet/withdrawals/:reference` with
   `{ "status": "completed" }`.
2. **Automated, via a custodial exchange API** (e.g. Luno or VALR's API):
   add a `sendPayout()` call inside the withdrawal route once you're ready —
   this backend is structured so that's a drop-in addition, but it was
   deliberately left out here since it requires your own exchange API keys
   and carries real financial/security responsibility.

Never store private keys, seed phrases, or exchange API secrets directly in
this codebase — keep them in environment variables at minimum, or better,
in a secrets manager.

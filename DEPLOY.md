# Deploying Loop

Everything is built, tested and committed. This is the whole path from here to a live URL you can
paste into Nimiq Pay.

Total time: about ten minutes, most of it waiting for two web pages to load.

---

## 1. Cloudflare (the app + database)

Loop runs as a single Cloudflare Worker that serves both the built Vue app and the API, backed by a
D1 (SQLite) database. Both are comfortably inside the free tier.

### Create the account and token

1. Sign up or sign in at **https://dash.cloudflare.com**.
2. Go to **My Profile → API Tokens → Create Token**.
3. Use the **Edit Cloudflare Workers** template. It grants exactly what `wrangler` needs.
4. Add one more permission the template omits: **Account → D1 → Edit**.
5. Create it and copy the token. It is shown once.

### Deploy

```bash
export CLOUDFLARE_API_TOKEN=<the token you just copied>

npm install
npx wrangler d1 create loop-db          # prints a database_id
# Paste that id into wrangler.toml, replacing the one already there.

npm run db:remote                        # create the tables
npm run deploy                           # build + deploy
```

`wrangler` prints the live URL, something like `https://loop-miniapp.<your-subdomain>.workers.dev`.

### Verify it

```bash
LOOP_BASE=https://loop-miniapp.<your-subdomain>.workers.dev node test/e2e.mjs
```

57 checks should pass against the live deployment, using real Nimiq signatures.

> **A note on `workers.dev` and bot protection.** A temporary, unclaimed Cloudflare preview account
> puts a managed bot challenge in front of everything, which breaks the app. A normal account does
> not. If you ever see a "Just a moment…" interstitial, check **Security → Settings** for the zone
> and make sure no managed challenge applies. A custom domain avoids the question entirely.

### Optional: a custom domain

A short domain is easier to read out on a call and easier to type into Nimiq Pay's Custom URL field.
In the Cloudflare dashboard: **Workers & Pages → loop-miniapp → Settings → Domains & Routes → Add
custom domain**.

---

## 2. GitHub (required for the competition)

The competition rules require a public repo linked to the submission.

1. Create a new **public** repo at https://github.com/new — suggested name `loop-nimiq-miniapp`.
   Do not add a README, .gitignore or licence; the repo already has all three.
2. Push what is already committed here:

```bash
git remote add origin https://github.com/<you>/loop-nimiq-miniapp.git
git branch -M main
git push -u origin main
```

3. On the repo page, add the live URL to **About → Website**, and some topics:
   `nimiq`, `nimiq-pay`, `mini-app`, `cloudflare-workers`, `vue`.

---

## 3. Test it in Nimiq Pay

**On testnet first**, so no real NIM moves:

1. Open Nimiq Pay. Long-press the settings button for **ten seconds** to reveal the dev menu.
2. Switch the network to **Testnet**.
3. On the home empty state (or in the Top Up modal) tap **Get free NIM** — 110,000 testnet NIM per tap.
4. Go to **Mini Apps → Custom URL** and paste your live URL.
5. Walk the whole flow: sign in, make a tab, add an expense, invite a second phone, settle up.

Then switch back to **Mainnet** and repeat the sign-in at least once, so you know the real path works.

### What to check on the device

- [ ] Sign-in shows one approval dialog, not two.
- [ ] The message in the dialog reads clearly and mentions no funds move.
- [ ] Nothing is cut off; no horizontal scrolling; no pinch-zoom needed.
- [ ] Adding an expense feels fast.
- [ ] The payment dialog shows the right recipient and amount.
- [ ] Cancelling the payment dialog leaves the balance untouched and shows a calm message.
- [ ] A completed payment shows a receipt with a transaction hash.
- [ ] The invite link opens Loop and drops the other person into the tab.

---

## 4. Submit

Submit via GitHub as the competition instructions describe, with:

- **Live URL** — your workers.dev or custom domain
- **Repo** — the public GitHub URL
- **Deeplink** — `https://nimpay.app/miniapps/open/<your-domain>`
- **One-liner** — "Shared tabs that settle themselves. Loop cancels the debts that cancel each
  other, then settles the rest in one tap with NIM."

See `SUBMISSION.md` for the description, the promotion posts, and the plan for getting to 25+ real
users.

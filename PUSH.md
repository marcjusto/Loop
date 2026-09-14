# Pushing this to GitHub

Everything in this folder is what belongs in the repo. Nothing here is generated or secret —
`node_modules/`, `dist/` and `.wrangler/` are deliberately absent and already listed in
`.gitignore`.

The commit history could not be copied across (the file bridge refuses to write into `.git`), so
this is a fresh start. That costs nothing: the four commits were all mine, and one clean commit is
arguably a better first impression anyway.

## From this folder

```bash
cd ~/Documents/Loop

git init
git add -A
git commit -m "Loop — shared tabs that settle themselves"
git branch -M main
git remote add origin https://github.com/marcjusto/loop.git
git push -u origin main
```

If the push is rejected because the repo already has a commit (e.g. GitHub added a README when it
was created):

```bash
git pull --rebase origin main
git push -u origin main
```

## Then, on the repo page

- **About → Website**: `https://loop-miniapp.mjusto.workers.dev`
- **About → Topics**: `nimiq`, `nimiq-pay`, `mini-app`, `cloudflare-workers`, `vue`
- Check the README renders — it embeds all 14 screenshots from `screenshots/`.

## Sanity check before you push

```bash
npm install
npm test          # 40 unit tests should pass
npm run build     # should build clean
```

`npm install` will create `node_modules/`, which `.gitignore` already excludes — it will not end up
in the commit.

## What's in here

| Path | What it is |
| --- | --- |
| `shared/` | The netting engine, Nimiq address derivation, signature verification |
| `worker/` | The Cloudflare Worker API — routes, auth, ledger |
| `src/` | The Vue app |
| `test/` | 40 unit tests, 57 API checks, 35 browser checks |
| `screenshots/` | 14 screenshots, referenced by the README |
| `README.md` | The main writeup |
| `DEPLOY.md` | How to deploy it from scratch |
| `SUBMISSION.md` | Rubric mapping, promotion posts, plan for 25+ users |
| `CHECKLIST.md` | The official Nimiq pre-ship checklist, run line by line |
| `wrangler.toml` | Worker config, pointing at the live D1 database |

A note on `wrangler.toml`: it contains the D1 `database_id`. That is an identifier, not a
credential — it is useless to anyone without an API token for your Cloudflare account. Cloudflare's
own docs commit it. Nothing else in this folder is sensitive.

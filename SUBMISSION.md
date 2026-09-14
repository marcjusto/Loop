# Submission pack

Everything needed for the Cycle II entry, mapped to the scoring rubric.

---

## The pitch

**Loop — shared tabs that settle themselves.**

Split costs with the people you actually live, travel and eat with. Loop keeps the running total,
cancels the debts that cancel each other, and settles whatever is left in one tap with NIM.

### The one-paragraph version

Every expense splitter can tell you that you owe Bea 250 NIM. None of them notice that Bea owes Cal
250 and Cal owes you 250 — because that debt lives in three separate groups and no single group can
see the whole picture. That ring is imaginary money: three payments, three fees, three awkward
reminders, and at the end everyone is exactly where they started. Loop walks the whole connected
component of the money graph, finds the ring, and deletes it. What is genuinely left over settles in
one tap, as a real NIM transfer from your Nimiq Pay wallet.

---

## How it scores

### Functionality, reliability and usefulness — 45 pts

| Criterion | How Loop answers it |
| --- | --- |
| Core feature | Splitting, netting and settling all work end to end. 132 automated checks cover it. |
| Error handling | Every failure has a written sentence. User rejection is treated as a normal outcome, not an error. |
| Speed | 47 KB of gzipped JS, self-hosted fonts, one origin, no third-party requests. |
| Stability | No dead ends. Every screen has a loading, empty and error state. |
| Completeness | Sign-in, tabs, invites, three split modes, settlement, receipts, activity, profile, currency. |
| Real need | Shared costs between friends is a universal, recurring, genuinely annoying problem. |
| Target audience | Obvious in one line: people who live, travel or eat with the same people repeatedly. |
| Originality | Cross-group debt-ring cancellation is not in Splitwise, Venmo, Tricount or Settle Up. |
| Repeat value | A tab is never "done". Every dinner, every month's rent, brings you back. |

### Nimiq Pay and Nimiq integration — 25 pts

| Criterion | How Loop answers it |
| --- | --- |
| Payments are core | Settling *is* the product. Remove the wallet and there is no app. |
| Payment states | Approve, cancel and fail are each handled explicitly and separately. A pending payment never moves a balance. |
| Trustworthy flow | The confirmation sheet shows the amount, the recipient's name AND full address, what it clears, and who approves it — all before the wallet dialog opens. |
| Mobile experience | Built phone-first: 44px targets, safe-area insets, no horizontal scroll at 320px, bottom sheets. |
| NIM and ecosystem beyond a payment | Identity is a Nimiq wallet signature verified server-side. Consensus is checked before offering a payment. Block height is recorded on the receipt. Memos ride in the 64-byte transaction data field. Language follows `window.nimiqPay.language`. |

### Real usage — 15 pts (25+ unique users)

Loop is structurally viral: a tab is worthless alone. See the plan below.

### Design and UX — 10 pts

Official Nimiq palette and typefaces (Mulish, Fira Mono). The welcome screen explains the whole idea
with one animated diagram — a first-time user gets the point in well under 60 seconds.

### Builder promotion — 5 pts

Public post + Skool post. Copy below.

---

## Getting to 25+ unique users

The bar is 25 unique users for the full 15 points. Loop's structure does most of the work: **a tab is
useless with one person in it**, so every user who tries it properly has a reason to pull in two or
three more.

**Day 1 — seed the graph.** Create three real tabs with people you actually share costs with: a
household, a recurring meal or coffee group, and one trip or event. That is typically 6–10 people,
each of whom has a genuine reason to open it rather than a favour to do you.

**Day 2 — make the ring real.** Ask two of those groups to overlap by one person. The moment a ring
forms, the people in it see the cancellation screen — which is the single most shareable thing the
app does. Screenshot it. That screenshot is the promotion post.

**Day 3 — the Nimiq community.** Post in the Skool community and the Nimiq Telegram/Discord with the
ring screenshot and a live invite code to a demo tab anyone can join. A demo tab that strangers can
join and immediately see netting work is worth more than any description.

**Throughout — make joining trivial.** The invite deeplink
(`https://nimpay.app/miniapps/open/<domain>?join=CODE`) opens Loop inside Nimiq Pay and drops the
person straight into the tab. No code to type, no explanation needed.

> **Be honest in the count.** Unique users means unique people. Do not pad it with your own test
> wallets — the leaderboard and the judges can tell, and a padded number is worth less than a real
> one.

---

## Public post (X / Twitter / LinkedIn)

> I built **Loop** for the Nimiq Mini Apps Competition.
>
> It splits shared costs with friends — but it does one thing no other expense app does.
>
> You owe Bea. Bea owes Cal. Cal owes you.
>
> That's three payments, three fees, three awkward reminders — and at the end everyone is exactly
> where they started. The money went in a circle.
>
> Loop spots the circle and deletes it. Nobody pays anybody.
>
> The hard part: that ring usually spans three *different* groups. Your flat, Bea's ski trip you
> weren't on, Cal's lunch club. Nobody standing in any one group can see it. Loop walks the whole
> graph and finds it.
>
> What's genuinely left over settles in one tap, as real NIM from your Nimiq Pay wallet.
>
> Live now inside Nimiq Pay 👇
> [link] · [repo]
>
> #Nimiq #NimiqPay #MiniApps

*(Attach `screenshots/05-loop-ring.png`. It is the whole pitch in one image.)*

## Skool community post

> **Loop — shared tabs that settle themselves**
>
> Cycle II entry. Live link and repo below — I'd really value a look from anyone here, especially at
> the settle flow.
>
> **What it is:** an expense splitter for the people you actually live, travel and eat with, that
> settles in NIM.
>
> **What makes it different:** if you owe Bea, Bea owes Cal and Cal owes you, that debt is imaginary.
> Loop finds the ring and cancels it — and it finds rings that span three separate groups, which
> nobody standing inside any one group can see. Splitwise can't do this. Venmo can't do this.
>
> **On the Nimiq side:** sign-in is a wallet signature verified server-side (the address is derived
> from the public key, never trusted from the client). Settlement is a real NIM transfer with a memo
> in the data field. Consensus is checked before a payment is offered and the block height goes on
> the receipt. Approve, cancel and fail are each handled separately — a pending payment never moves
> a balance.
>
> **Stack:** Vue 3 + a single Cloudflare Worker with D1. One origin, no CORS. 132 automated checks,
> including netting properties over thousands of random debt graphs and the address/signature crypto
> verified against the real @nimiq/core WASM library.
>
> **Try it:** open this in Nimiq Pay → [deeplink]. Want to see the netting actually work? Join the
> demo tab with code **[CODE]** and add something.
>
> Happy to answer anything about the netting algorithm — it was the fun part.

---

## Demo video script (60 seconds)

1. **0–8s** — Welcome screen. "This is Loop. It splits costs with friends." Let the ring diagram
   animate.
2. **8–20s** — Create a tab, add two expenses on one phone. "Normal so far."
3. **20–30s** — Second phone joins with the code, adds one. Show the balance netting down to one
   number. "Three expenses, one payment."
4. **30–45s** — Cut to the settle screen with a ring. "Now the part nothing else does." Let the ring
   land. "You owe Bea, Bea owes Cal, Cal owes you. That's not debt, that's a circle. Gone."
5. **45–60s** — Tap Pay on a real one, show the Nimiq Pay approval dialog, show the receipt with the
   block height. "And what's actually left settles in one tap, in NIM."

Record on a real device with screen recording. The wallet's own approval dialog appearing on camera
is worth more than any slide — it shows the integration is real.

---

## Submission checklist

- [ ] Deployed and reachable over HTTPS
- [ ] `node test/e2e.mjs` passes against the live URL
- [ ] Tested inside Nimiq Pay on testnet — full flow, two devices
- [ ] Tested sign-in on mainnet
- [ ] Public GitHub repo with the live URL in About
- [ ] Screenshots in the README render on GitHub
- [ ] Public post published (3 pts)
- [ ] Skool post published (2 pts)
- [ ] Demo video recorded
- [ ] Submitted before **18 September**
- [ ] Real people using it — aim past 25

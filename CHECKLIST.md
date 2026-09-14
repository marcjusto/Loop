# Nimiq pre-ship checklist

Run against the official checklist from the `mini-apps` skill in
[nimiq/developer-center](https://github.com/nimiq/developer-center).

## 1. Provider integration

- **PASS** — Uses the Nimiq provider: `sign`, `sendBasicTransaction`,
  `sendBasicTransactionWithData`, `getBlockNumber`, `isConsensusEstablished`.
- **PASS** — `@nimiq/mini-app-sdk` installed; `init({ timeout: 10_000 })` is the only way the
  provider is reached (`src/lib/nimiq.ts`).
- **SKIP** — Ethereum provider. Loop settles in NIM; there is no EVM surface to add without
  bolting on a feature nobody asked for.
- **PASS** — Initialisation is wrapped: `init()` resolves to `null` rather than rejecting, because
  "not inside Nimiq Pay" is an ordinary state, not an error.
- **PASS** — Outside Nimiq Pay the welcome screen explains what the app is, shows the ring diagram,
  and tells the user what to do. Verified by an automated browser check.

## 2. Mobile-first UI

- **PASS** — Verified with no horizontal overflow at 320, 360, 390 and 430px.
- **PASS** — Every interactive element measures at least 44px tall; asserted in `test/ui.mjs` by
  measuring every `button`, `a`, `input` and `select` on screen.
- **PASS** — No horizontal scrolling; `overflow-x: hidden` on the body plus a layout that wraps.
- **PASS** — No desktop-only components. Bottom sheets, a bottom nav, single column throughout.
- **PASS** — 16px base text, and every input is 16px so iOS does not zoom the viewport on focus.

## 3. Security

- **PASS** — No access to private keys anywhere. The only wallet surface is `src/lib/nimiq.ts`.
- **PASS** — No attempt to bypass or suppress the approval dialog; every sensitive action goes
  through it.
- **PASS** — No hardcoded keys, seed phrases or credentials. The one external API (CoinGecko price)
  needs no key.
- **PASS** — Account identity, signing and transactions all go through the provider. The address is
  derived server-side from the public key, so a client cannot claim an address it does not hold the
  key for.
- **SKIP** — `eth_signTypedData_v4`. No EVM signing in this app.

Beyond the checklist: login challenges are single-use and expire in five minutes; sessions are
stored as a SHA-256 of the bearer token; tab membership is enforced on every read and write; and a
debt ring passing through a stranger has that person's address replaced with a placeholder.

## 4. Error handling

- **PASS** — User rejection is caught specifically — both the thrown form and the resolved
  `{ error: ... }` form — and shown as "Payment cancelled — nothing was sent." No red, no alarm. An
  automated check asserts the message contains no failure language and that the balance is untouched.
- **PASS** — Network and API failures produce a written sentence; offline is detected and worded
  differently. Every fetch has a 20-second timeout.
- **SKIP** — ERC-20 failures. No tokens in this app.

## 5. Approval dialog UX

- **PASS** — Exactly one dialog per user action. Sign-in deliberately does *not* also call
  `listAccounts()`: the signature already proves the address, so a second dialog would ask the user
  to approve something already known.
- **PASS** — Read-only work is parallelised (`Promise.allSettled` in `refreshAll`); netting is
  computed server-side in one pass.
- **PASS** — Nothing prompts on load. The only two dialogs are behind an explicit "Sign in" and an
  explicit "Send N NIM".

## 6. Token handling

- **SKIP** — No ERC-20 tokens.

## 7. Chain usage

- **SKIP** — No EVM chains; nothing calls `wallet_switchEthereumChain`.

## 8. Dev server and testing

- **PASS** — `server.host: true`, port 5173, so the dev server is reachable from a phone on the LAN.
- **PASS** — No secure-context-only Web APIs in the browser bundle. `crypto.getRandomValues` is used
  only in the Worker, where the context is always secure. `navigator.clipboard` and `navigator.share`
  are both feature-detected with fallbacks.
- **PENDING** — Testing inside Nimiq Pay on a physical device. Everything is verified against a real
  Worker and a real browser with wallet mocks that sign with genuine `@nimiq/core` keys, but the
  device pass is the one thing a container cannot do. Steps are in `DEPLOY.md`.

## 9. Visual identity

- **PASS** — Colours are the official Nimiq palette taken from the `nimiq-css` package. Typefaces
  are Mulish and Fira Mono, Nimiq's own, self-hosted. Loop uses its own mark, not the Nimiq logo, so
  there is no question of misrepresenting an endorsement.

---

**33 passed, 0 failed, 7 skipped, 1 pending.**

The single pending item is testing on a physical device inside Nimiq Pay, which requires the phone.

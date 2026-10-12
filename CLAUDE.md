# Debt-Free Clock: notes for Claude

A personal, national-debt-style clock: a live countdown to the day the last debt payment
lands, ticking balances, interest and net worth, and a payoff planner. Owner: Levi.
Everything runs in the browser, and user numbers are saved only in localStorage.

- Repo (public): https://github.com/the-ljaw/debt-free-clock (clone it to get the latest code)
- Live site: https://the-ljaw.github.io/debt-free-clock/ (GitHub Pages, `main` branch, root)
- Prototype preview: https://claude.ai/artifact/E7zAEtLV6rxco4PuWZ9Dfh

## Where things live
- `src/engine.js`: all money math (amortization, avalanche/snowball plans, asset growth,
  live interpolation, calendar countdown). Pure functions, no DOM, runs in Node too.
- `src/app.js`: page behavior (state, storage, editors, planner, SVG chart, live clock).
- `src/page.html`: markup and CSS (design tokens on `:root`, light and dark).
- `test/engine.test.js`: engine unit tests (Node's built-in test runner).
- `src/license.js`: Lemon Squeezy license checks (activate / validate / deactivate), with
  pure readers for the responses. Tests in `test/license.test.js`.
- `src/config.js`: Pro settings (price, checkout link, store ID, product IDs). The lock is OFF
  until checkoutUrl and storeId are set, so the site never locks people out mid-setup.
- `src/backup.js`: backup files (make / read). `readBackup` rebuilds a clean state from known
  fields only and clamps every number. Tests in `test/backup.test.js`.
- `src/sw.js`: service worker for the installable app (offline copy of the page). `build.py`
  stamps it with a build hash and writes it to the root as `sw.js`.
- `icons/`: app icons (red LED dot on the dark board), used by the manifest and iOS.
- `build.py`: inlines everything into `index.html` (the live site) and
  `dist/debt-free-clock.html` (a fragment for the Claude artifact preview), and writes
  `manifest.webmanifest` and `sw.js`. Never hand-edit those generated files.

## Workflow
1. Change files in `src/` only. Never hand-edit `index.html`; it is generated.
2. Run `node --test test/*.test.js`. All tests must pass. Money-math and license
   changes get new tests.
3. Run `python3 build.py`.
4. Preview: republish `dist/debt-free-clock.html` to the prototype artifact,
   https://claude.ai/artifact/E7zAEtLV6rxco4PuWZ9Dfh (pass it as `url`).
5. Push the change to a branch. Once Levi approves, fast-forward `main` to it and push;
   GitHub Pages then serves `index.html` from the root of `main`. (If this session can't
   push, attach the repo with push access first.) Confirm the deploy through GitHub's public
   deployments API (environment `github-pages`); the shell can't open github.io.
6. Never put Levi's real numbers (from his screenshots) or license keys in code, tests,
   comments or commit messages. The repo is public; use made-up amounts.

## Decisions to respect
- Name: Debt-Free Clock. Keep it free of usdebtclock.org branding.
- Privacy: no server, accounts or bank linking. Numbers stay on the device.
- Each debt has "Count in debt-free countdown" (`inCountdown: false` = excluded, e.g. a
  mortgage). Excluded debts pay their own schedule and never receive extra money.
- Free: clock, tickers, debts, assets (the clock runs on minimum payments). Pro, $9 once via
  Lemon Squeezy license keys: the payoff planner, and its plan drives the countdown. Free
  users see a teaser from their own numbers. On iOS, plan for Apple in-app purchase instead.
- The artifact build sets `window.DFC_PREVIEW = true` (no payments: the button unlocks).
  The live site never does.
- Estimates only, not financial advice. Keep the disclaimer in the footer.
- "Keep your numbers safe" card: saving a backup is Pro; restoring works for anyone. A Pro
  backup includes the license key (never the instance id), so restoring on a new device
  re-activates Pro there (one of the key's 5 slots). Restores can be undone from the toast.
- Install as an app is free for everyone. Chrome/Edge/Android get an Install button
  (`beforeinstallprompt`); iPhone and Mac Safari get instructions. iPhone home-screen apps keep
  their own storage, separate from Safari, so the iPhone text points Pro users to a backup.
  The service worker never touches Lemon Squeezy requests and isn't registered in the preview.
- Once every counted debt is paid off, the board celebrates: green DEBT-FREE sign, the clock
  counts UP from the last payment (`paidOffAt`, recorded by `E.rebase`), and confetti plays
  once per payoff (`state.celebratedFor`) or when the sign is tapped. A blank $0 row never
  counts as paid off; typing a balance clears `paidOffAt`.

## Model notes
- One anchor date `asOf`: payments, contributions and compounding happen on that day of
  each month. New clocks anchor to local midnight.
- Monthly interest is APR ÷ 12. The balance between payment dates is interpolated
  linearly and hits $0 exactly on the final payment date.
- When the page opens a month or more after `asOf`, the state is rebased to the latest
  payment date (`E.rebase`), so the payment day never drifts.

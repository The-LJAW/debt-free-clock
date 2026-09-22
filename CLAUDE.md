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
- `build.py`: inlines everything into `index.html` (the live site) and
  `dist/debt-free-clock.html` (a fragment for the Claude artifact preview).

## Workflow
1. Change files in `src/` only. Never hand-edit `index.html`; it is generated.
2. Run `node --test test/engine.test.js`. All tests must pass, and money-math changes
   get new tests.
3. Run `python3 build.py`.
4. Preview: republish `dist/debt-free-clock.html` to the prototype artifact,
   https://claude.ai/artifact/E7zAEtLV6rxco4PuWZ9Dfh (pass it as `url`).
5. Once Levi approves, send him only the changed files, zipped in their folder structure
   (always include `index.html`). He uploads them on GitHub (Add file > Upload files).
   GitHub Pages then serves `index.html` from the root of `main`.

## Decisions to respect
- Name: Debt-Free Clock. Keep it free of usdebtclock.org branding.
- Privacy: no server, accounts or bank linking. Numbers stay on the device.
- Each debt has "Count in debt-free countdown" (`inCountdown: false` = excluded, e.g. a
  mortgage). Excluded debts pay their own schedule and never receive extra money.
- Free: clock, tickers, debts, assets. Pro (one-time unlock, not built yet): the payoff
  planner. Planned: Lemon Squeezy license keys on the web, Apple in-app purchase on iOS.
- Estimates only, not financial advice. Keep the disclaimer in the footer.

## Model notes
- One anchor date `asOf`: payments, contributions and compounding happen on that day of
  each month. New clocks anchor to local midnight.
- Monthly interest is APR ÷ 12. The balance between payment dates is interpolated
  linearly and hits $0 exactly on the final payment date.
- When the page opens a month or more after `asOf`, the state is rebased to the latest
  payment date (`E.rebase`), so the payment day never drifts.

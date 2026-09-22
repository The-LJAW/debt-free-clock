# Debt-Free Clock

A national-debt-style clock for one household: a live countdown to the day your last
debt payment lands, ticking balances, interest and net worth, and a payoff planner
(avalanche / snowball + extra payment). Everything stays in the browser. No accounts,
no bank linking.

## Layout

| Path | What it is |
|---|---|
| `src/engine.js` | All the money math: amortization, payoff plans, asset growth, live interpolation, calendar countdown. No DOM; runs in the browser and in Node. |
| `src/app.js` | The page's behavior: state, local storage, editors, planner, chart, live clock. |
| `src/page.html` | Markup and styles, with placeholders the build fills in. |
| `test/engine.test.js` | Unit tests for the engine (textbook loan schedules, plans, rebasing, dates). |
| `build.py` | Inlines engine + app into one page. Writes `index.html` (the website) and `dist/debt-free-clock.html` (the Claude artifact version). |
| `index.html` | The built website. GitHub Pages serves this file. Don't edit it by hand: change `src/` and rebuild. |

## Commands

```bash
node --test test/engine.test.js   # run the math tests
python3 build.py                  # rebuild index.html and dist/debt-free-clock.html
```

`index.html` is the full website. `dist/debt-free-clock.html` is the same page without
`<html>/<head>/<body>`, for publishing as a Claude artifact.

## How the model works

- Everything is anchored to one date (`asOf`). Payments, contributions and monthly
  compounding happen on that day of each month.
- Debts accrue APR ÷ 12 each month, then the payment is applied. Between payment
  dates, the on-screen balance slides linearly to the next month's balance, reaching
  exactly $0 on the final payment date.
- Plans: minimums pays each debt its own payment only. Avalanche and snowball keep the
  total monthly outlay fixed (all payments + extra), so each paid-off payment rolls
  into the next target debt.
- Each debt can be left out of the countdown (e.g. a mortgage). Uncounted debts still
  count toward total debt and net worth, pay their own schedule, and never receive
  extra money.
- When the page opens a month or more after `asOf`, the state is rebased to the most
  recent payment date, so the payment day never drifts.

## Decisions so far

- Name: Debt-Free Clock.
- Mortgage: optional per debt ("Count in debt-free countdown").
- Free: the clock, tickers, debts and assets. Pro (one-time unlock): the payoff
  planner, i.e. avalanche/snowball, extra-payment what-ifs and the chart.
- Privacy: numbers stay on the device (local storage), with no server database in v1.

# Budget

A private budget app that runs on your phone. Your numbers are saved only on the phone; this repository holds only the app's code.

## Files

| File | What it does |
|---|---|
| index.html, app.css | The page and its look |
| app.js | Starts the app and picks the screen |
| store.js | Saving, backups, restoring |
| calc.js | Every calculation the screens show |
| ui.js | Shared formatting and navigation helpers |
| calc-debt.js | Debt balances and payoff projections |
| views-savings.js | Savings total, history, add / take out |
| views-*.js | One file per area: home, spending, bills, debt, setup |
| sw.js | Keeps a copy on the phone so it works offline |
| manifest.webmanifest, icon-*.png | Lets Android install it like an app |
| manrope.woff2, space-grotesk.woff2 | Fonts, stored here so the app never calls out to other servers |

## Installing

- **Android:** open the link in Chrome, then ⋮ → Install app.
- **iPhone:** open the link in Safari, then Share → Add to Home Screen. Always open it from the home-screen icon. Safari can clear a website's data after 7 days without a visit, but home-screen apps are exempt, and a Safari tab keeps separate data from the installed app.

Each person's data stays on their own phone. Sharing the link shares the app, never anyone's numbers.

## Updating

Upload the new files over the old ones. `sw.js` always changes with an update (its `VERSION` line), which tells the installed app to refresh. Open the app once with a connection and it switches to the new version.

Export a backup from Setup before any update, just in case.

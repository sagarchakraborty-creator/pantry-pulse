# Pantry Pulse

Grocery stock tracker that installs on your phone. Enter how much of each item is left as a percentage; the app works out how fast you use it and builds a weekend refill list of everything below 10% (or that will be by refill day), with quick links to Blinkit, Zepto and Flipkart Minutes.

**Live app:** https://sagarchakraborty-creator.github.io/pantry-pulse/

## Install
- **Android (Chrome):** open the link, then tap *Install* in the app or ⋮ → *Install app*.
- **iPhone (Safari):** open the link, then Share → *Add to Home Screen*.

Your stock is saved on your phone only. Use Settings → *Save backup* to keep a copy.

## Update
1. Edit the files.
2. Change `VERSION` in `sw.js`.
3. Commit and push. Phones update by themselves the next time the app is opened (it waits if an item is being edited).

Local testing: `powershell -ExecutionPolicy Bypass -File serve.ps1` → http://localhost:8771/

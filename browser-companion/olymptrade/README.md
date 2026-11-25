# SignalForge — Olymp Trade read-only browser companion

A local Chrome extension that shares only visible instrument labels, visible payout percentages, and connection freshness with SignalForge.

## What it does
- Observes the signed-in Olymp Trade page in the same Chrome profile.
- Reads visible currency-pair labels and payout percentages from the rendered page.
- Marks payout evidence as high-confidence only when explicitly labelled or adjacent to the pair; other visible percentages are marked medium-confidence.
- Sends a sanitized snapshot to SignalForge through a local extension message bridge.
- Stores the latest pair snapshot in Chrome extension local storage for the SignalForge page to request.

## What it does not do
- Does not read passwords, cookies, authentication tokens, local storage, or account balances.
- Does not call Olymp Trade private APIs or open WebSocket connections.
- Does not click controls, submit trades, deposit, withdraw, or alter account settings.
- Does not send snapshots to a SignalForge backend.
- Does not change SignalForge's configured 29-pair universe, strategy gates, payout rules, or execution logic.

## Install once in Chrome
1. Download the SignalForge repository from GitHub using Code → Download ZIP, then extract it.
2. Open chrome://extensions in Chrome.
3. Enable Developer mode.
4. Select Load unpacked.
5. Choose the extracted folder browser-companion/olymptrade.
6. Open the official Olymp Trade trading terminal in the same Chrome profile and log in directly on the site.
7. Keep the terminal tab open. Open the SignalForge hosted app and select Broker Feed.

The extension does not handle the login process. Olymp Trade controls its own session and may request login or verification again when its session expires or security checks require it.

## Data quality
The Olymp Trade web terminal's page structure may change. If a pair or payout is not clearly exposed in the visible UI, it is reported as unavailable/not detected rather than guessed. Medium-confidence percentages are displayed separately and must not be treated as verified payout data.

The extension is scoped to olymptrade.com and the SignalForge app host. It requests only Chrome storage and tabs permissions; it does not request cookies, webRequest, or scripting permissions.

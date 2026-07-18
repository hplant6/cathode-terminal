# Watch Approval (approve tool calls from your phone / Apple Watch)

Cathode can mirror a risky tool-permission prompt to a phone/watch companion app, so
you can approve or deny an agent's action from your wrist when you're away from the
keyboard. It runs **alongside** the in-app permission modal — whichever side you answer
first wins; the other is torn down.

This is the desktop half. The companion app + relay server live in the separate
[`watch-approval`](https://github.com/hplant6/watch-approval) repo.

## How it works

```
agent wants a risky tool
   │  client.requestPermission()  (main.js)
   ├─▶ in-app permission card (unchanged)            ┐ first answer wins;
   └─▶ relay POST /api/request ─▶ APNs ─▶ phone/watch ┘ the loser is cancelled
                      wrist tap ─▶ relay ─▶ Cathode polls ─▶ resolves the same prompt
```

- Only **risky** kinds prompt (execute / edit / delete / move / fetch); read-only tools
  auto-approve exactly as before.
- Everything is **best-effort**: if the feature is off, the relay is unreachable, or the
  request times out, Cathode falls back to the in-app modal with no change in behavior.
- If you answer in-app, Cathode calls `POST /api/cancel/{id}` so a late wrist tap cleanly
  no-ops. If you answer on the watch, the in-app card is removed automatically.

## Enable it

The relay from the `watch-approval` repo must be running and reachable (default
`http://localhost:8420` — reachable from Windows even when the relay runs WSL-side, since
WSL2 forwards localhost).

Create a `watch-approval.json` in Cathode's user-data directory:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Cathode Terminal\watch-approval.json` |
| macOS | `~/Library/Application Support/Cathode Terminal/watch-approval.json` |
| Linux | `~/.config/Cathode Terminal/watch-approval.json` |

```json
{
  "enabled": true,
  "url": "http://localhost:8420",
  "secret": "",
  "pollMs": 1500
}
```

The file is re-read on every prompt, so toggling `enabled` takes effect without a restart.
Environment overrides also work: `WATCH_APPROVAL_ENABLED=1`, `WATCH_APPROVAL_URL`,
`WATCH_APPROVAL_SECRET`.

| Field | Default | Notes |
|---|---|---|
| `enabled` | `false` | Master switch. Off = classic in-app-only behavior. |
| `url` | `http://localhost:8420` | Relay base URL. |
| `secret` | `""` | Sent as `Authorization: Bearer <secret>` when set; must match the relay's `WATCH_APPROVAL_SECRET`. |
| `pollMs` | `1500` | How often Cathode polls the relay for the wrist decision. |
| `maxMs` | `300000` | Stop polling after this long (matches the relay's request timeout). |

## Notes & limits

- The watch offers **Approve / Deny** only; "Always allow" is in-app only.
- LAN-only for now: the phone receives the push anywhere (APNs), but its decision POST has
  to reach the relay — so the round-trip needs the phone on the same network as the relay
  until a tunnel/Tailscale layer is added.
- A per-`kind` matcher and an in-app settings toggle are planned; today the switch is this
  config file.

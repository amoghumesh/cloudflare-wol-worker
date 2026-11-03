# ESP32 Wake Worker

Standalone Cloudflare command service for an ESP32 Wake-on-LAN device. This
repository contains the Worker, SQLite-backed Durable Object mailbox, and Node
tests. The ESP32 firmware is maintained separately in `../esp3_wake_on_lan`.

Expected sibling checkouts:

```text
/data/projects/
  esp3_wake_on_lan/    # ESP32 firmware and PlatformIO
  esp32_wake_worker/  # This repository
```

Node.js and Wrangler are development tools. After deployment, the JavaScript
service runs on Cloudflare; no Node process needs to remain running at home.

## Development setup

Run these commands from this repository's root.


Use Node.js 22 (the exact baseline is in `.node-version`) and npm.
Node and npm are separate from the Python/PlatformIO environment.

```bash
npm install
npm test
npm run check
```

Wrangler is pinned in `package.json`. The first `npm install` generates
`package-lock.json`; keep that lockfile and use `npm ci` for subsequent installs.
`npm test` uses Node's test runner and SQLite, without contacting Cloudflare.
`npm run check` bundles a deployment without publishing it.

Generate **two independent random tokens**, for example using `openssl rand
-hex 32` twice. Save them in a password manager. Tokens must use letters, digits,
underscores, or hyphens, contain 32–256 characters, and differ from each other.
The user token can create wake commands and view status. The device token can
only poll and acknowledge; it cannot create commands.

For local service testing, copy `.dev.vars.example` to `.dev.vars` and replace
both placeholders with testing tokens. Start `npm run dev`. Local HTTP is for
desktop API tests only; the ESP32 requires HTTPS and a valid certificate.

## Deploy

Run these commands yourself when ready to publish:

```bash
npx wrangler login
npx wrangler secret put USER_TOKEN
npx wrangler secret put DEVICE_TOKEN
npm run deploy
```

Each secret command prompts for its value. Use the generated user and device
tokens, respectively. Depending on account state, Wrangler may provision the
Worker when uploading the first secret. `npm run deploy` creates the bound
SQLite-backed Durable Object namespace using the checked-in `v1` migration.
Record the HTTPS `workers.dev` origin printed by Wrangler. Do not include a
trailing slash in the firmware configuration. A custom domain is optional.

The two secrets must be set on the same Worker named in `wrangler.toml`.
The API returns HTTP 503 until both valid, distinct tokens are available.
No Cloudflare account API token belongs in the ESP32 firmware.

## Request a wake and inspect status


Run from a terminal with access to the public Worker. In Bash, read the user
token without putting its literal value into shell history:

```bash
export WAKE_ORIGIN='https://esp32-wake.YOUR_SUBDOMAIN.workers.dev'
read -r -s -p 'User token: ' WAKE_USER_TOKEN
printf '\n'

curl --fail-with-body -sS -X POST "$WAKE_ORIGIN/api/wake" \
  -H "Authorization: Bearer $WAKE_USER_TOKEN"

curl --fail-with-body -sS "$WAKE_ORIGIN/api/status" \
  -H "Authorization: Bearer $WAKE_USER_TOKEN"

unset WAKE_USER_TOKEN
```

Repeat the status request after roughly ten seconds. A completed command with
`outcome: "packet_sent"` means a local UDP transmission succeeded. Verify that
the PC actually booted separately. `deviceRecentlySeen` only indicates recent
ESP32 contact; it is not PC power status.

## Integration and validation

The [API contract and delivery behavior](docs/protocol.md) describe the wire
protocol expected by the ESP32. The firmware only needs the deployed HTTPS
origin and device token; there is no source or build dependency between repos.
See the firmware repository's `docs/setup.md` for board configuration and upload.

`npm test` covers command lifecycle, authentication, role separation, SQLite
persistence, and acknowledgement retries. Service tests use real SQLite through
an adapter, rather than the Cloudflare runtime. Run `npm run check` and local
`npm run dev` API checks before deployment. Live Wi-Fi/TLS and PC wake behavior
require an ESP32 and a WoL-capable PC.

No remote Git repository is configured by this local checkout. Add your chosen
remote separately when you are ready to publish the source.

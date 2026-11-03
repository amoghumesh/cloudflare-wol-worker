# Project purpose

This standalone repository contains the Cloudflare command service for an ESP32
Wake-on-LAN device. Its intended checkout is `/data/projects/esp32_wake_worker`,
beside the firmware checkout `/data/projects/esp3_wake_on_lan`.

## Development

- Use Node 22; `.node-version` specifies the baseline. Wrangler is pinned in
  `package.json`.
- Install with `npm install` on the first run. Keep the generated package lock;
  use `npm ci` after it exists.
- Tests: `npm test`. Deployment bundle check: `npm run check`.
- Local service: `npm run dev`, using gitignored `.dev.vars` populated from
  `.dev.vars.example` with independent testing tokens.
- The Worker entry point is `src/index.js`; lifecycle logic is `src/domain.js`;
  authentication is `src/auth.js`.
- Durable Object namespaces use the SQLite storage backend. Preserve the
  migration history in `wrangler.toml`.

## Integration and security

- `docs/protocol.md` defines the API and delivery contract. Coordinate protocol
  changes with the separate firmware repository; neither build depends on the
  other's source checkout.
- Preserve short command expiry, repeated-request coalescing, idempotent
  acknowledgement, and separation of `packet_sent` from `uncertain`.
- User credentials may request wakes and read status; device credentials may
  only poll and acknowledge. Keep role checks before accessing the mailbox.
- Never commit real tokens or log Authorization headers. Store production
  credentials with Wrangler secrets, not checked-in configuration.
- Tests use Node's actual SQLite through a storage adapter. They do not replace
  Wrangler runtime checks or a live hardware test.
- Do not deploy or publish a remote repository unless the user requests it.
- Report validation that ran and disclose unavailable tools or network access.

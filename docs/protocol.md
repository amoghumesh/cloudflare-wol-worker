# API contract and delivery behavior

## Delivery behavior and failure recovery


- Commands expire 120 seconds after creation, even if the ESP32 is offline.
  Repeated wake requests while one is pending return the same ID and expiry.
- The ESP32 sends three UDP packets to its subnet broadcast address on port 9
  during a single attempt. It uses the configured Ethernet MAC in the payload.
- The ESP32 commits the command ID to NVS before sending. Duplicate delivery,
  lost acknowledgements, and device resets do not cause a second attempt for
  that command. It retains one receipt, matching the server's single mailbox.
- A reset between committing the receipt and recording a successful send can
  leave the outcome `uncertain`. This prevents a stale wake after a reset at
  the cost of possibly missing a wake. Check the PC and issue a new command if
  necessary. UDP delivery itself is not guaranteed.
- Acknowledgements are idempotent. Expired commands reject acknowledgements
  with HTTP 410. A delayed acknowledgement can therefore leave an expired
  status even if the packet was sent just before expiry.
- New wake requests have a ten-second cooldown. Pending requests coalesce.
- Failed HTTP requests back off to a maximum of about one minute with jitter.
  Wi-Fi reconnects automatically. A 60-second task watchdog restarts a stalled
  firmware loop. Clock synchronization pauses HTTPS until a
  plausible time is available. NTP, DNS, and outbound HTTPS must be allowed.
- Clearing ESP32 NVS removes duplicate history; do that only after pending
  commands have completed or expired. Firmware updates normally preserve NVS.

## API contract

All timestamps are Unix seconds. All responses disable caching. Requests use
`Authorization: Bearer TOKEN`. Unsupported methods return 405; unauthenticated
or wrong-role tokens return 401. There is no unauthenticated wake endpoint.

| Method and path | Credential | Response |
| --- | --- | --- |
| `POST /api/wake` | User | 202 with new command; 200 with existing pending command; 429 during cooldown |
| `GET /api/status` | User | JSON with latest command, last contact, server time, and device recency |
| `GET /device/poll` | Device | 204 when empty; 200 with the compact text command |
| `POST /device/ack/UUID?result=packet_sent` | Device | 204; `uncertain` is the other supported result |

The poll response is `wake<TAB>UUID<TAB>expiry<LF>`. Firmware validates the UUID,
format, body size, and expiry before transmitting. It accepts at most 180 seconds
of remaining lifetime to allow modest clock skew around the server's 120 seconds.


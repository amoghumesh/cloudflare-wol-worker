import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, { WakeMailbox } from "../src/index.js";
import { authorized, configuredTokens } from "../src/auth.js";

// Real SQLite with the minimal Durable Object storage adapter. Wrangler's dry
// run and local dev still validate deployment/runtime-specific behavior.
function fixture() {
  const db = new DatabaseSync(":memory:");
  const storage = {
    sql: { exec(query, ...bindings) {
      const statement = db.prepare(query);
      if (/^SELECT\b/.test(query)) return { toArray: () => statement.all(...bindings) };
      statement.run(...bindings);
      return { toArray: () => [] };
    } },
    transactionSync(callback) {
      db.exec("BEGIN");
      try {
        const result = callback();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  let mailbox = new WakeMailbox({ storage });
  const env = {
    USER_TOKEN: "a".repeat(64), DEVICE_TOKEN: "b".repeat(64),
    MAILBOX: {
      idFromName: name => { assert.equal(name, "home-pc"); return name; },
      get: () => ({ fetch: request => mailbox.fetch(request) }),
    },
  };
  return {
    env,
    restart: () => { mailbox = new WakeMailbox({ storage }); },
    close: () => db.close(),
    request: (path, method, token) => worker.fetch(new Request(`https://wake.test${path}`, {
      method, headers: token ? { Authorization: `Bearer ${token}` } : {},
    }), env),
  };
}

test("missing, placeholder, equal, or malformed credentials fail closed", async () => {
  assert.equal(configuredTokens({}), false);
  assert.equal(configuredTokens({ USER_TOKEN: "a".repeat(32), DEVICE_TOKEN: "a".repeat(32) }), false);
  assert.equal(configuredTokens({ USER_TOKEN: "replace_" + "a".repeat(32), DEVICE_TOKEN: "b".repeat(32) }), false);
  assert.equal(await authorized(null, "a".repeat(64)), false);
  assert.equal(await authorized("Bearer " + "a".repeat(63) + "b", "a".repeat(64)), false);
  assert.equal(await authorized("Bearer " + "a".repeat(64), "a".repeat(64)), true);
});

test("user and device permissions are isolated; rejected requests create no command", async () => {
  const f = fixture();
  try {
    const { USER_TOKEN: user, DEVICE_TOKEN: device } = f.env;
    assert.equal((await f.request("/api/wake", "POST")).status, 401);
    assert.equal((await f.request("/api/wake", "POST", device)).status, 401);
    assert.equal((await f.request("/device/poll", "GET", user)).status, 401);
    assert.equal((await f.request("/api/status", "GET", device)).status, 401);
    const wrongMethod = await f.request("/api/wake", "GET", user);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("Allow"), "POST");
    assert.equal((await f.request("/unknown", "GET", user)).status, 404);
    const status = await f.request("/api/status", "GET", user);
    assert.equal(status.headers.get("Cache-Control"), "no-store");
    assert.equal((await status.json()).command, null);
    f.env.DEVICE_TOKEN = f.env.USER_TOKEN;
    assert.equal((await f.request("/api/wake", "POST", user)).status, 503);
  } finally { f.close(); }
});

test("concurrent requests coalesce; restart preserves command and repeated ack is harmless", async () => {
  const f = fixture();
  try {
    const { USER_TOKEN: user, DEVICE_TOKEN: device } = f.env;
    const requests = await Promise.all([
      f.request("/api/wake", "POST", user), f.request("/api/wake", "POST", user),
    ]);
    assert.deepEqual(requests.map(r => r.status).sort(), [200, 202]);
    const [first, second] = await Promise.all(requests.map(r => r.json()));
    assert.equal(first.command.id, second.command.id);
    f.restart();
    const poll = await f.request("/device/poll", "GET", device);
    assert.equal(poll.status, 200);
    assert.equal(await poll.text(), `wake\t${first.command.id}\t${first.command.expiresAt}\n`);
    const path = `/device/ack/${first.command.id}?result=packet_sent`;
    assert.equal((await f.request(path, "POST", user)).status, 401);
    assert.equal((await f.request(path, "POST", device)).status, 204);
    f.restart();
    assert.equal((await f.request(path, "POST", device)).status, 204);
    assert.equal((await f.request("/device/poll", "GET", device)).status, 204);
    const status = await (await f.request("/api/status", "GET", user)).json();
    assert.equal(status.command.status, "completed");
    assert.equal(status.command.outcome, "packet_sent");
    assert.equal(status.deviceRecentlySeen, true);
    assert.equal((await f.request("/api/wake", "POST", user)).status, 429);
  } finally { f.close(); }
});

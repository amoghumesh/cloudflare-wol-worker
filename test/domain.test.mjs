import test from "node:test";
import assert from "node:assert/strict";
import { initialState, transition } from "../src/domain.js";

const id = "12345678-1234-4234-8234-123456789abc";
const otherId = "abcdef12-1234-4234-8234-123456789abc";

test("commands persist until ack; repeated wake requests and polls preserve ID and expiry", () => {
  const state = initialState();
  assert.equal(transition(state, "wake", 1000, { id }).status, 202);
  const expiry = state.command.expiresAt;
  assert.equal(transition(state, "wake", 1001, { id: otherId }).body.coalesced, true);
  assert.equal(state.command.expiresAt, expiry);
  const poll = transition(state, "poll", 1002);
  assert.equal(poll.body, `wake\t${id}\t1120\n`);
  assert.equal(transition(state, "poll", 1003).body, poll.body);
  assert.equal(state.lastSeen, 1003);
});

test("expiry boundary stops delivery, rejects stale ack, and permits a new request", () => {
  const state = initialState();
  transition(state, "wake", 1000, { id });
  assert.equal(transition(state, "poll", 1120).status, 204);
  assert.equal(state.command.status, "expired");
  assert.equal(transition(state, "ack", 1121, { id, result: "packet_sent" }).status, 410);
  assert.equal(transition(state, "wake", 1122, { id: otherId }).status, 202);
});

test("ack is idempotent, mismatched IDs cannot complete commands, cooldown is enforced", () => {
  const state = initialState();
  transition(state, "wake", 1000, { id });
  assert.equal(transition(state, "ack", 1001, { id: otherId, result: "packet_sent" }).status, 409);
  assert.equal(state.command.status, "pending");
  assert.equal(transition(state, "ack", 1002, { id, result: "uncertain" }).status, 204);
  assert.equal(transition(state, "ack", 1003, { id, result: "packet_sent" }).status, 204);
  assert.equal(state.command.outcome, "uncertain");
  assert.equal(state.command.completedAt, 1002);
  assert.equal(transition(state, "poll", 1004).status, 204);
  assert.equal(transition(state, "wake", 1005, { id: otherId }).status, 429);
  assert.equal(transition(state, "wake", 1010, { id: otherId }).status, 202);
});

test("status never claims the PC is awake; device recency expires", () => {
  const state = initialState();
  assert.equal(transition(state, "status", 1000).body.deviceRecentlySeen, false);
  transition(state, "poll", 1000);
  assert.equal(transition(state, "status", 1034).body.deviceRecentlySeen, true);
  assert.equal(transition(state, "status", 1035).body.deviceRecentlySeen, false);
  assert.equal(state.command, null);
});

test("invalid outcomes and malformed IDs cannot acknowledge or create a command", () => {
  const state = initialState();
  transition(state, "wake", 1000, { id });
  assert.equal(transition(state, "ack", 1001, { id, result: "awake" }).status, 400);
  assert.equal(transition(state, "ack", 1001, { id: "bad", result: "packet_sent" }).status, 400);
  assert.equal(state.command.status, "pending");
  assert.throws(() => transition(initialState(), "wake", 1000, { id: "bad" }));
});

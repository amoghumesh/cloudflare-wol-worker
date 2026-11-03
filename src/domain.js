export const COMMAND_TTL_SECONDS = 120;
export const COOLDOWN_SECONDS = 10;
export const COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function initialState() {
  return { command: null, lastSeen: null, lastRequestedAt: null };
}

// Pure state transition logic. The caller persists the result atomically.
export function transition(state, action, now, options = {}) {
  const command = state.command;
  if (command?.status === "pending" && command.expiresAt <= now) {
    command.status = "expired";
  }
  if (action === "wake") {
    // Repeated clicks retrieve the same command and never extend its lifetime.
    if (command?.status === "pending") {
      return { status: 200, body: { command, coalesced: true } };
    }
    if (state.lastRequestedAt !== null && now - state.lastRequestedAt < COOLDOWN_SECONDS) {
      return { status: 429, body: { error: "wake_cooldown" } };
    }
    if (!COMMAND_ID.test(options.id ?? "")) throw new Error("Invalid command ID");
    state.lastRequestedAt = now;
    state.command = {
      id: options.id, issuedAt: now, expiresAt: now + COMMAND_TTL_SECONDS,
      status: "pending", outcome: null, completedAt: null,
    };
    return { status: 202, body: { command: state.command, coalesced: false } };
  }
  if (action === "poll") {
    state.lastSeen = now;
    if (command?.status !== "pending") return { status: 204, body: null };
    return { status: 200, body: `wake\t${command.id}\t${command.expiresAt}\n` };
  }
  if (action === "ack") {
    if (!COMMAND_ID.test(options.id ?? "") ||
        !["packet_sent", "uncertain"].includes(options.result)) {
      return { status: 400, body: { error: "invalid_acknowledgement" } };
    }
    state.lastSeen = now;
    if (!command || command.id !== options.id) {
      return { status: 409, body: { error: "command_mismatch" } };
    }
    if (command.status === "expired") {
      return { status: 410, body: { error: "command_expired" } };
    }
    if (command.status === "pending") {
      command.status = "completed";
      command.outcome = options.result;
      command.completedAt = now;
    }
    // Retrying an acknowledgement cannot rewrite its original outcome.
    return { status: 204, body: null };
  }
  if (action === "status") {
    return { status: 200, body: {
      command, lastSeen: state.lastSeen,
      deviceRecentlySeen: state.lastSeen !== null && now - state.lastSeen < 35,
      serverTime: now,
    } };
  }
  throw new Error("Unknown mailbox action");
}

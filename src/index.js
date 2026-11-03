import { authorized, configuredTokens } from "./auth.js";
import { COMMAND_ID, initialState, transition } from "./domain.js";

function response(status, body) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (status === 204) return new Response(null, { status, headers });
  const text = typeof body === "string";
  headers["Content-Type"] = text ? "text/plain; charset=utf-8" : "application/json";
  if (status === 429) headers["Retry-After"] = "10";
  return new Response(text ? body : JSON.stringify(body), { status, headers });
}

function route(path) {
  if (path === "/api/wake") return { method: "POST", role: "user", action: "wake" };
  if (path === "/api/status") return { method: "GET", role: "user", action: "status" };
  if (path === "/device/poll") return { method: "GET", role: "device", action: "poll" };
  if (path.startsWith("/device/ack/") && COMMAND_ID.test(path.slice(12))) {
    return { method: "POST", role: "device", action: "ack" };
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const endpoint = route(url.pathname);
    if (!endpoint) return response(404, { error: "not_found" });
    if (!configuredTokens(env)) return response(503, { error: "service_not_configured" });
    const token = endpoint.role === "user" ? env.USER_TOKEN : env.DEVICE_TOKEN;
    if (!(await authorized(request.headers.get("Authorization"), token))) {
      return response(401, { error: "unauthorized" });
    }
    if (request.method !== endpoint.method) {
      const result = response(405, { error: "method_not_allowed" });
      result.headers.set("Allow", endpoint.method);
      return result;
    }
    // Fixed object name: no client-controlled object creation or device selection.
    const stub = env.MAILBOX.get(env.MAILBOX.idFromName("home-pc"));
    return stub.fetch(new Request(`https://mailbox${url.pathname}${url.search}`, {
      method: endpoint.method,
    }));
  },
};

// A standard Durable Object class; no runtime-specific base class is required.
export class WakeMailbox {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS mailbox (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)");
  }

  fetch(request) {
    const url = new URL(request.url);
    const endpoint = route(url.pathname);
    if (!endpoint) return response(404, { error: "not_found" });
    if (request.method !== endpoint.method) return response(405, { error: "method_not_allowed" });
    const now = Math.floor(Date.now() / 1000);
    const result = this.storage.transactionSync(() => {
      const rows = this.sql.exec("SELECT value FROM mailbox WHERE id = 1").toArray();
      const state = rows.length ? JSON.parse(rows[0].value) : initialState();
      const before = JSON.stringify(state);
      const result = transition(state, endpoint.action, now, {
        id: endpoint.action === "wake" ? crypto.randomUUID() : url.pathname.slice(12),
        result: url.searchParams.get("result"),
      });
      const after = JSON.stringify(state);
      if (after !== before) {
        this.sql.exec("INSERT INTO mailbox (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value", after);
      }
      return result;
    });
    return response(result.status, result.body);
  }
}

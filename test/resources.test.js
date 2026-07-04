const test = require("node:test");
const assert = require("node:assert");
const RedditAdsAPI = require("../api.js");

const recorder = () => {
  const calls = [];
  const api = RedditAdsAPI({
    accessToken: "t",
    fetchImpl: async (url, opts) => {
      calls.push({
        method: opts.method,
        url,
        body: opts.body ? JSON.parse(opts.body) : undefined
      });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" };
    }
  });
  return { api, calls };
};

test("accounts.get hits /ad_accounts/{id}", async () => {
  const { api, calls } = recorder();
  await api.accounts.get("a1");
  assert.strictEqual(calls[0].method, "GET");
  assert.match(calls[0].url, /\/ad_accounts\/a1$/);
});

test("campaigns.list is account-scoped", async () => {
  const { api, calls } = recorder();
  await api.campaigns.list("a1");
  assert.strictEqual(calls[0].method, "GET");
  assert.match(calls[0].url, /\/ad_accounts\/a1\/campaigns$/);
});

test("campaigns.create posts wrapped body to account-scoped path", async () => {
  const { api, calls } = recorder();
  await api.campaigns.create("a1", { name: "Launch" });
  assert.strictEqual(calls[0].method, "POST");
  assert.match(calls[0].url, /\/ad_accounts\/a1\/campaigns$/);
  assert.deepStrictEqual(calls[0].body, { data: { name: "Launch" } });
});

test("campaigns.update PATCHes top-level /campaigns/{id} with wrapped body", async () => {
  const { api, calls } = recorder();
  await api.campaigns.update("c1", { configured_status: "PAUSED" });
  assert.strictEqual(calls[0].method, "PATCH");
  assert.match(calls[0].url, /\/campaigns\/c1$/);
  assert.deepStrictEqual(calls[0].body, { data: { configured_status: "PAUSED" } });
});

test("events.send posts wrapped body to /pixels/{id}/conversion_events", async () => {
  const { api, calls } = recorder();
  await api.events.send("p1", { events: [] });
  assert.strictEqual(calls[0].method, "POST");
  assert.match(calls[0].url, /\/pixels\/p1\/conversion_events$/);
  assert.deepStrictEqual(calls[0].body, { data: { events: [] } });
});

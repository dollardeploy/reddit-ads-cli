const test = require("node:test");
const assert = require("node:assert");
const RedditAdsAPI = require("../api.js");

const makeResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: k => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body))
});

test("request returns parsed JSON on success and sets bearer auth", async () => {
  let seen;
  const api = RedditAdsAPI({
    accessToken: "tok",
    fetchImpl: async (url, opts) => {
      seen = { url, opts };
      return makeResponse(200, { ok: true });
    }
  });
  const result = await api.request("GET", "/accounts");
  assert.deepStrictEqual(result, { ok: true });
  assert.match(seen.url, /\/accounts$/);
  assert.strictEqual(seen.opts.headers.authorization, "Bearer tok");
});

test("request retries on 429 then succeeds", async () => {
  let calls = 0;
  const api = RedditAdsAPI({
    accessToken: "tok",
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? makeResponse(429, "rate", { "x-ratelimit-reset": "0" })
        : makeResponse(200, { done: true });
    }
  });
  assert.deepStrictEqual(await api.request("GET", "/x"), { done: true });
  assert.strictEqual(calls, 2);
});

test("request throws with status and message on error", async () => {
  const api = RedditAdsAPI({
    accessToken: "tok",
    fetchImpl: async () => makeResponse(403, { error: "forbidden" })
  });
  await assert.rejects(
    api.request("GET", "/x"),
    err => err.status === 403 && /forbidden/.test(err.message)
  );
});

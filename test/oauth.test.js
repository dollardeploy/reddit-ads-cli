const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const auth = require("../auth.js");

test("buildAuthorizeUrl includes permanent duration and scopes", () => {
  const url = new URL(
    auth.buildAuthorizeUrl({
      clientId: "cid",
      redirectUri: "http://localhost:8080",
      scope: auth.DEFAULT_SCOPE,
      state: "xyz"
    })
  );
  assert.strictEqual(url.origin + url.pathname, auth.AUTHORIZE_URL);
  assert.strictEqual(url.searchParams.get("client_id"), "cid");
  assert.strictEqual(url.searchParams.get("response_type"), "code");
  assert.strictEqual(url.searchParams.get("duration"), "permanent");
  assert.strictEqual(url.searchParams.get("scope"), auth.DEFAULT_SCOPE);
  assert.strictEqual(url.searchParams.get("state"), "xyz");
});

test("getValidAccessToken returns stored token when not near expiry", async () => {
  const now = 1_000_000;
  const session = { access_token: "live", refresh_token: "r", expires_at: now + 600_000 };
  const result = await auth.getValidAccessToken({
    session,
    clientId: "c",
    clientSecret: "s",
    now,
    fetchImpl: () => {
      throw new Error("must not refresh");
    }
  });
  assert.strictEqual(result.accessToken, "live");
});

test("getValidAccessToken refreshes and persists when near expiry", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ra-")), "session.json");
  const now = 1_000_000;
  const session = {
    access_token: "old",
    refresh_token: "r",
    expires_at: now + 1000,
    _file: file
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ access_token: "fresh", expires_in: 3600, scope: auth.DEFAULT_SCOPE })
  });
  const result = await auth.getValidAccessToken({
    session,
    clientId: "c",
    clientSecret: "s",
    now,
    fetchImpl
  });
  assert.strictEqual(result.accessToken, "fresh");
  assert.strictEqual(result.session.expires_at, now + 3600 * 1000);
  assert.strictEqual(result.session.refresh_token, "r");
});

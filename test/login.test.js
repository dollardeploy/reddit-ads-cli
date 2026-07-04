const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const auth = require("../auth.js");

test("parseCodeFromInput extracts code from redirect URL", () => {
  assert.strictEqual(
    auth.parseCodeFromInput("http://localhost:8080/?state=s1&code=abc123", "s1"),
    "abc123"
  );
});

test("parseCodeFromInput accepts a bare code", () => {
  assert.strictEqual(auth.parseCodeFromInput("abc123"), "abc123");
});

test("parseCodeFromInput rejects state mismatch", () => {
  assert.throws(() => auth.parseCodeFromInput("http://x/?state=bad&code=c", "good"), /state/i);
});

test("hashPII hashes lowercased trimmed value", () => {
  const crypto = require("node:crypto");
  const expected = crypto.createHash("sha256").update("user@example.com").digest("hex");
  assert.strictEqual(auth.hashPII("  User@Example.com "), expected);
});

test("captureCodeViaLoopback resolves with code from redirect", async () => {
  const port = 8099;
  const state = "st";
  const codePromise = auth.captureCodeViaLoopback({
    port,
    redirectUri: `http://localhost:${port}`,
    state,
    onUrl: () => {
      const req = http.get(`http://localhost:${port}/?state=${state}&code=xyz`);
      req.end();
    }
  });
  assert.strictEqual(await codePromise, "xyz");
});

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readSession, writeSession } = require("../auth.js");

test("readSession returns null when file is missing", () => {
  const p = path.join(os.tmpdir(), `ra-missing-${Date.now()}.json`);
  assert.strictEqual(readSession(p), null);
});

test("writeSession persists data and sets 0600 perms", () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ra-")), "session.json");
  writeSession({ access_token: "t", refresh_token: "r" }, p);
  assert.deepStrictEqual(readSession(p), { access_token: "t", refresh_token: "r" });
  assert.strictEqual(fs.statSync(p).mode & 0o777, 0o600);
});

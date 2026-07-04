const test = require("node:test");
const assert = require("node:assert");
const cli = require("../cli.js");

test("resolveAccount prefers --account flag over session default", () => {
  assert.strictEqual(
    cli.resolveAccount({ account: "flag" }, { default_account_id: "sess" }),
    "flag"
  );
  assert.strictEqual(cli.resolveAccount({}, { default_account_id: "sess" }), "sess");
});

test("resolveAccount throws when no account available", () => {
  assert.throws(() => cli.resolveAccount({}, {}), /account/i);
});

test("dispatch routes campaigns pause to update with PAUSED configured_status", async () => {
  const calls = [];
  const fakeApi = {
    campaigns: {
      update: (id, body) => {
        calls.push({ id, body });
        return Promise.resolve({ id });
      }
    }
  };
  await cli.dispatch({
    group: "campaigns",
    command: "pause",
    positionals: ["c1"],
    flags: {},
    sets: [],
    api: fakeApi,
    getAccount: () => "a1"
  });
  assert.deepStrictEqual(calls[0], { id: "c1", body: { configured_status: "PAUSED" } });
});

test("dispatch businesses list calls the businesses endpoint", async () => {
  let called = false;
  const fakeApi = {
    businesses: () => {
      called = true;
      return Promise.resolve({ data: [] });
    }
  };
  await cli.dispatch({
    group: "businesses",
    command: "list",
    positionals: [],
    flags: {},
    sets: [],
    api: fakeApi,
    getAccount: () => "a1"
  });
  assert.strictEqual(called, true);
});

test("dispatch profiles list aggregates across businesses", async () => {
  const fakeApi = {
    businesses: () => Promise.resolve({ data: [{ id: "b1" }, { id: "b2" }] }),
    businessProfiles: businessId => Promise.resolve({ data: [{ id: `${businessId}-p` }] })
  };
  const result = await cli.dispatch({
    group: "profiles",
    command: "list",
    positionals: [],
    flags: {},
    sets: [],
    api: fakeApi,
    getAccount: () => "a1"
  });
  assert.deepStrictEqual(result.data, [
    { id: "b1-p", business_id: "b1" },
    { id: "b2-p", business_id: "b2" }
  ]);
});

test("dispatch campaigns list resolves account lazily for the scoped call", async () => {
  let used;
  const fakeApi = {
    campaigns: {
      list: (accountId, query) => {
        used = { accountId, query };
        return Promise.resolve({ data: [] });
      }
    }
  };
  await cli.dispatch({
    group: "campaigns",
    command: "list",
    positionals: [],
    flags: {},
    sets: [],
    api: fakeApi,
    getAccount: () => "a9"
  });
  assert.strictEqual(used.accountId, "a9");
});

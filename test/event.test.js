const test = require("node:test");
const assert = require("node:assert");
const { buildConversionEvent } = require("../cli.js");
const { hashPII } = require("../auth.js");

test("buildConversionEvent hashes email, uppercases type, sets value/action_source", () => {
  const ev = buildConversionEvent({
    type: "purchase",
    value: 49.5,
    currency: "USD",
    email: "A@B.com"
  });
  assert.strictEqual(ev.type.tracking_type, "PURCHASE");
  assert.strictEqual(ev.action_source, "WEBSITE");
  assert.strictEqual(ev.user.email, hashPII("A@B.com"));
  assert.strictEqual(ev.metadata.value, 49.5);
  assert.strictEqual(ev.metadata.currency, "USD");
  assert.ok(ev.event_at);
});

test("buildConversionEvent keeps click_id at top level and raw", () => {
  const ev = buildConversionEvent({ type: "LEAD", clickId: "rdt_cid_123" });
  assert.strictEqual(ev.click_id, "rdt_cid_123");
  assert.strictEqual(ev.user.click_id, undefined);
});

test("buildConversionEvent attaches custom_event_name for CUSTOM type", () => {
  const ev = buildConversionEvent({
    type: "custom",
    customName: "DeployStarted",
    externalId: "u1"
  });
  assert.strictEqual(ev.type.tracking_type, "CUSTOM");
  assert.strictEqual(ev.type.custom_event_name, "DeployStarted");
});

test("buildConversionEvent requires an attribution signal", () => {
  assert.throws(() => buildConversionEvent({ type: "Purchase" }), /attribution signal/);
});

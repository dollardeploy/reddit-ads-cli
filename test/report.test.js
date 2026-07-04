const test = require("node:test");
const assert = require("node:assert");
const { resolveDate, buildReportBody } = require("../cli.js");

const NOW = new Date("2026-06-28T12:00:00.000Z");

test("resolveDate('now') returns second-precision ISO (no milliseconds)", () => {
  assert.strictEqual(resolveDate("now", NOW), "2026-06-28T12:00:00Z");
});

test("resolveDate handles relative offsets", () => {
  assert.strictEqual(resolveDate("-7d", NOW), "2026-06-21T12:00:00Z");
  assert.strictEqual(resolveDate("+3h", NOW), "2026-06-28T15:00:00Z");
});

test("resolveDate passes through ISO/parseable dates without milliseconds", () => {
  assert.strictEqual(resolveDate("2026-05-01", NOW), "2026-05-01T00:00:00Z");
});

test("resolveDate throws on garbage", () => {
  assert.throws(() => resolveDate("notadate", NOW), /Invalid date/);
});

test("buildReportBody defaults to last 7 days with fields and breakdowns", () => {
  const body = buildReportBody({}, []);
  assert.ok(body.fields.includes("SPEND"));
  assert.ok(body.fields.includes("CAMPAIGN_ID"));
  assert.deepStrictEqual(body.breakdowns, ["CAMPAIGN_ID"]);
  assert.ok(Date.parse(body.starts_at) < Date.parse(body.ends_at));
  const spanDays = (Date.parse(body.ends_at) - Date.parse(body.starts_at)) / 86400e3;
  assert.ok(Math.abs(spanDays - 7) < 0.01);
});

test("buildReportBody floors dates to hourly granularity", () => {
  const body = buildReportBody(
    { from: "2026-05-01T13:47:31Z", to: "2026-05-02T09:15:00Z" },
    []
  );
  assert.strictEqual(body.starts_at, "2026-05-01T13:00:00Z");
  assert.strictEqual(body.ends_at, "2026-05-02T09:00:00Z");
});

test("buildReportBody maps --level and uppercases --fields", () => {
  const body = buildReportBody({ level: "ad_group", fields: "spend,clicks" }, []);
  assert.deepStrictEqual(body.breakdowns, ["AD_GROUP_ID"]);
  assert.deepStrictEqual(body.fields, ["SPEND", "CLICKS"]);
});

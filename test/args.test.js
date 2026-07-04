const test = require("node:test");
const assert = require("node:assert");
const { parseArgs, setDotPath, buildBodyFromSets } = require("../cli.js");

test("parseArgs splits positionals, value flags, and boolean flags", () => {
  const { _, flags } = parseArgs(["campaigns", "list", "--account", "a1", "--json"]);
  assert.deepStrictEqual(_, ["campaigns", "list"]);
  assert.strictEqual(flags.account, "a1");
  assert.strictEqual(flags.json, true);
});

test("parseArgs collects repeatable --set values", () => {
  const { sets } = parseArgs(["campaigns", "edit", "x", "--set", "a=1", "--set", "b.c=2"]);
  assert.deepStrictEqual(sets, ["a=1", "b.c=2"]);
});

test("setDotPath creates nested objects", () => {
  const obj = {};
  setDotPath(obj, "goal.value", "5000");
  assert.deepStrictEqual(obj, { goal: { value: "5000" } });
});

test("buildBodyFromSets splits on first = only", () => {
  assert.deepStrictEqual(buildBodyFromSets(["name=Hi=There", "x.y=1"]), {
    name: "Hi=There",
    x: { y: "1" }
  });
});

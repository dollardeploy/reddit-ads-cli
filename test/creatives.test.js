const test = require("node:test");
const assert = require("node:assert");
const { formatCreatives } = require("../cli.js");

const capture = fn => {
  const original = process.stdout.write;
  let out = "";
  process.stdout.write = chunk => {
    out += chunk;
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return out;
};

test("formatCreatives unwraps result and prints media url column", () => {
  const data = {
    data: [
      {
        result: {
          id: "asset_1",
          type: "IMAGE",
          status: "ACTIVE",
          media: { permanent_url: "https://i.redd.it/a.jpg" }
        }
      }
    ]
  };
  const out = capture(() => formatCreatives(data));
  const lines = out.split("\n");
  assert.strictEqual(lines[0], "ID\tTYPE\tSTATUS\tMEDIA_URL\tCOVER_URL");
  assert.deepStrictEqual(lines[1].split("\t"), [
    "asset_1",
    "IMAGE",
    "ACTIVE",
    "https://i.redd.it/a.jpg",
    ""
  ]);
});

test("formatCreatives prints (no results) for an empty list", () => {
  const out = capture(() => formatCreatives({ data: [] }));
  assert.strictEqual(out, "(no results)\n");
});

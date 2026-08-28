import assert from "node:assert/strict";
import test from "node:test";

import { parseAddArgs, codexLoginArgs } from "../dist/add-options.js";

test("parses device-auth login flag", () => {
  const parsed = parseAddArgs(["--device-auth"]);

  assert.equal(parsed.deviceAuth, true);
});

test("defaults to browser OAuth login", () => {
  const parsed = parseAddArgs([]);

  assert.equal(parsed.deviceAuth, false);
});

test("forwards --device-auth to codex login", () => {
  assert.deepEqual(codexLoginArgs({ deviceAuth: false }), ["login"]);
  assert.deepEqual(codexLoginArgs({ deviceAuth: true }), ["login", "--device-auth"]);
});

test("rejects unknown add flags", () => {
  assert.throws(
    () => parseAddArgs(["--bad-flag"]),
    /Unknown add option/,
  );
});

test("rejects extra positional arguments", () => {
  assert.throws(
    () => parseAddArgs(["alice@example.com"]),
    /Unexpected extra argument/,
  );
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const providers = fs.readFileSync(path.join(__dirname, "..", "js", "providers.js"), "utf8");

test("Speechmatics solicita el formato json-v2 admitido por la API", () => {
  assert.match(providers, /transcript\?format=json-v2/);
  assert.doesNotMatch(providers, /transcript\?format=json(?:["'`])/);
});

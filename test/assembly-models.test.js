"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const providers = fs.readFileSync(path.join(__dirname, "..", "js", "providers.js"), "utf8");
const panel = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("AssemblyAI usa los modelos Universal vigentes con fallback", () => {
  assert.match(providers, /return \["universal-3-5-pro", "universal-2"\]/);
  assert.doesNotMatch(providers, /model \|\| "universal"/);
});

test("el selector no ofrece el identificador Universal deprecado", () => {
  assert.match(panel, /assemblyai:universal-3-5-pro/);
  assert.match(panel, /assemblyai:universal-2/);
  assert.doesNotMatch(panel, /assemblyai:universal"/);
});

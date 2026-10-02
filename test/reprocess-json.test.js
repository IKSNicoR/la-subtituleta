"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const tool = require("../tools/reprocess-json.js");

test("reprocesa un JSON existente sin API y explica los cortes", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ls-reprocess-"));
  const input = path.join(folder, "caso.json");
  fs.writeFileSync(input, JSON.stringify({
    inputLanguage: "es",
    outputLanguage: "same",
    run: { wordsPerLine: 3, lines: 1, cleanBackchannels: true },
    sourceBoundaries: { hard: [], soft: [] },
    words: [
      { text: "¿Venís?", start: 0, end: 0.4, speaker: "A" },
      { text: "Sí.", start: 0.5, end: 0.7, speaker: "B" },
      { text: "Eh", start: 0.8, end: 0.9, speaker: "B", disfluency: true },
      { text: "Mañana", start: 0.9, end: 1.3, speaker: "B" }
    ]
  }), "utf8");

  const result = tool.reprocess(input, {});
  const srt = fs.readFileSync(result.outputPath, "utf8");
  const audit = JSON.parse(fs.readFileSync(result.auditPath, "utf8"));
  assert.match(srt, /¿Venís\?/);
  assert.match(srt, /Sí\./);
  assert.doesNotMatch(srt, /\bEh\b/);
  assert.equal(audit.totals.words, 4);
  assert.ok(audit.captions.some((caption) => caption.before.includes("speaker")));
  assert.equal(audit.options.cleanBackchannels, true);
});

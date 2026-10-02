"use strict";

const fs = require("node:fs");
const path = require("node:path");
const transcript = require("../js/transcript.js");

function parseBoolean(value, fallback) {
  if (value == null) { return fallback; }
  if (/^(?:1|true|si|sí|yes)$/i.test(String(value))) { return true; }
  if (/^(?:0|false|no)$/i.test(String(value))) { return false; }
  throw new Error("Valor booleano inválido: " + value);
}

function parseArgs(argv) {
  if (!argv.length || argv.includes("--help")) { return { help: true }; }
  const options = { input: path.resolve(argv[0]) };
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === "--words") { options.words = Number(value); index += 1; }
    else if (name === "--lines") { options.lines = Number(value); index += 1; }
    else if (name === "--clean") { options.clean = parseBoolean(value, true); index += 1; }
    else if (name === "--remove-punctuation") { options.removePunctuation = parseBoolean(value, true); index += 1; }
    else if (name === "--output") { options.output = path.resolve(value); index += 1; }
    else { throw new Error("Opción desconocida: " + name); }
  }
  return options;
}

function numeric(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function reprocess(inputPath, overrides) {
  const data = JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(data.words) || !data.words.length) { throw new Error("El JSON no contiene palabras reutilizables en words[]."); }
  const run = data.run || {};
  const snapshot = data.sourceSequenceSnapshot || {};
  const boundaries = data.sourceBoundaries || {};
  const options = {
    wordsPerLine: numeric(overrides.words, numeric(run.wordsPerLine, 6)),
    lines: numeric(overrides.lines, numeric(run.lines, 2)),
    cleanBackchannels: overrides.clean == null ? run.cleanBackchannels !== false : overrides.clean,
    removePunctuation: overrides.removePunctuation == null ? Boolean(run.removePunctuation) : overrides.removePunctuation,
    language: data.outputLanguage && data.outputLanguage !== "same" ? data.outputLanguage : data.inputLanguage,
    hardBoundaries: Array.isArray(boundaries.hard) ? boundaries.hard : [],
    softBoundaries: Array.isArray(boundaries.soft) ? boundaries.soft : [],
    maxCharsPerLine: transcript.suggestedMaxCharsPerLine(snapshot.frameWidth, snapshot.frameHeight)
  };
  const captions = transcript.captionize(data.words, options);
  if (!captions.length) { throw new Error("La lógica actual no produjo captions para este JSON."); }
  const parsed = path.parse(inputPath);
  const outputPath = overrides.output || path.join(parsed.dir, parsed.name + "-reprocesado-" + options.wordsPerLine + "x" + options.lines + ".srt");
  const auditPath = outputPath.replace(/\.srt$/i, "-auditoria.json");
  const audit = {
    generatedAt: new Date().toISOString(), engineVersion: "0.6.1-macos-beta", sourceJson: inputPath,
    sourceRun: run, options, totals: { words: data.words.length, captions: captions.length },
    captions: captions.map((caption, index) => ({
      index: index + 1, start: caption.start, end: caption.end, text: caption.text,
      speaker: caption.speaker, speakerLabel: caption.speakerLabel,
      before: caption.segmentation && caption.segmentation.before || [],
      after: caption.segmentation && caption.segmentation.after || [],
      crossedJumpCutBoundaries: caption.segmentation && caption.segmentation.crossedJumpCutBoundaries || []
    }))
  };
  fs.writeFileSync(outputPath, "\uFEFF" + transcript.toSrt(captions), "utf8");
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), "utf8");
  return { outputPath, auditPath, captions: captions.length, options };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log("node tools/reprocess-json.js archivo.json --words 6 --lines 2 --clean true"); process.exit(0); }
    const result = reprocess(args.input, args);
    console.log("SRT creado: " + result.outputPath);
    console.log("Auditoría creada: " + result.auditPath);
  } catch (error) {
    console.error("ERROR: " + error.message);
    process.exit(1);
  }
}

module.exports = { parseArgs, reprocess };

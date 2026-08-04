"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const hostSource = fs.readFileSync(path.join(__dirname, "..", "jsx", "host.jsx"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "js", "main.js"), "utf8");
const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "js", "bridge.js"), "utf8");
const manifestSource = fs.readFileSync(path.join(__dirname, "..", "CSXS", "manifest.xml"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("el audio se exporta dentro de Premiere sin lanzar Media Encoder", () => {
  assert.match(hostSource, /exportAsMediaDirect\(/);
  assert.doesNotMatch(hostSource, /app\.encoder/);
  assert.doesNotMatch(hostSource, /launchEncoder\(/);
});

test("los resultados vuelven como una pista nativa de captions", () => {
  assert.match(hostSource, /createCaptionTrack\(/);
});

test("el panel no ejecuta ExtendScript antes de que el usuario transcriba", () => {
  const initBody = mainSource.match(/function init\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(initBody, "No se encontró init()");
  assert.doesNotMatch(initBody[1], /bridge\./);
});

test("el proyecto usa una identidad independiente", () => {
  assert.match(manifestSource, /com\.iksnicor\.subtitulador/);
  assert.match(manifestSource, /<Menu>Subtitulador<\/Menu>/);
});

test("el preset de audio renombrado existe", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "presets", "Subtitulador Audio MP3 128kbps.epr")));
  assert.match(mainSource, /Subtitulador Audio MP3 128kbps\.epr/);
});

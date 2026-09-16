"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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

test("Premiere expone el montaje para ubicar automáticamente el Reflow", () => {
  assert.match(hostSource, /getTimelineContext/);
  assert.match(hostSource, /clip\.inPoint/);
  assert.match(hostSource, /clip\.outPoint/);
  assert.match(hostSource, /projectItem\.getMediaPath/);
  assert.match(hostSource, /activeSequenceId/);
  assert.match(hostSource, /frameSizeHorizontal/);
  assert.match(hostSource, /frameSizeVertical/);
  assert.match(hostSource, /sequence\.zeroPoint/);
  assert.match(hostSource, /zeroPointSeconds/);
  assert.match(bridgeSource, /getTimelineContext/);
});

test("el panel no ejecuta ExtendScript antes de que el usuario transcriba", () => {
  const initBody = mainSource.match(/function init\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(initBody, "No se encontró init()");
  assert.doesNotMatch(initBody[1], /bridge\./);
});

test("el puente carga host.jsx explícitamente antes de llamar a Premiere", () => {
  assert.match(bridgeSource, /\$\.evalFile\(/);
  assert.match(bridgeSource, /Loading and invoking host\.jsx in the same evalScript call/);
});

test("ExtendScript serializa respuestas sin depender del objeto JSON", () => {
  assert.match(hostSource, /_LaSubtituleta\._stringify/);
  assert.doesNotMatch(hostSource, /JSON\.stringify/);
});

test("el puente carga host.jsx y ejecuta la operación en una sola evaluación", async () => {
  const calls = [];
  const panelWindow = {
    __adobe_cep__: {
      getSystemPath() { return "file:///C:/Plugin"; },
      evalScript(script, callback) {
        calls.push(script);
        callback(JSON.stringify({ ok: true, sequenceName: "Prueba" }));
      }
    }
  };
  panelWindow.window = panelWindow;
  panelWindow.LaSubtituletaPlatform = require("../js/platform.js");
  vm.runInNewContext(bridgeSource, {
    window: panelWindow,
    Promise,
    JSON,
    Error,
    decodeURIComponent
  });

  const result = await panelWindow.LaSubtituletaBridge.getContext();
  assert.equal(result.sequenceName, "Prueba");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\$\.evalFile\("C:\/Plugin\/jsx\/host\.jsx"\)/);
  assert.match(calls[0], /\$\._LaSubtituleta\.getContext\(\)/);
});

test("los errores indican si falló la exportación o la importación", () => {
  assert.match(mainSource, /Premiere no pudo exportar el audio/);
  assert.match(mainSource, /El SRT se creó, pero Premiere no pudo insertarlo/);
});

test("el proyecto usa una identidad independiente", () => {
  assert.match(manifestSource, /com\.iksnicor\.lasubtituleta/);
  assert.match(manifestSource, /<Menu>La Subtituleta<\/Menu>/);
});

test("el preset de audio renombrado existe", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "presets", "La Subtituleta Audio MP3 128kbps.epr")));
  assert.match(mainSource, /La Subtituleta Audio MP3 128kbps\.epr/);
});

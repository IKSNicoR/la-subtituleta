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

test("el panel no ejecuta ExtendScript antes de que el usuario transcriba", () => {
  const initBody = mainSource.match(/function init\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(initBody, "No se encontró init()");
  assert.doesNotMatch(initBody[1], /bridge\./);
});

test("el puente carga host.jsx explícitamente antes de llamar a Premiere", () => {
  assert.match(bridgeSource, /\$\.evalFile\(/);
  assert.match(bridgeSource, /SUBTITULADOR_HOST_READY/);
  assert.match(bridgeSource, /loadHostScript\(\)\.then/);
});

test("el puente espera la carga de host.jsx y después ejecuta la operación", async () => {
  const calls = [];
  const panelWindow = {
    __adobe_cep__: {
      getSystemPath() { return "file:///C:/Plugin"; },
      evalScript(script, callback) {
        calls.push(script);
        callback(script.includes("$.evalFile(")
          ? "SUBTITULADOR_HOST_READY"
          : JSON.stringify({ ok: true, sequenceName: "Prueba" }));
      }
    }
  };
  panelWindow.window = panelWindow;
  vm.runInNewContext(bridgeSource, {
    window: panelWindow,
    Promise,
    JSON,
    Error,
    decodeURIComponent
  });

  const result = await panelWindow.SubtituladorBridge.getContext();
  assert.equal(result.sequenceName, "Prueba");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /\$\.evalFile\("C:\/Plugin\/jsx\/host\.jsx"\)/);
  assert.match(calls[1], /\$\._Subtitulador\.getContext\(\)/);
});

test("los errores indican si falló la exportación o la importación", () => {
  assert.match(mainSource, /Premiere no pudo exportar el audio/);
  assert.match(mainSource, /El SRT se creó, pero Premiere no pudo insertarlo/);
});

test("el proyecto usa una identidad independiente", () => {
  assert.match(manifestSource, /com\.iksnicor\.subtitulador/);
  assert.match(manifestSource, /<Menu>Subtitulador<\/Menu>/);
});

test("el preset de audio renombrado existe", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "presets", "Subtitulador Audio MP3 128kbps.epr")));
  assert.match(mainSource, /Subtitulador Audio MP3 128kbps\.epr/);
});

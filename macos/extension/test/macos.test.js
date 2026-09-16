"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const platform = require("../js/platform.js");
const transcript = require("../js/transcript.js");
const root = path.join(__dirname, "..");

test("CEP conserva rutas absolutas Mac, espacios, tildes y porcentajes", () => {
  for (const [input, expected] of [
    ["file:///Users/Jos%C3%A9/Library/Application%20Support/LS", "/Users/José/Library/Application Support/LS"],
    ["file://localhost/Users/nico/LS", "/Users/nico/LS"],
    ["/Volumes/Trabajo 100%/LS", "/Volumes/Trabajo 100%/LS"],
    ["file:///Users/Nico/100%25", "/Users/Nico/100%"],
    ["file:///C:/Plugin", "C:/Plugin"],
    ["/C:/Plugin", "C:/Plugin"],
    ["C:\\Plugin", "C:\\Plugin"]
  ]) { assert.equal(platform.pathFromCep(input), expected); }
});

test("claves y biblioteca usan Application Support en Mac, AppData en Windows", () => {
  const source = fs.readFileSync(path.join(root, "js/platform.js"), "utf8");
  for (const [osName, homeDir, appdata, expected] of [
    ["darwin", "/Users/José", "C:/ignorar", "/Users/José/Library/Application Support/La Subtituleta"],
    ["win32", "C:/Users/Nico", "C:/CustomRoaming", "C:/CustomRoaming/La Subtituleta"],
    ["win32", "C:/Users/Nico", "", "C:/Users/Nico/AppData/Roaming/La Subtituleta"]
  ]) {
    const context = { window: {}, process: { platform: osName, env: { APPDATA: appdata } },
      require: (name) => name === "os" ? { homedir: () => homeDir } : path.posix };
    vm.runInNewContext(source, context);
    assert.equal(context.window.LaSubtituletaPlatform.appDataRoot(), expected);
  }
});

test("no confunde archivos por mayúsculas en Mac; normaliza tildes equivalentes", () => {
  assert.notEqual(platform.fileKey("/Volumes/Media/A.mov"), platform.fileKey("/Volumes/Media/a.mov"));
  assert.equal(platform.fileKey("/Users/José/a.mov"), platform.fileKey("/Users/Jose\u0301/a.mov"));
  assert.equal(platform.fileKey("C:\\Media\\A.mov"), platform.fileKey("c:/media/a.mov"));
});

test("el panel completo carga en el orden del HTML y evalúa host.jsx con ruta Mac", async () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const calls = [];
  const win = { __adobe_cep__: {
    getSystemPath: () => "file:///Users/Jos%C3%A9/Library/Application%20Support/Adobe/CEP/extensions/LS",
    evalScript: (script, callback) => { calls.push(script); callback('{"ok":true}'); }
  } };
  const context = vm.createContext({ window: win, document: { addEventListener() {} }, require, process, console });
  for (const match of html.matchAll(/<script src="([^"]+)"/g)) {
    vm.runInContext(fs.readFileSync(path.join(root, match[1]), "utf8"), context, { filename: match[1] });
  }
  await win.LaSubtituletaBridge.getContext();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('$.evalFile("/Users/José/Library/Application Support/Adobe/CEP/extensions/LS/jsx/host.jsx")'));
  assert.equal(typeof win.LaSubtituletaLibrary.saveTranscript, "function");
  assert.equal(typeof win.LaSubtituletaProviders.transcribe, "function");
});

test("settings y biblioteca comparten la misma carpeta en macOS", () => {
  const files = new Map();
  const fakeFs = {
    existsSync: p => files.has(p), mkdirSync() {},
    writeFileSync: (p, value) => files.set(p, value), readFileSync: p => files.get(p)
  };
  const win = {};
  const context = vm.createContext({ window: win, document: { addEventListener() {} },
    process: { platform: "darwin", env: {} },
    require: name => name === "fs" ? fakeFs : name === "os" ? { homedir: () => "/Users/Test" } : path.posix });
  for (const name of ["platform", "library"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "js", name + ".js"), "utf8"), context);
  }
  const main = fs.readFileSync(path.join(root, "js/main.js"), "utf8")
    .replace(/\}\)\(\);\s*$/, 'window.testSettings = {read: readSettingsFile, write: writeSettingsFile, cache: transcriptCachePath}; })();');
  vm.runInContext(main, context);
  win.testSettings.write({ assemblyai: "fake-test-key" });
  assert.equal(win.testSettings.read().assemblyai, "fake-test-key");
  assert.equal(win.LaSubtituletaLibrary.appDataRoot(), "/Users/Test/Library/Application Support/La Subtituleta");
  assert.equal(win.testSettings.cache(), "/Users/Test/Library/Application Support/La Subtituleta/ultima-transcripcion.json");
  assert.ok(files.has("/Users/Test/Library/Application Support/La Subtituleta/config.json"));
});

test("Reflow Mac ubica el tramo del medio con start time distinto y rutas externas", () => {
  const mediaPath = "/Volumes/Disco edición/Entrevista José.mov";
  const context = { activeSequenceId: "vertical", sequences: [
    { id: "original", duration: 100, zeroPointSeconds: 3600,
      clips: [{ trackType: "video", start: 0, end: 100, inPoint: 0, outPoint: 100, mediaPath }] },
    { id: "vertical", duration: 10, zeroPointSeconds: 7200,
      clips: [{ trackType: "video", start: 0, end: 10, inPoint: 60, outPoint: 70, mediaPath }] }
  ] };
  const mapped = transcript.mapWordsToSequence([
    { text: "incorrecto", start: 2, end: 2.3 }, { text: "correcto", start: 65, end: 65.3 }
  ], context, "original");
  assert.deepEqual(mapped.words.map(w => w.text), ["correcto"]);
  assert.equal(mapped.words[0].start, 5);
  const changed = structuredClone(context);
  changed.sequences[1].clips[0].mediaPath = "/Volumes/Disco edición/entrevista José.mov";
  assert.equal(transcript.mapWordsToSequence([{ text: "correcto", start: 65, end: 65.3 }], changed, "original").words.length, 0);
});

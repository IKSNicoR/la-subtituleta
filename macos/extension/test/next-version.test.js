"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(root, "index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "js", "main.js"), "utf8");
const library = fs.readFileSync(path.join(root, "js", "library.js"), "utf8");
const providers = fs.readFileSync(path.join(root, "js", "providers.js"), "utf8");
const http = fs.readFileSync(path.join(root, "js", "http.js"), "utf8");
const manifest = fs.readFileSync(path.join(root, "CSXS", "manifest.xml"), "utf8");

test("la próxima versión usa la leyenda solicitada sin encabezado interno", () => {
  assert.doesNotMatch(panel, /<h1>/);
  assert.doesNotMatch(panel, /class="panel-header"/);
  assert.match(panel, /Esta extensión fue hecha por Nico Russo, con mucho amor\./);
  assert.match(manifest, /ExtensionBundleVersion="0\.4\.0"/);
});

test("los tres proveedores activan diarización", () => {
  assert.match(providers, /payload\.speaker_labels = true/);
  assert.match(providers, /speaker_identification/);
  assert.match(providers, /speakers: speakerNames\.map/);
  assert.match(providers, /params\.set\("diarize_model", "latest"\)/);
  assert.match(providers, /diarization: options\.identifySpeakers \? "speaker" : "none"/);
});

test("las API keys se guardan fuera de la carpeta de la extensión", () => {
  assert.match(main, /path\.join\(window\.LaSubtituletaPlatform\.appDataRoot\(\), "config\.json"\)/);
  assert.match(main, /writeSettingsFile\(keys\)/);
  assert.match(main, /function transcriptCachePath/);
  assert.match(main, /"ultima-transcripcion\.json"/);
  assert.match(main, /persistTranscript\(lastTranscript\)/);
});

test("los errores HTTP conservan el estado para detectar falta de créditos", () => {
  assert.match(http, /apiError\.statusCode = res\.statusCode/);
  assert.match(main, /no tenés créditos disponibles/);
  assert.match(panel, /id="switch-provider"/);
});

test("speakers se cargan por filas y enriquecen la transcripción", () => {
  assert.match(panel, /id="speaker-rows"/);
  assert.match(panel, /id="add-speaker"/);
  assert.match(main, /function applySpeakerEditor/);
  assert.match(main, /speakerNames/);
  assert.doesNotMatch(panel, /GENERAR CSV/);
  assert.doesNotMatch(panel, /id="export-csv"/);
});

test("Transcribir pide una carpeta antes de exportar audio o llamar a la API", () => {
  const body = main.match(/async function runTranscription\(\) \{([\s\S]*?)\n  async function runReflow/)[1];
  const picker = body.indexOf("chooseFolder(");
  const audioExport = body.indexOf("bridge.exportAudio(");
  const apiCall = body.indexOf("providers.transcribe(");
  assert.ok(picker >= 0);
  assert.ok(picker < audioExport);
  assert.ok(picker < apiCall);
});

test("la extensión no expone exportación CSV", () => {
  const importBody = main.match(/async function importTranscript[\s\S]*?\n  function collectOptions/)[0];
  assert.doesNotMatch(importBody, /writeCsvFile/);
  assert.doesNotMatch(main, /function exportCsv/);
  assert.doesNotMatch(main, /writeCsvFile/);
  assert.doesNotMatch(main, /writeWordsCsvFile/);
  assert.doesNotMatch(main, /Elegí dónde guardar el CSV/);
  assert.doesNotMatch(main, /\.csv/);
});

test("cada corrida usa el nombre de la secuencia y guarda un JSON trazable con captions", () => {
  assert.match(main, /uniqueOutputBase\(selectedFolder, safeFileName\(sourceContext\.name/);
  assert.match(main, /data\.outputBaseName \+ "\.json"/);
  assert.match(main, /sourceSequenceFps/);
  assert.match(main, /validateTranscriptCompleteness/);
  assert.match(main, /data\.captions = serializeCaptions\(captions/);
  assert.match(main, /speakerId/);
  assert.match(main, /sourceKey/);
});

test("Transcribir no frena con confirmación antes de enviar", () => {
  assert.doesNotMatch(main, /function confirmTranscription/);
  assert.doesNotMatch(main, /window\.confirm/);
  assert.match(main, /Preparando el audio dentro de Premiere/);
});

test("Deepgram informa claramente que no traduce sin cambiar la UI", () => {
  assert.match(main, /Igual que entrada — este modelo no traduce\. Cambiá el modelo para hacerlo/);
  assert.match(main, /output\.disabled = true/);
  assert.match(main, /output\.disabled = false/);
});

test("el selector usa el diálogo nativo de carpetas de CEP", () => {
  assert.match(main, /window\.cep\.fs\.showOpenDialogEx\(false, true/);
  assert.match(main, /lastTranscript\.outputFolder \|\| preferredOutputFolder\(\)/);
});

test("Reflow detecta automáticamente el montaje activo sin pedir un SRT", () => {
  const body = main.match(/async function runReflow\(\) \{([\s\S]*?)\n  async function importTranscript/)[1];
  assert.match(body, /bridge\.getTimelineContext/);
  assert.match(body, /rankActiveSequenceTranscripts\(timelineContext\)/);
  assert.match(body, /suggestedMaxCharsPerLine/);
  assert.match(body, /timelineEditBoundaries/);
  assert.doesNotMatch(body, /chooseSrtFile/);
  assert.doesNotMatch(body, /importTranscript\(lastTranscript/);
  assert.match(panel, /id="reflow" class="secondary-button" type="button" disabled>/);
  assert.match(main, /transcriptLibrary\.rankTranscripts/);
  assert.match(main, /transcriptLibrary\.loadProjectTranscripts/);
  assert.match(main, /transcriptLibrary\.discoverFolderTranscripts/);
});

test("la biblioteca persiste muchas transcripciones por proyecto y no depende de la última", () => {
  assert.match(panel, /<script src="js\/library\.js"><\/script>/);
  assert.match(library, /path\.join\(appDataRoot\(\), "projects"/);
  assert.match(library, /function saveTranscript/);
  assert.match(library, /function loadProjectTranscripts/);
  assert.match(main, /transcriptLibrary\.saveTranscript\(data\)/);
  assert.match(main, /function rankActiveSequenceTranscripts/);
  assert.match(main, /sameProject\(lastTranscript\.projectPath, timelineContext\.projectPath\)/);
});

test("el botón de configuración está al final de la fila de feedback", () => {
  const styles = fs.readFileSync(path.join(root, "css", "styles.css"), "utf8");
  assert.match(panel, /<div class="status-line">[\s\S]*id="status"[\s\S]*id="open-settings"[\s\S]*<\/div>/);
  assert.match(styles, /\.status-settings\s*\{[\s\S]*margin-left: auto;/);
});

test("el JSON guarda metadata editorial para LLMs", () => {
  assert.match(main, /function enrichTranscriptJson/);
  assert.match(main, /pauseBeforeClass/);
  assert.match(main, /speakerChangeBefore/);
  assert.match(main, /shortReaction/);
  assert.match(main, /hangingConnector/);
  assert.match(main, /readingRisk/);
  assert.match(main, /nearestEditBoundary/);
  assert.match(main, /editorialSummary/);
});

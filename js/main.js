(function () {
  "use strict";

  var hasNodeRuntime = typeof require === "function";
  var fs = hasNodeRuntime ? require("fs") : null;
  var os = hasNodeRuntime ? require("os") : null;
  var path = hasNodeRuntime ? require("path") : null;
  var bridge = window.SubtituladorBridge;
  var providers = window.SubtituladorProviders;
  var transcriptTools = window.SubtituladorTranscript;
  var lastTranscript = null;
  var busy = false;

  var LANGUAGES = [
    ["auto", "Detectar automáticamente"], ["es", "Español"], ["en", "Inglés"],
    ["pt", "Portugués"], ["fr", "Francés"], ["de", "Alemán"], ["it", "Italiano"],
    ["nl", "Neerlandés"], ["ja", "Japonés"], ["zh", "Chino"], ["ko", "Coreano"],
    ["hi", "Hindi"], ["ru", "Ruso"], ["uk", "Ucraniano"], ["pl", "Polaco"],
    ["tr", "Turco"], ["ar", "Árabe"], ["sv", "Sueco"], ["da", "Danés"],
    ["fi", "Finés"], ["id", "Indonesio"], ["vi", "Vietnamita"]
  ];

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    fillLanguages();
    loadSettings();
    bindUI();
    restoreTranscript();
    updateLanguageRules();
  }

  function bindUI() {
    byId("open-settings").addEventListener("click", showSettings);
    byId("close-settings").addEventListener("click", hideSettings);
    byId("save-settings").addEventListener("click", saveSettings);
    byId("model").addEventListener("change", updateLanguageRules);
    byId("input-language").addEventListener("change", updateLanguageRules);
    byId("transcribe").addEventListener("click", runTranscription);
    byId("reflow").addEventListener("click", runReflow);
  }

  function fillLanguages() {
    var input = byId("input-language");
    var output = byId("output-language");
    LANGUAGES.forEach(function (language) {
      input.appendChild(option(language[0], language[1]));
      if (language[0] !== "auto") {
        output.appendChild(option(language[0], language[1]));
      }
    });
    output.insertBefore(option("same", "Igual que entrada"), output.firstChild);
    input.value = "auto";
    output.value = "same";
  }

  function updateLanguageRules() {
    var model = byId("model").value;
    var input = byId("input-language");
    var output = byId("output-language");
    if (model === "assemblyai:slam-1") {
      input.value = "en";
    }
    input.disabled = model === "assemblyai:slam-1";
    if (model.indexOf("deepgram:") === 0) {
      output.value = "same";
      output.disabled = true;
      output.title = "Deepgram no ofrece traducción.";
    } else {
      output.disabled = false;
      output.title = "";
    }
  }

  async function runTranscription() {
    if (busy) { return; }
    if (!hasNodeRuntime) {
      setStatus("Este panel debe ejecutarse dentro de Premiere Pro.", 0, true);
      return;
    }
    var options = collectOptions();
    var provider = options.model.split(":")[0];
    if (!options.keys[provider]) {
      showSettings();
      setStatus("Agregá la API key del modelo elegido.", 0, true);
      return;
    }

    var audioPath = path.join(os.tmpdir(), "subtitulador-premiere-" + Date.now() + ".mp3");
    var presetPath = path.join(bridge.getExtensionPath(), "presets", "Subtitulador Audio MP3 128kbps.epr");
    setBusy(true);
    try {
      setStatus("Preparando el audio dentro de Premiere…", 12);
      try {
        await bridge.exportAudio(audioPath, presetPath);
      } catch (error) {
        throw new Error("Premiere no pudo exportar el audio. " + error.message);
      }
      options.audioPath = audioPath;
      setStatus("Enviando audio al servicio…", 35);
      lastTranscript = await providers.transcribe(options, function (progress, message) {
        setStatus(message, progress);
      });
      persistTranscript(lastTranscript);
      setStatus("Creando la pista de subtítulos…", 82);
      await importTranscript(lastTranscript, options);
      setStatus("Subtítulos importados.", 100);
    } catch (error) {
      setStatus(error.message, 0, true);
    } finally {
      removeTemporary(audioPath);
      setBusy(false);
    }
  }

  async function runReflow() {
    if (busy || !lastTranscript) { return; }
    setBusy(true);
    try {
      setStatus("Reformateando sin volver a transcribir…", 72);
      await importTranscript(lastTranscript, collectOptions());
      setStatus("Nueva pista importada.", 100);
    } catch (error) {
      setStatus(error.message, 0, true);
    } finally {
      setBusy(false);
    }
  }

  async function importTranscript(data, options) {
    var captions = transcriptTools.captionize(data.words, {
      wordsPerLine: options.wordsPerLine,
      lines: options.lines
    });
    if (!captions.length) {
      throw new Error("No hay texto para crear subtítulos.");
    }
    var folder = path.join(os.homedir(), "Documents", "Subtitulador");
    fs.mkdirSync(folder, { recursive: true });
    var srtPath = path.join(folder, "subtitulos-" + safeTimestamp() + ".srt");
    fs.writeFileSync(srtPath, "\ufeff" + transcriptTools.toSrt(captions), "utf8");
    try {
      await bridge.importCaptions(srtPath);
    } catch (error) {
      throw new Error("El SRT se creó, pero Premiere no pudo insertarlo en la línea de tiempo. " + error.message);
    }
  }

  function collectOptions() {
    return {
      model: byId("model").value,
      inputLanguage: byId("input-language").value,
      outputLanguage: byId("output-language").value,
      wordsPerLine: parseInt(byId("words-per-line").value, 10),
      lines: parseInt(byId("lines-per-caption").value, 10),
      keys: {
        assemblyai: localStorage.getItem("assemblyaiKey") || "",
        speechmatics: localStorage.getItem("speechmaticsKey") || "",
        deepgram: localStorage.getItem("deepgramKey") || ""
      }
    };
  }

  function persistTranscript(data) {
    try {
      var folder = path.join(os.homedir(), "Documents", "Subtitulador");
      fs.mkdirSync(folder, { recursive: true });
      var cachePath = path.join(folder, "ultima-transcripcion.json");
      fs.writeFileSync(cachePath, JSON.stringify(data), "utf8");
      localStorage.setItem("lastTranscriptPath", cachePath);
    } catch (_error) {}
    byId("reflow").disabled = false;
  }

  function restoreTranscript() {
    if (!hasNodeRuntime) { return; }
    try {
      var cachePath = localStorage.getItem("lastTranscriptPath");
      if (cachePath && fs.existsSync(cachePath)) {
        lastTranscript = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        byId("reflow").disabled = !lastTranscript.words || !lastTranscript.words.length;
      }
    } catch (_error) {
      lastTranscript = null;
    }
  }

  function showSettings() {
    byId("main-panel").classList.add("is-hidden");
    byId("settings-panel").classList.remove("is-hidden");
  }

  function hideSettings() {
    byId("settings-panel").classList.add("is-hidden");
    byId("main-panel").classList.remove("is-hidden");
  }

  function loadSettings() {
    byId("assemblyai-key").value = localStorage.getItem("assemblyaiKey") || "";
    byId("speechmatics-key").value = localStorage.getItem("speechmaticsKey") || "";
    byId("deepgram-key").value = localStorage.getItem("deepgramKey") || "";
  }

  function saveSettings() {
    localStorage.setItem("assemblyaiKey", byId("assemblyai-key").value.trim());
    localStorage.setItem("speechmaticsKey", byId("speechmatics-key").value.trim());
    localStorage.setItem("deepgramKey", byId("deepgram-key").value.trim());
    hideSettings();
    setStatus("Configuración guardada.", 0);
  }

  function setBusy(value) {
    busy = value;
    byId("transcribe").disabled = value;
    byId("reflow").disabled = value || !lastTranscript;
  }

  function setStatus(message, progress, isError) {
    byId("status").textContent = message;
    byId("progress").value = progress || 0;
    byId("status-indicator").classList.toggle("is-error", Boolean(isError));
  }

  function removeTemporary(filePath) {
    try {
      if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); }
    } catch (_error) {}
  }

  function safeTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  function byId(id) { return document.getElementById(id); }
  function option(value, label) {
    var element = document.createElement("option");
    element.value = value;
    element.textContent = label;
    return element;
  }
})();

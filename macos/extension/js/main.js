(function () {
  "use strict";

  var hasNodeRuntime = typeof require === "function";
  var fs = hasNodeRuntime ? require("fs") : null;
  var os = hasNodeRuntime ? require("os") : null;
  var path = hasNodeRuntime ? require("path") : null;
  var bridge = window.LaSubtituletaBridge;
  var providers = window.LaSubtituletaProviders;
  var transcriptTools = window.LaSubtituletaTranscript;
  var transcriptLibrary = window.LaSubtituletaLibrary;
  var lastTranscript = null;
  var busy = false;
  var EXTENSION_VERSION = "0.4.0-macos-beta.1";
  var PROVIDER_LABELS = {
    assemblyai: "AssemblyAI",
    speechmatics: "Speechmatics",
    deepgram: "Deepgram"
  };

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
    updateSpeakerControls();
  }

  function bindUI() {
    byId("open-settings").addEventListener("click", showSettings);
    byId("close-settings").addEventListener("click", hideSettings);
    byId("save-settings").addEventListener("click", saveSettings);
    byId("model").addEventListener("change", updateLanguageRules);
    byId("input-language").addEventListener("change", updateLanguageRules);
    byId("identify-speakers").addEventListener("change", updateSpeakerControls);
    byId("clean-backchannels").addEventListener("change", savePreferences);
    byId("add-speaker").addEventListener("click", function () { addSpeakerRow(); });
    byId("transcribe").addEventListener("click", runTranscription);
    byId("reflow").addEventListener("click", runReflow);
    byId("switch-provider").addEventListener("click", switchProvider);
    byId("dismiss-credit").addEventListener("click", dismissCreditOffer);
  }

  function updateSpeakerControls() {
    var enabled = byId("identify-speakers").checked;
    byId("speaker-editor").classList.toggle("is-hidden", !enabled);
    if (enabled && !byId("speaker-rows").children.length) {
      addSpeakerRow();
    }
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
      output.options[0].textContent = "Igual que entrada — este modelo no traduce. Cambiá el modelo para hacerlo";
      output.title = "Deepgram no ofrece traducción.";
    } else {
      output.disabled = false;
      output.options[0].textContent = "Igual que entrada";
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

    var selectedFolder;
    try {
      selectedFolder = chooseFolder("Elegí dónde guardar esta transcripción", preferredOutputFolder());
    } catch (error) {
      setStatus(error.message, 0, true);
      return;
    }
    if (!selectedFolder) {
      setStatus("Transcripción cancelada: no se eligió una carpeta.", 0);
      return;
    }
    localStorage.setItem("lastOutputFolder", selectedFolder);
    options.outputFolder = selectedFolder;

    var audioPath = path.join(os.tmpdir(), "la-subtituleta-premiere-" + Date.now() + ".mp3");
    var presetPath = path.join(bridge.getExtensionPath(), "presets", "La Subtituleta Audio MP3 128kbps.epr");
    setBusy(true);
    try {
      var sourceTimelineContext = await bridge.getTimelineContext();
      var sourceContext = (sourceTimelineContext.sequences || []).filter(function (sequence) {
        return String(sequence.id) === String(sourceTimelineContext.activeSequenceId);
      })[0] || {};
      options.outputBaseName = uniqueOutputBase(selectedFolder, safeFileName(sourceContext.name || "secuencia"));
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
      if (lastTranscript.identifySpeakers) {
        renderSpeakerRows(lastTranscript.speakers || []);
      }
      lastTranscript.outputFolder = options.outputFolder;
      lastTranscript.outputBaseName = options.outputBaseName;
      lastTranscript.sourceSequenceId = sourceContext.id || "";
      lastTranscript.sourceSequenceName = sourceContext.name || "";
      lastTranscript.sourceSequenceDuration = sourceContext.duration || 0;
      lastTranscript.sourceSequenceIn = sourceContext.inPoint || 0;
      lastTranscript.sourceSequenceOut = sourceContext.outPoint || sourceContext.duration || 0;
      lastTranscript.sourceSequenceFps = sourceContext.frameRate || 0;
      lastTranscript.sourceSequenceSnapshot = sourceContext;
      lastTranscript.projectPath = sourceTimelineContext.projectPath || "";
      lastTranscript.words = transcriptTools.anchorWordsToSource(lastTranscript.words, sourceTimelineContext, sourceContext.id);
      lastTranscript.run = {
        extensionVersion: EXTENSION_VERSION,
        provider: provider,
        model: options.model,
        inputLanguage: options.inputLanguage,
        outputLanguage: options.outputLanguage,
        identifySpeakers: Boolean(options.identifySpeakers),
        cleanBackchannels: Boolean(options.cleanBackchannels),
        wordsPerLine: options.wordsPerLine,
        lines: options.lines,
        audio: {
          fileName: safeFileName(sourceContext.name || "secuencia") + ".mp3",
          duration: sourceContext.duration || 0
        },
        sequence: {
          id: sourceContext.id || "",
          name: sourceContext.name || "",
          duration: sourceContext.duration || 0,
          inPoint: sourceContext.inPoint || 0,
          outPoint: sourceContext.outPoint || sourceContext.duration || 0,
          frameRate: sourceContext.frameRate || 0
        }
      };
      lastTranscript.validation = validateTranscriptCompleteness(lastTranscript, sourceContext);
      lastTranscript.sourceBoundaries = transcriptTools.timelineEditBoundaries(sourceTimelineContext, sourceContext.id);
      options.hardBoundaries = lastTranscript.sourceBoundaries.hard;
      options.softBoundaries = lastTranscript.sourceBoundaries.soft;
      options.maxCharsPerLine = transcriptTools.suggestedMaxCharsPerLine(sourceContext.frameWidth, sourceContext.frameHeight);
      options.persistRunCopy = true;
      setStatus("Creando la pista de subtítulos…", 82);
      await importTranscript(lastTranscript, options);
      setStatus("Subtítulos importados en " + lastTranscript.outputFolder + ".", 100);
    } catch (error) {
      if (isCreditError(error)) {
        showCreditOffer(error, provider);
      } else {
        setStatus(error.message, 0, true);
      }
    } finally {
      removeTemporary(audioPath);
      setBusy(false);
    }
  }

  async function runReflow() {
    if (busy) { return; }
    setBusy(true);
    try {
      setStatus("Analizando el montaje de la secuencia activa…", 35);
      var timelineContext = await bridge.getTimelineContext();
      var ranked = rankActiveSequenceTranscripts(timelineContext);
      if (!ranked.length) {
        throw new Error("No encontré dentro de este proyecto una transcripción que coincida con el material usado por esta secuencia.");
      }
      var match = chooseReflowMatch(ranked);
      lastTranscript = match.data;
      setStatus("Usando la transcripción guardada de " + (lastTranscript.sourceSequenceName || "la secuencia original") + "…", 52);
      if (lastTranscript.identifySpeakers) {
        byId("identify-speakers").checked = true;
        renderSpeakerRows(lastTranscript.speakers || transcriptTools.createSpeakerMap(lastTranscript.words, lastTranscript.speakerNames));
      } else {
        byId("identify-speakers").checked = false;
        updateSpeakerControls();
      }
      applySpeakerEditor();
      var mapped = match.mapped;
      var options = collectOptions();
      var targetSequence = (timelineContext.sequences || []).filter(function (sequence) {
        return String(sequence.id) === String(timelineContext.activeSequenceId);
      })[0] || {};
      var targetBoundaries = transcriptTools.timelineEditBoundaries(timelineContext, timelineContext.activeSequenceId);
      var captions = transcriptTools.captionize(mapped.words, {
        wordsPerLine: options.wordsPerLine,
        lines: options.lines,
        maxCharsPerLine: transcriptTools.suggestedMaxCharsPerLine(targetSequence.frameWidth, targetSequence.frameHeight),
        hardBoundaries: targetBoundaries.hard,
        softBoundaries: targetBoundaries.soft,
        cleanBackchannels: options.cleanBackchannels
      });
      if (!captions.length) {
        throw new Error("No hay texto para reformatear.");
      }

      var folder = lastTranscript.outputFolder || preferredOutputFolder();
      fs.mkdirSync(folder, { recursive: true });
      var reflowBase = uniqueOutputBase(folder, safeFileName(mapped.targetSequenceName || "secuencia") +
        "-reflow-" + options.wordsPerLine + "x" + options.lines);
      var outputPath = path.join(folder, reflowBase + ".srt");
      fs.writeFileSync(outputPath, "\ufeff" + transcriptTools.toSrt(captions), "utf8");
      setStatus("Importando el Reflow de este montaje…", 82);
      await bridge.importCaptions(outputPath);
      lastTranscript.sourceSequenceId = mapped.sourceSequenceId;
      lastTranscript.sourceSequenceName = mapped.sourceSequenceName;
      persistTranscript(lastTranscript);
      setStatus("Nueva pista importada usando la transcripción de " + lastTranscript.sourceSequenceName + ".", 100);
    } catch (error) {
      setStatus(error.message, 0, true);
    } finally {
      setBusy(false);
    }
  }

  async function importTranscript(data, options) {
    applySpeakerEditor();
    var captions = transcriptTools.captionize(data.words, {
      wordsPerLine: options.wordsPerLine,
      lines: options.lines,
      maxCharsPerLine: options.maxCharsPerLine,
      hardBoundaries: options.hardBoundaries,
      softBoundaries: options.softBoundaries,
      cleanBackchannels: options.cleanBackchannels
    });
    if (!captions.length) {
      throw new Error("No hay texto para crear subtítulos.");
    }
    var folder = data.outputFolder || options.outputFolder;
    if (!folder) {
      folder = chooseFolder("Elegí dónde guardar los subtítulos", preferredOutputFolder());
      if (!folder) {
        throw new Error("No se eligió una carpeta para guardar los subtítulos.");
      }
      data.outputFolder = folder;
      localStorage.setItem("lastOutputFolder", folder);
    }
    fs.mkdirSync(folder, { recursive: true });
    if (!data.outputBaseName) {
      data.outputBaseName = uniqueOutputBase(folder, safeFileName(data.sourceSequenceName || "secuencia"));
    }
    var srtPath = path.join(folder, data.outputBaseName + ".srt");
    data.captions = serializeCaptions(captions, data.sourceSequenceFps || 0);
    enrichTranscriptJson(data);
    fs.writeFileSync(srtPath, "\ufeff" + transcriptTools.toSrt(captions), "utf8");
    if (options.persistRunCopy) {
      persistTranscript(data, true);
    }
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
      identifySpeakers: byId("identify-speakers").checked,
      speakerCount: getSpeakerRows().length,
      speakerNames: getSpeakerNames(),
      cleanBackchannels: byId("clean-backchannels").checked,
      keys: savedKeys()
    };
  }

  function addSpeakerRow(speaker) {
    var rows = byId("speaker-rows");
    var index = rows.children.length;
    var metadata = speaker || {};
    var row = document.createElement("label");
    row.className = "speaker-row";
    row.dataset.speakerId = String(metadata.id || ("manual:" + Date.now() + ":" + index));

    var label = document.createElement("span");
    label.className = "speaker-row-label";
    label.textContent = "Speaker " + (index + 1);

    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Nombre (opcional)";
    input.value = String(metadata.name || "");
    input.setAttribute("aria-label", "Nombre de Speaker " + (index + 1));

    row.appendChild(label);
    row.appendChild(input);
    rows.appendChild(row);
  }

  function renderSpeakerRows(speakers) {
    var rows = byId("speaker-rows");
    rows.textContent = "";
    (speakers || []).forEach(addSpeakerRow);
    if (!rows.children.length) {
      addSpeakerRow();
    }
    byId("identify-speakers").checked = true;
    updateSpeakerControls();
  }

  function getSpeakerRows() {
    return Array.prototype.slice.call(byId("speaker-rows").children).map(function (row, index) {
      return {
        id: row.dataset.speakerId || ("manual:" + (index + 1)),
        label: "Speaker " + (index + 1),
        name: row.querySelector("input").value.trim()
      };
    });
  }

  function getSpeakerNames() {
    return getSpeakerRows().map(function (speaker) { return speaker.name; });
  }

  function applySpeakerEditor() {
    if (!lastTranscript || !lastTranscript.identifySpeakers) { return; }
    var speakers = getSpeakerRows();
    lastTranscript.speakers = speakers;
    lastTranscript.speakerNames = speakers.map(function (speaker) { return speaker.name; });
    lastTranscript.words = transcriptTools.applySpeakerMap(lastTranscript.words, speakers);
  }

  function persistTranscript(data, writeRunCopy) {
    try {
      transcriptLibrary.saveTranscript(data);
    } catch (_libraryError) {}
    try {
      var cachePath = transcriptCachePath();
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf8");
      localStorage.setItem("lastTranscriptPath", cachePath);
      if (writeRunCopy && data.outputFolder && data.outputBaseName) {
        fs.mkdirSync(data.outputFolder, { recursive: true });
        fs.writeFileSync(path.join(data.outputFolder, data.outputBaseName + ".json"), JSON.stringify(data, null, 2), "utf8");
      }
    } catch (_error) {}
    byId("reflow").disabled = false;
  }

  function restoreTranscript() {
    if (!hasNodeRuntime) { return; }
    try {
      var cachePath = localStorage.getItem("lastTranscriptPath") || transcriptCachePath();
      if (cachePath && fs.existsSync(cachePath)) {
        lastTranscript = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        persistTranscript(lastTranscript);
        byId("reflow").disabled = false;
        if (lastTranscript.identifySpeakers) {
          byId("identify-speakers").checked = true;
          renderSpeakerRows(lastTranscript.speakers || transcriptTools.createSpeakerMap(lastTranscript.words, lastTranscript.speakerNames));
        }
      }
    } catch (_error) {
      lastTranscript = null;
    }
    byId("reflow").disabled = false;
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
    var fileSettings = readSettingsFile();
    var keys = {
      assemblyai: fileSettings.assemblyai || localStorage.getItem("assemblyaiKey") || "",
      speechmatics: fileSettings.speechmatics || localStorage.getItem("speechmaticsKey") || "",
      deepgram: fileSettings.deepgram || localStorage.getItem("deepgramKey") || ""
    };
    byId("assemblyai-key").value = keys.assemblyai;
    byId("speechmatics-key").value = keys.speechmatics;
    byId("deepgram-key").value = keys.deepgram;
    if (!fileSettings.assemblyai && !fileSettings.speechmatics && !fileSettings.deepgram && (keys.assemblyai || keys.speechmatics || keys.deepgram)) {
      writeSettingsFile(keys);
    }
    var cleanBackchannels = localStorage.getItem("cleanBackchannels");
    byId("clean-backchannels").checked = cleanBackchannels == null ? true : cleanBackchannels !== "false";
  }

  function saveSettings() {
    var keys = {
      assemblyai: byId("assemblyai-key").value.trim(),
      speechmatics: byId("speechmatics-key").value.trim(),
      deepgram: byId("deepgram-key").value.trim()
    };
    localStorage.setItem("assemblyaiKey", keys.assemblyai);
    localStorage.setItem("speechmaticsKey", keys.speechmatics);
    localStorage.setItem("deepgramKey", keys.deepgram);
    writeSettingsFile(keys);
    hideSettings();
    setStatus("Configuración guardada.", 0);
  }

  function savePreferences() {
    localStorage.setItem("cleanBackchannels", String(byId("clean-backchannels").checked));
  }

  function setBusy(value) {
    busy = value;
    byId("transcribe").disabled = value;
    byId("reflow").disabled = value;
  }

  function setStatus(message, progress, isError) {
    byId("credit-actions").classList.add("is-hidden");
    byId("status").textContent = message;
    byId("progress").value = progress || 0;
    byId("status-indicator").classList.toggle("is-error", Boolean(isError));
  }

  function savedKeys() {
    var fileSettings = readSettingsFile();
    return {
      assemblyai: fileSettings.assemblyai || localStorage.getItem("assemblyaiKey") || "",
      speechmatics: fileSettings.speechmatics || localStorage.getItem("speechmaticsKey") || "",
      deepgram: fileSettings.deepgram || localStorage.getItem("deepgramKey") || ""
    };
  }

  function settingsPath() {
    return path.join(window.LaSubtituletaPlatform.appDataRoot(), "config.json");
  }

  function readSettingsFile() {
    if (!hasNodeRuntime) { return {}; }
    try {
      var filePath = settingsPath();
      return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : {};
    } catch (_error) {
      return {};
    }
  }

  function writeSettingsFile(keys) {
    if (!hasNodeRuntime) { return; }
    var filePath = settingsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(keys, null, 2), { encoding: "utf8", mode: 384 });
  }

  function transcriptCachePath() {
    return path.join(path.dirname(settingsPath()), "ultima-transcripcion.json");
  }

  function preferredOutputFolder() {
    return (lastTranscript && lastTranscript.outputFolder) || localStorage.getItem("lastOutputFolder") || path.join(os.homedir(), "Documents");
  }

  function chooseFolder(title, initialPath) {
    if (!window.cep || !window.cep.fs || typeof window.cep.fs.showOpenDialogEx !== "function") {
      throw new Error("Premiere no pudo abrir el selector de carpetas.");
    }
    var result = window.cep.fs.showOpenDialogEx(false, true, title, initialPath || "", [], "", "Elegir carpeta");
    if (result && result.err) {
      throw new Error("El selector de carpetas devolvió el error " + result.err + ".");
    }
    return result && result.data && result.data.length ? result.data[0] : "";
  }

  function isCreditError(error) {
    var detail = String((error && (error.detail || error.message)) || "").toLowerCase();
    return Number(error && error.statusCode) === 402 || /credit|credits|quota|balance|billing|payment required|insufficient funds|usage limit|limit reached|exceeded/.test(detail);
  }

  function showCreditOffer(error, fallbackProvider) {
    var provider = error.provider || fallbackProvider;
    var label = PROVIDER_LABELS[provider] || provider || "El proveedor";
    setStatus(label + " informó que no tenés créditos disponibles. ¿Querés usar otro proveedor?", 0, true);
    byId("credit-actions").dataset.provider = provider || "";
    byId("credit-actions").classList.remove("is-hidden");
  }

  function switchProvider() {
    var currentProvider = byId("credit-actions").dataset.provider || byId("model").value.split(":")[0];
    var keys = savedKeys();
    var options = Array.prototype.slice.call(byId("model").options);
    var replacement = options.filter(function (modelOption) {
      var provider = modelOption.value.split(":")[0];
      return provider !== currentProvider && Boolean(keys[provider]);
    })[0];
    if (!replacement) {
      showSettings();
      setStatus("No hay otro proveedor con una API key guardada.", 0, true);
      return;
    }
    byId("model").value = replacement.value;
    updateLanguageRules();
    setStatus("Cambié a " + (PROVIDER_LABELS[replacement.value.split(":")[0]] || replacement.text) + ". Revisá el modelo y pulsá Transcribir.", 0);
  }

  function dismissCreditOffer() {
    var provider = byId("credit-actions").dataset.provider;
    setStatus((PROVIDER_LABELS[provider] || "El proveedor") + " quedó sin créditos.", 0, true);
  }

  function removeTemporary(filePath) {
    try {
      if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); }
    } catch (_error) {}
  }

  function safeFileName(value) {
    return String(value || "secuencia").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/[. ]+$/g, "").slice(0, 90) || "secuencia";
  }

  function uniqueOutputBase(folder, requestedBase) {
    var base = safeFileName(requestedBase || "secuencia");
    var candidate = base;
    var counter = 2;
    while ([".srt", ".json"].some(function (suffix) {
      return fs.existsSync(path.join(folder, candidate + suffix));
    })) {
      candidate = base + "-" + (counter < 10 ? "0" : "") + counter;
      counter++;
    }
    return candidate;
  }

  function serializeCaptions(captions, frameRate) {
    var fps = Number(frameRate);
    var validFps = isFinite(fps) && fps > 0;
    return (captions || []).map(function (caption, captionIndex) {
      return {
        id: captionIndex + 1,
        start: Number(caption.start || 0),
        end: Number(caption.end || 0),
        startMs: Math.round(Number(caption.start || 0) * 1000),
        endMs: Math.round(Number(caption.end || 0) * 1000),
        startFrame: validFps ? Math.round(Number(caption.start || 0) * fps) : null,
        endFrame: validFps ? Math.round(Number(caption.end || 0) * fps) : null,
        text: String(caption.text || ""),
        speaker: String(caption.speakerLabel || caption.speaker || ""),
        speakerId: String(caption.speaker || ""),
        confidence: isFinite(Number(caption.confidence)) ? Number(caption.confidence) : null,
        words: (caption.words || []).map(function (word, wordIndex) {
          return {
            index: wordIndex + 1,
            text: String(word.text || ""),
            start: Number(word.start || 0),
            end: Number(word.end || 0),
            startMs: Math.round(Number(word.start || 0) * 1000),
            endMs: Math.round(Number(word.end || 0) * 1000),
            startFrame: validFps ? Math.round(Number(word.start || 0) * fps) : null,
            endFrame: validFps ? Math.round(Number(word.end || 0) * fps) : null,
            confidence: isFinite(Number(word.confidence)) ? Number(word.confidence) : null,
            speaker: String(word.speakerLabel || word.speaker || ""),
            speakerId: String(word.speaker || ""),
            sourceKey: String(word.sourceKey || ""),
            sourceStart: word.sourceStart == null ? null : Number(word.sourceStart),
            sourceEnd: word.sourceEnd == null ? null : Number(word.sourceEnd)
          };
        })
      };
    });
  }

  function enrichTranscriptJson(data) {
    var fps = Number(data.sourceSequenceFps || 0);
    var validFps = isFinite(fps) && fps > 0;
    var captions = data.captions || [];
    var words = data.words || [];
    var hardBoundaries = data.sourceBoundaries && data.sourceBoundaries.hard || [];
    var softBoundaries = data.sourceBoundaries && data.sourceBoundaries.soft || [];

    data.words = words.map(function (word, index) {
      var previous = words[index - 1];
      var next = words[index + 1];
      var pauseBefore = previous ? Math.max(0, Number(word.start || 0) - Number(previous.end || 0)) : null;
      var pauseAfter = next ? Math.max(0, Number(next.start || 0) - Number(word.end || 0)) : null;
      var speaker = String(word.speakerLabel || word.speaker || "");
      var previousSpeaker = previous ? String(previous.speakerLabel || previous.speaker || "") : "";
      var nextSpeaker = next ? String(next.speakerLabel || next.speaker || "") : "";
      var speakerChangeBefore = Boolean(previous && speaker && previousSpeaker && speaker !== previousSpeaker);
      var speakerChangeAfter = Boolean(next && speaker && nextSpeaker && speaker !== nextSpeaker);
      var start = Number(word.start || 0);
      var end = Number(word.end || start);
      var enriched = {};
      Object.keys(word).forEach(function (key) { enriched[key] = word[key]; });
      enriched.startMs = Math.round(start * 1000);
      enriched.endMs = Math.round(end * 1000);
      enriched.startFrame = validFps ? Math.round(start * fps) : null;
      enriched.endFrame = validFps ? Math.round(end * fps) : null;
      enriched.pauseBefore = pauseBefore;
      enriched.pauseAfter = pauseAfter;
      enriched.pauseBeforeClass = classifyPause(pauseBefore);
      enriched.pauseAfterClass = classifyPause(pauseAfter);
      enriched.speakerChangeBefore = speakerChangeBefore;
      enriched.speakerChangeAfter = speakerChangeAfter;
      enriched.backchannel = isBackchannelText(word.text);
      enriched.shortReaction = enriched.backchannel && (end - start) <= 1.2;
      enriched.language = data.outputLanguage && data.outputLanguage !== "same" ? data.outputLanguage : data.inputLanguage || null;
      enriched.nearestEditBoundary = nearestBoundary(start, hardBoundaries.concat(softBoundaries));
      return enriched;
    });

    captions.forEach(function (caption, index) {
      var previous = captions[index - 1];
      var next = captions[index + 1];
      var text = String(caption.text || "");
      var flatText = text.replace(/\s+/g, " ").trim();
      var wordCount = flatText ? flatText.split(/\s+/).length : 0;
      var duration = Math.max(0.001, Number(caption.end || 0) - Number(caption.start || 0));
      var pauseBefore = previous ? Math.max(0, Number(caption.start || 0) - Number(previous.end || 0)) : null;
      var pauseAfter = next ? Math.max(0, Number(next.start || 0) - Number(caption.end || 0)) : null;
      var speaker = String(caption.speaker || caption.speakerId || "");
      var previousSpeaker = previous ? String(previous.speaker || previous.speakerId || "") : "";
      var nextSpeaker = next ? String(next.speaker || next.speakerId || "") : "";
      var speakerChangeBefore = Boolean(previous && speaker && previousSpeaker && speaker !== previousSpeaker);
      var speakerChangeAfter = Boolean(next && speaker && nextSpeaker && speaker !== nextSpeaker);
      var nearest = nearestBoundary(Number(caption.start || 0), hardBoundaries.concat(softBoundaries));
      caption.editorial = {
        wordCount: wordCount,
        characters: flatText.length,
        duration: duration,
        wordsPerSecond: wordCount / duration,
        charactersPerSecond: flatText.length / duration,
        pauseBefore: pauseBefore,
        pauseAfter: pauseAfter,
        pauseBeforeClass: classifyPause(pauseBefore),
        pauseAfterClass: classifyPause(pauseAfter),
        speakerChangeBefore: speakerChangeBefore,
        speakerChangeAfter: speakerChangeAfter,
        interruptionLike: speakerChangeBefore && pauseBefore != null && pauseBefore < 0.25,
        returnsToPreviousSpeaker: Boolean(previous && next && previousSpeaker && nextSpeaker && previousSpeaker === nextSpeaker && speaker !== previousSpeaker),
        backchannel: isBackchannelText(flatText),
        shortReaction: isBackchannelText(flatText) && duration <= 1.5,
        hangingConnector: endsWithConnector(flatText),
        lowConfidence: caption.confidence != null && Number(caption.confidence) < 0.75,
        readingRisk: duration < 0.8 || (flatText.length / duration) > 20 || wordCount <= 1,
        nearestEditBoundary: nearest,
        crossesHardBoundary: crossesBoundary(Number(caption.start || 0), Number(caption.end || 0), hardBoundaries),
        crossesSoftBoundary: crossesBoundary(Number(caption.start || 0), Number(caption.end || 0), softBoundaries)
      };
    });

    data.editorialSummary = buildEditorialSummary(captions, data.words);
  }

  function buildEditorialSummary(captions, words) {
    return {
      captions: captions.length,
      words: words.length,
      backchannels: captions.filter(function (caption) { return caption.editorial && caption.editorial.backchannel; }).length,
      shortReactions: captions.filter(function (caption) { return caption.editorial && caption.editorial.shortReaction; }).length,
      speakerChanges: captions.filter(function (caption) { return caption.editorial && caption.editorial.speakerChangeBefore; }).length,
      interruptionsLike: captions.filter(function (caption) { return caption.editorial && caption.editorial.interruptionLike; }).length,
      hangingConnectors: captions.filter(function (caption) { return caption.editorial && caption.editorial.hangingConnector; }).length,
      readingRisks: captions.filter(function (caption) { return caption.editorial && caption.editorial.readingRisk; }).length,
      lowConfidenceCaptions: captions.filter(function (caption) { return caption.editorial && caption.editorial.lowConfidence; }).length,
      longPauses: words.filter(function (word) { return word.pauseBeforeClass === "long" || word.pauseAfterClass === "long"; }).length
    };
  }

  function classifyPause(value) {
    if (value == null || !isFinite(Number(value))) { return null; }
    value = Number(value);
    if (value >= 1.2) { return "long"; }
    if (value >= 0.45) { return "medium"; }
    if (value >= 0.12) { return "short"; }
    return "none";
  }

  function cleanToken(value) {
    return String(value || "").toLowerCase().replace(/^[¿¡"'“”‘’([{]+|[,.;:!?…"'“”‘’)}\]]+$/g, "");
  }

  function isBackchannelText(value) {
    var tokens = String(value || "").split(/\s+/).map(cleanToken).filter(Boolean);
    if (!tokens.length || tokens.length > 3) { return false; }
    var joined = tokens.join(" ");
    return /^(aja|ajá|claro|dale|exacto|mmm|mm|ok|okay|obvio|si|sí|tal cual|total|bueno)$/.test(joined);
  }

  function endsWithConnector(value) {
    var tokens = String(value || "").split(/\s+/).filter(Boolean);
    if (!tokens.length) { return false; }
    return /^(a|al|con|de|del|e|el|en|la|las|lo|los|o|para|pero|por|que|sin|u|un|una|unos|unas|y)$/i.test(cleanToken(tokens[tokens.length - 1]));
  }

  function nearestBoundary(time, boundaries) {
    var best = null;
    (boundaries || []).forEach(function (boundary) {
      boundary = Number(boundary);
      if (!isFinite(boundary)) { return; }
      var distance = Math.abs(boundary - Number(time || 0));
      if (!best || distance < best.distance) {
        best = { time: boundary, distance: distance };
      }
    });
    return best;
  }

  function crossesBoundary(start, end, boundaries) {
    return (boundaries || []).some(function (boundary) {
      boundary = Number(boundary);
      return isFinite(boundary) && boundary > start && boundary < end;
    });
  }

  function sameProject(left, right) {
    return Boolean(left && right) &&
      transcriptLibrary.normalizeProjectPath(left) === transcriptLibrary.normalizeProjectPath(right);
  }

  function transcriptSearchFolders(timelineContext, candidates) {
    var folders = [];
    function add(folder) {
      if (!folder) { return; }
      var normalized = window.LaSubtituletaPlatform.fileKey(folder);
      if (!folders.some(function (item) { return window.LaSubtituletaPlatform.fileKey(item) === normalized; })) {
        folders.push(folder);
      }
    }
    add(localStorage.getItem("lastOutputFolder"));
    if (lastTranscript && sameProject(lastTranscript.projectPath, timelineContext.projectPath)) {
      add(lastTranscript.outputFolder);
    }
    (candidates || []).forEach(function (candidate) { add(candidate.outputFolder); });
    var projectPath = String(timelineContext && timelineContext.projectPath || "");
    if (projectPath) {
      var projectFolder = path.dirname(projectPath);
      var parentFolder = path.dirname(projectFolder);
      add(projectFolder);
      add(path.join(projectFolder, "Transcripts"));
      add(path.join(projectFolder, "Trascripts"));
      add(path.join(parentFolder, "Transcripts"));
      add(path.join(parentFolder, "Trascripts"));
    }
    return folders;
  }

  function rankActiveSequenceTranscripts(timelineContext) {
    var candidates = transcriptLibrary.loadProjectTranscripts(timelineContext.projectPath);
    if (lastTranscript && sameProject(lastTranscript.projectPath, timelineContext.projectPath)) {
      candidates.unshift(lastTranscript);
    }
    var folders = transcriptSearchFolders(timelineContext, candidates);
    candidates = candidates.concat(transcriptLibrary.discoverFolderTranscripts(timelineContext, folders));
    return transcriptLibrary.rankTranscripts(timelineContext, candidates);
  }

  function chooseReflowMatch(ranked) {
    var top = ranked[0];
    var contenders = ranked.filter(function (candidate) {
      return candidate.data.sourceSequenceId !== top.data.sourceSequenceId &&
        candidate.score >= top.score * 0.97;
    });
    if (!contenders.length) { return top; }
    var choices = [top].concat(contenders).slice(0, 5);
    var message = "Encontré más de una transcripción compatible:\n\n";
    choices.forEach(function (choice, index) {
      message += (index + 1) + ". " + (choice.data.sourceSequenceName || "Secuencia sin nombre") +
        " — " + choice.wordCount + " palabras coincidentes\n";
    });
    var selected = window.prompt(message + "\nEscribí el número que querés usar:", "1");
    var selectedIndex = parseInt(selected, 10) - 1;
    if (selected == null) { throw new Error("Reflow cancelado."); }
    if (!isFinite(selectedIndex) || selectedIndex < 0 || selectedIndex >= choices.length) {
      throw new Error("La opción de transcripción no es válida.");
    }
    return choices[selectedIndex];
  }

  function validateTranscriptCompleteness(data, sequence) {
    var expected = Number(sequence.duration || 0);
    var providerDuration = Number(data.providerMetadata && data.providerMetadata.audioDuration || 0);
    var words = data.words || [];
    var transcriptEnd = words.length ? Number(words[words.length - 1].end || 0) : 0;
    var tolerance = Math.max(3, expected * 0.05);
    if (expected > 0 && providerDuration > 0 && Math.abs(providerDuration - expected) > tolerance) {
      throw new Error(
        "La transcripción quedó incompleta: el audio de Premiere dura " + readableDuration(expected) +
        " y el servicio procesó " + readableDuration(providerDuration) + ". No se guardaron archivos."
      );
    }
    if (expected >= 120 && transcriptEnd > 0 && transcriptEnd < expected * 0.35) {
      throw new Error(
        "La transcripción parece incompleta: el audio dura " + readableDuration(expected) +
        " y el texto termina en " + readableDuration(transcriptEnd) + ". No se guardaron archivos."
      );
    }
    return {
      complete: true,
      expectedAudioDuration: expected,
      providerAudioDuration: providerDuration,
      transcriptEnd: transcriptEnd,
      checkedAt: new Date().toISOString()
    };
  }

  function readableDuration(seconds) {
    var total = Math.max(0, Math.round(Number(seconds || 0)));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;
    return (hours ? hours + ":" + (minutes < 10 ? "0" : "") : "") + minutes + ":" + (secs < 10 ? "0" : "") + secs;
  }

  function byId(id) { return document.getElementById(id); }
  function option(value, label) {
    var element = document.createElement("option");
    element.value = value;
    element.textContent = label;
    return element;
  }
})();

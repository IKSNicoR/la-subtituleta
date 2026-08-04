(function (root) {
  "use strict";

  var fs = require("fs");
  var path = require("path");
  var http = root.SubtituladorHttp;
  var transcript = root.SubtituladorTranscript;

  function transcribe(options, onProgress) {
    var parts = String(options.model || "").split(":");
    var provider = parts[0];
    var model = parts.slice(1).join(":");
    if (provider === "assemblyai") {
      return assemblyAI(options, model, onProgress);
    }
    if (provider === "speechmatics") {
      return speechmatics(options, model, onProgress);
    }
    if (provider === "deepgram") {
      return deepgram(options, model, onProgress);
    }
    return Promise.reject(new Error("Modelo no reconocido."));
  }

  async function assemblyAI(options, model, onProgress) {
    var key = requiredKey(options.keys.assemblyai, "AssemblyAI");
    onProgress(42, "Subiendo audio a AssemblyAI…");
    var upload = await http.request("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { authorization: key, "Content-Type": mimeFor(options.audioPath) },
      timeout: 600000
    }, fs.readFileSync(options.audioPath));
    var uploadData = JSON.parse(upload.body.toString("utf8"));

    var payload = {
      audio_url: uploadData.upload_url,
      speech_models: assemblySpeechModels(model)
    };
    if (options.inputLanguage === "auto") {
      payload.language_detection = true;
    } else {
      payload.language_code = options.inputLanguage;
    }
    if (isTranslation(options)) {
      // Per-utterance translation needs speaker labels. Plain subtitles do
      // not, so avoid the extra diarization work in the common path.
      payload.speaker_labels = true;
      payload.speech_understanding = {
        request: {
          translation: {
            target_languages: [options.outputLanguage],
            match_original_utterance: true,
            formal: false
          }
        }
      };
    }

    onProgress(52, "Transcribiendo con AssemblyAI…");
    var submitted = await http.json("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { authorization: key }
    }, payload);
    if (!submitted.id) {
      throw new Error(submitted.error || "AssemblyAI no devolvió un ID de transcripción.");
    }

    var result = await poll(async function () {
      return http.json("https://api.assemblyai.com/v2/transcript/" + submitted.id, {
        headers: { authorization: key }
      });
    }, function (value) { return value.status === "completed"; }, function (value, elapsedSeconds) {
      if (value.status === "error") {
        throw new Error(value.error || "AssemblyAI rechazó la transcripción.");
      }
      onProgress(62, "AssemblyAI está procesando… " + elapsedSeconds + " s");
    });

    var words;
    if (isTranslation(options)) {
      words = translatedAssemblyWords(result, options.outputLanguage);
    } else {
      words = (result.words || []).map(function (word) {
        return { text: word.text, start: word.start / 1000, end: word.end / 1000, confidence: word.confidence };
      });
    }
    return normalizedResult(options, words, result.language_code || options.inputLanguage);
  }

  function translatedAssemblyWords(result, language) {
    var output = [];
    (result.utterances || []).forEach(function (utterance) {
      var translated = utterance.translated_texts && utterance.translated_texts[language];
      if (translated) {
        output = output.concat(transcript.distributeText(translated, utterance.start / 1000, utterance.end / 1000, utterance.confidence));
      }
    });
    if (!output.length && result.translated_texts && result.translated_texts[language]) {
      var end = result.audio_duration || lastEndMs(result.words) / 1000;
      output = transcript.distributeText(result.translated_texts[language], 0, end, 1);
    }
    if (!output.length) {
      throw new Error("AssemblyAI no devolvió la traducción solicitada.");
    }
    return output;
  }

  function assemblySpeechModels(model) {
    if (model === "universal-2") {
      return ["universal-2"];
    }
    if (model === "slam-1") {
      return ["slam-1"];
    }
    // Universal-3.5 Pro covers its supported languages first; Universal-2
    // provides the documented fallback for the wider language set.
    return ["universal-3-5-pro", "universal-2"];
  }

  async function deepgram(options, model, onProgress) {
    var key = requiredKey(options.keys.deepgram, "Deepgram");
    if (isTranslation(options)) {
      throw new Error("Deepgram no ofrece traducción. Elegí el mismo idioma de entrada y salida, o usá AssemblyAI/Speechmatics.");
    }
    var params = new URLSearchParams({
      model: model || "nova-3",
      smart_format: "true",
      punctuate: "true",
      utterances: "true"
    });
    if (options.inputLanguage === "auto") {
      params.set("detect_language", "true");
    } else {
      params.set("language", options.inputLanguage);
    }
    onProgress(48, "Transcribiendo con Deepgram…");
    var response = await http.request("https://api.deepgram.com/v1/listen?" + params.toString(), {
      method: "POST",
      headers: {
        Authorization: "Token " + key,
        "Content-Type": mimeFor(options.audioPath)
      },
      timeout: 600000
    }, fs.readFileSync(options.audioPath));
    var data = JSON.parse(response.body.toString("utf8"));
    var alternative = data.results && data.results.channels && data.results.channels[0] && data.results.channels[0].alternatives[0];
    if (!alternative) {
      throw new Error("Deepgram no devolvió palabras.");
    }
    var words = (alternative.words || []).map(function (word) {
      return { text: word.punctuated_word || word.word, start: word.start, end: word.end, confidence: word.confidence };
    });
    var detected = data.results.channels[0].detected_language || options.inputLanguage;
    return normalizedResult(options, words, detected);
  }

  async function speechmatics(options, model, onProgress) {
    var key = requiredKey(options.keys.speechmatics, "Speechmatics");
    var transcriptionConfig = {
      language: options.inputLanguage === "auto" ? "auto" : options.inputLanguage,
      model: model || "enhanced",
      diarization: "none"
    };
    var config = { type: "transcription", transcription_config: transcriptionConfig };
    if (isTranslation(options)) {
      config.translation_config = { target_languages: [options.outputLanguage] };
    }

    onProgress(44, "Subiendo audio a Speechmatics…");
    var submitted = await http.multipart("https://asr.api.speechmatics.com/v2/jobs", {
      method: "POST",
      headers: { Authorization: "Bearer " + key },
      timeout: 600000
    }, { config: JSON.stringify(config) }, {
      fieldName: "data_file",
      filename: path.basename(options.audioPath),
      contentType: mimeFor(options.audioPath),
      data: fs.readFileSync(options.audioPath)
    });
    if (!submitted.id) {
      throw new Error("Speechmatics no devolvió un ID de trabajo.");
    }

    await poll(async function () {
      return http.json("https://asr.api.speechmatics.com/v2/jobs/" + submitted.id, {
        headers: { Authorization: "Bearer " + key }
      });
    }, function (value) { return value.job && value.job.status === "done"; }, function (value, elapsedSeconds) {
      var status = value.job && value.job.status;
      if (status === "rejected" || status === "expired" || status === "deleted") {
        throw new Error((value.job && value.job.errors && value.job.errors[0] && value.job.errors[0].message) || "Speechmatics rechazó la transcripción.");
      }
      onProgress(62, "Speechmatics está procesando… " + elapsedSeconds + " s");
    });

    var result = await http.json("https://asr.api.speechmatics.com/v2/jobs/" + submitted.id + "/transcript?format=json", {
      headers: { Authorization: "Bearer " + key }
    });
    var words = isTranslation(options) ? translatedSpeechmaticsWords(result, options.outputLanguage) : speechmaticsWords(result.results);
    var language = result.metadata && result.metadata.transcription_config && result.metadata.transcription_config.language;
    return normalizedResult(options, words, language || options.inputLanguage);
  }

  function speechmaticsWords(results) {
    var output = [];
    (results || []).forEach(function (item) {
      var alternative = item.alternatives && item.alternatives[0];
      if (!alternative || !alternative.content) {
        return;
      }
      output.push({
        text: alternative.content,
        start: Number(item.start_time || 0),
        end: Number(item.end_time || item.start_time || 0),
        confidence: Number(alternative.confidence == null ? 1 : alternative.confidence)
      });
    });
    return transcript.attachPunctuation(output);
  }

  function translatedSpeechmaticsWords(result, language) {
    var segments = result.translations && result.translations[language];
    if (!segments || !segments.length) {
      throw new Error("Speechmatics no devolvió la traducción solicitada.");
    }
    var sourceWords = speechmaticsWords(result.results);
    var totalEnd = sourceWords.length ? sourceWords[sourceWords.length - 1].end : 1;
    var output = [];
    segments.forEach(function (segment, index) {
      var content = segment.content || segment.text || "";
      var start = segment.start_time;
      var end = segment.end_time;
      if (start == null || end == null) {
        start = totalEnd * (index / segments.length);
        end = totalEnd * ((index + 1) / segments.length);
      }
      output = output.concat(transcript.distributeText(content, start, end, 1));
    });
    return output;
  }

  function normalizedResult(options, words, detectedLanguage) {
    var normalized = transcript.normalizeWords(words);
    if (!normalized.length) {
      throw new Error("La API no devolvió palabras utilizables.");
    }
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      model: options.model,
      inputLanguage: detectedLanguage,
      outputLanguage: options.outputLanguage,
      words: normalized
    };
  }

  function isTranslation(options) {
    return options.outputLanguage !== "same" && options.outputLanguage !== options.inputLanguage;
  }

  function requiredKey(key, provider) {
    if (!String(key || "").trim()) {
      throw new Error("Falta la API key de " + provider + " en Configuración.");
    }
    return String(key).trim();
  }

  function mimeFor(filePath) {
    var extension = path.extname(filePath).toLowerCase();
    if (extension === ".mp3") { return "audio/mpeg"; }
    if (extension === ".aif" || extension === ".aiff") { return "audio/aiff"; }
    if (extension === ".m4a") { return "audio/mp4"; }
    return "audio/wav";
  }

  function lastEndMs(words) {
    if (!words || !words.length) { return 0; }
    return words[words.length - 1].end || 0;
  }

  async function poll(fetchValue, done, progress) {
    var started = Date.now();
    while (Date.now() - started < 2 * 60 * 60 * 1000) {
      var value = await fetchValue();
      if (done(value)) {
        return value;
      }
      progress(value, Math.round((Date.now() - started) / 1000));
      await wait(3000);
    }
    throw new Error("La transcripción superó el tiempo máximo de espera.");
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  root.SubtituladorProviders = { transcribe: transcribe };
})(window);

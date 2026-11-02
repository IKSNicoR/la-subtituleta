"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const transcript = require("../js/transcript.js");

const providersSource = fs.readFileSync(path.join(__dirname, "..", "js", "providers.js"), "utf8");

function loadProviders(http) {
  const panelWindow = { LaSubtituletaHttp: http, LaSubtituletaTranscript: transcript };
  panelWindow.window = panelWindow;
  vm.runInNewContext(providersSource, {
    window: panelWindow,
    Buffer,
    URLSearchParams,
    Promise,
    Date,
    Error,
    JSON,
    Object,
    String,
    Number,
    Boolean,
    setTimeout,
    require(name) {
      if (name === "fs") { return { readFileSync() { return Buffer.from("audio"); } }; }
      if (name === "path") { return path; }
      throw new Error("Módulo inesperado: " + name);
    }
  });
  return panelWindow.LaSubtituletaProviders;
}

function baseOptions(model) {
  return {
    model,
    inputLanguage: "es",
    outputLanguage: "same",
    audioPath: "audio.mp3",
    identifySpeakers: true,
    cleanBackchannels: true,
    speakerCount: 2,
    speakerNames: ["Nico", "Invitado"],
    keys: { assemblyai: "a", speechmatics: "s", deepgram: "d", elevenlabs: "e" }
  };
}

test("AssemblyAI envía nombres y devuelve captions con speaker identificado", async () => {
  let submittedPayload;
  const providers = loadProviders({
    request: async () => ({ body: Buffer.from(JSON.stringify({ upload_url: "https://audio" })) }),
    json: async (url, _options, value) => {
      if (url.endsWith("/v2/transcript")) {
        submittedPayload = value;
        return { id: "job" };
      }
      return {
        status: "completed",
        language_code: "es",
        utterances: [{
          speaker: "Nico",
          start: 0,
          end: 500,
          words: [{ text: "Hola", start: 0, end: 500, confidence: 1, speaker: "Nico" }]
        }]
      };
    }
  });
  const result = await providers.transcribe(baseOptions("assemblyai:universal-3-5-pro"), () => {});
  assert.equal(submittedPayload.speaker_labels, true);
  assert.equal(submittedPayload.speakers_expected, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(submittedPayload.speaker_options)), { include_speaker_confidence: true });
  assert.equal(submittedPayload.disfluencies, false);
  assert.equal(submittedPayload.speech_understanding.request.speaker_identification.speakers[0].name, "Nico");
  assert.equal(result.words[0].speakerLabel, "Nico");
  assert.equal(result.words[0].boundaryBefore, true);
  assert.equal(result.words[0].boundaryAfter, true);
});

test("AssemblyAI conserva la confianza del speaker por palabra", async () => {
  const providers = loadProviders({
    request: async () => ({ body: Buffer.from(JSON.stringify({ upload_url: "https://audio" })) }),
    json: async (url) => url.endsWith("/v2/transcript") ? { id: "job" } : {
      status: "completed",
      language_code: "es",
      utterances: [{
        speaker: "A", speaker_confidence: 0.81, start: 0, end: 500,
        words: [{ text: "Hola", start: 0, end: 500, confidence: 0.98, speaker: "A", speaker_confidence: 0.76 }]
      }]
    }
  });
  const result = await providers.transcribe(baseOptions("assemblyai:universal-3-5-pro"), () => {});
  assert.equal(result.words[0].speakerConfidence, 0.76);
  assert.equal(result.providerMetadata.requestParameters.speaker_options.include_speaker_confidence, true);
});

test("Deepgram usa el diarizador actual y etiqueta por orden", async () => {
  let requestedUrl = "";
  const providers = loadProviders({
    request: async (url) => {
      requestedUrl = url;
      return { body: Buffer.from(JSON.stringify({
        results: { channels: [{ alternatives: [{ words: [
          { word: "Hola", start: 0, end: 0.2, speaker: 0 },
          { word: "Buenas", start: 0.3, end: 0.5, speaker: 1 }
        ] }] }] }
      })) };
    }
  });
  const result = await providers.transcribe(baseOptions("deepgram:nova-3"), () => {});
  assert.match(requestedUrl, /diarize_model=latest/);
  assert.match(requestedUrl, /filler_words=false/);
  assert.deepEqual(Array.from(result.words, (word) => word.speakerLabel), ["Nico", "Invitado"]);
});

test("Deepgram conserva los límites de utterances detectados desde el audio", async () => {
  const providers = loadProviders({
    request: async () => ({ body: Buffer.from(JSON.stringify({
      results: {
        channels: [{ alternatives: [{ words: [] }] }],
        utterances: [{ id: "u1", speaker: 0, words: [
          { word: "Hola", punctuated_word: "Hola.", start: 0, end: 0.4, speaker: 0 },
          { word: "Seguimos", start: 0.4, end: 0.8, speaker: 0 }
        ] }]
      }
    })) })
  });
  const result = await providers.transcribe(baseOptions("deepgram:nova-3"), () => {});
  assert.equal(result.words[0].boundaryBefore, true);
  assert.equal(result.words[1].boundaryAfter, true);
  assert.equal(result.words[0].utteranceId, "deepgram:u1");
});

test("Speechmatics solicita speaker diarization", async () => {
  let submittedConfig;
  const providers = loadProviders({
    multipart: async (_url, _options, fields) => {
      submittedConfig = JSON.parse(fields.config);
      return { id: "job" };
    },
    json: async (url) => {
      if (url.includes("/transcript?")) {
        return {
          metadata: { transcription_config: { language: "es" } },
          results: [{
            type: "word",
            start_time: 0,
            end_time: 0.3,
            alternatives: [{ content: "Hola", confidence: 1, speaker: "S1" }]
          }]
        };
      }
      return { job: { status: "done" } };
    }
  });
  const result = await providers.transcribe(baseOptions("speechmatics:enhanced"), () => {});
  assert.equal(submittedConfig.transcription_config.diarization, "speaker");
  assert.equal(result.words[0].speakerLabel, "Nico");
});

test("Speechmatics conserva speaker_change e is_eos", async () => {
  const providers = loadProviders({
    multipart: async () => ({ id: "job" }),
    json: async (url) => {
      if (url.includes("/transcript?")) {
        return {
          metadata: { transcription_config: { language: "es" } },
          results: [
            { type: "speaker_change" },
            { type: "word", start_time: 0, end_time: 0.3, alternatives: [{ content: "Hola", confidence: 1, speaker: "S1" }] },
            { type: "punctuation", start_time: 0.3, end_time: 0.31, is_eos: true, alternatives: [{ content: ".", confidence: 1, speaker: "S1" }] }
          ]
        };
      }
      return { job: { status: "done" } };
    }
  });
  const result = await providers.transcribe(baseOptions("speechmatics:enhanced"), () => {});
  assert.equal(result.words[0].boundaryBefore, true);
  assert.equal(result.words[0].boundaryAfter, true);
  assert.equal(result.words[0].sentenceEnd, true);
});

test("Speechmatics conserva etiquetas de disfluencia para la limpieza local", async () => {
  const providers = loadProviders({
    multipart: async () => ({ id: "job" }),
    json: async (url) => url.includes("/transcript?") ? {
      metadata: { transcription_config: { language: "en" } },
      results: [{
        type: "word", start_time: 0, end_time: 0.2,
        alternatives: [{ content: "um", confidence: 1, speaker: "S1", tags: ["disfluency"] }]
      }]
    } : { job: { status: "done" } }
  });
  const result = await providers.transcribe(baseOptions("speechmatics:enhanced"), () => {});
  assert.equal(result.words[0].disfluency, true);
});

test("ElevenLabs Scribe v2 envía diarización y conserva tiempos y speakers", async () => {
  let fields;
  const providers = loadProviders({
    multipart: async (url, options, sentFields) => {
      fields = sentFields;
      assert.equal(url, "https://api.elevenlabs.io/v1/speech-to-text");
      assert.equal(options.headers["xi-api-key"], "e");
      return {
        language_code: "es", language_probability: 0.99,
        words: [
          { type: "word", text: "Hola", start: 0, end: 0.4, logprob: -0.1, speaker_id: "speaker_1" },
          { type: "spacing", text: " ", start: 0.4, end: 0.4 },
          { type: "word", text: "Nico", start: 0.4, end: 0.8, logprob: -0.2, speaker_id: "speaker_2" }
        ]
      };
    }
  });
  const result = await providers.transcribe(baseOptions("elevenlabs:scribe_v2"), () => {});
  assert.equal(fields.model_id, "scribe_v2");
  assert.equal(fields.diarize, "true");
  assert.equal(fields.num_speakers, "2");
  assert.equal(fields.no_verbatim, "true");
  assert.equal(result.words.length, 2);
  assert.deepEqual(Array.from(result.words, (word) => word.speakerLabel), ["Nico", "Invitado"]);
  assert.equal(result.providerMetadata.audioDuration, 0.8);
});

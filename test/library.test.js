"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const originalAppData = process.env.APPDATA;
const temporaryAppData = fs.mkdtempSync(path.join(os.tmpdir(), "la-subtituleta-library-"));
process.env.APPDATA = temporaryAppData;
const library = require("../js/library.js");

test.after(() => {
  process.env.APPDATA = originalAppData;
  fs.rmSync(temporaryAppData, { recursive: true, force: true });
});

function word(text, start) {
  return { text, start, end: start + 0.2, confidence: 1 };
}

test("la biblioteca conserva varias transcripciones del mismo proyecto", () => {
  const projectPath = "C:/Trabajo/Programa.prproj";
  library.saveTranscript({
    createdAt: "2026-08-01T10:00:00.000Z",
    model: "assemblyai:universal-3-5-pro",
    projectPath,
    sourceSequenceId: "grande",
    sourceSequenceName: "Programa completo",
    words: [word("uno", 0)]
  });
  library.saveTranscript({
    createdAt: "2026-08-20T10:00:00.000Z",
    model: "deepgram:nova-3",
    projectPath,
    sourceSequenceId: "cierre",
    sourceSequenceName: "Cierre",
    words: [word("dos", 0)]
  });

  const loaded = library.loadProjectTranscripts(projectPath);
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded.map((item) => item.sourceSequenceName).sort(), ["Cierre", "Programa completo"]);
});

test("Reflow elige por material e in-out aunque el último transcript y los nombres sean distintos", () => {
  const context = {
    activeSequenceId: "vertical",
    projectPath: "C:/Trabajo/Programa.prproj",
    sequences: [
      {
        id: "grande", name: "El mercado de crecimiento se mudó a Asia", duration: 200,
        clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 200, inPoint: 0, outPoint: 200, projectItemId: "media-1" }]
      },
      {
        id: "cierre", name: "Cierre", duration: 20,
        clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 20, inPoint: 600, outPoint: 620, projectItemId: "media-1" }]
      },
      {
        id: "vertical", name: "Los europeos se fueron a Asia", duration: 10,
        clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 10, inPoint: 90, outPoint: 100, projectItemId: "media-1" }]
      }
    ]
  };
  const grande = {
    createdAt: "2026-08-01T10:00:00.000Z", sourceSequenceId: "grande",
    sourceSequenceName: "El mercado de crecimiento se mudó a Asia",
    words: [word("correcto", 92), word("también", 96)]
  };
  const ultimoPeroIncorrecto = {
    createdAt: "2026-08-22T10:00:00.000Z", sourceSequenceId: "cierre",
    sourceSequenceName: "Cierre", words: [word("incorrecto", 5)]
  };

  const ranked = library.rankTranscripts(context, [ultimoPeroIncorrecto, grande]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].data.sourceSequenceId, "grande");
  assert.deepEqual(ranked[0].mapped.words.map((item) => item.text), ["correcto", "también"]);
});

test("Reflow usa la geometría guardada con la transcripción aunque la secuencia fuente cambie", () => {
  const context = {
    activeSequenceId: "vertical",
    projectPath: "C:/Trabajo/Programa.prproj",
    sequences: [
      {
        id: "grande", projectItemId: "seq-grande", name: "Programa modificado", duration: 100,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 100, inPoint: 1000, outPoint: 1100, projectItemId: "media-1" }]
      },
      {
        id: "vertical", projectItemId: "seq-vertical", name: "Corte", duration: 10,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 10, inPoint: 60, outPoint: 70, projectItemId: "media-1" }]
      }
    ]
  };
  const data = {
    createdAt: "2026-08-01T10:00:00.000Z",
    sourceSequenceId: "grande",
    sourceSequenceName: "Programa original",
    sourceSequenceSnapshot: {
      id: "grande", projectItemId: "seq-grande", name: "Programa original", duration: 100,
      clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 100, inPoint: 0, outPoint: 100, projectItemId: "media-1" }]
    },
    words: [word("correcto", 65)]
  };

  const ranked = library.rankTranscripts(context, [data]);
  assert.equal(ranked.length, 1);
  assert.deepEqual(ranked[0].mapped.words.map((item) => item.text), ["correcto"]);
  assert.equal(ranked[0].mapped.words[0].start, 5);
});

test("Reflow descarta una transcripción directa vieja si la secuencia activa ahora tiene otro material", () => {
  const context = {
    activeSequenceId: "reel",
    projectPath: "C:/Trabajo/Programa.prproj",
    sequences: [
      {
        id: "youtube", projectItemId: "seq-youtube", name: "Edwin Rager YouTube", duration: 1200,
        clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 1200, inPoint: 0, outPoint: 1200, projectItemId: "media-edwin" }]
      },
      {
        id: "reel", projectItemId: "seq-reel", name: "Edwin Rager REEL - (9x16)", duration: 90,
        clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 90, inPoint: 200, outPoint: 290, projectItemId: "media-edwin" }]
      }
    ]
  };
  const transcripcionGrandeCorrecta = {
    createdAt: "2026-08-28T10:00:00.000Z",
    sourceSequenceId: "youtube",
    sourceSequenceName: "Edwin Rager YouTube",
    sourceSequenceSnapshot: {
      id: "youtube", projectItemId: "seq-youtube", name: "Edwin Rager YouTube", duration: 1200,
      clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 1200, inPoint: 0, outPoint: 1200, projectItemId: "media-edwin" }]
    },
    words: [word("correcto", 205), word("reel", 206)]
  };
  const cacheDirectoViejo = {
    createdAt: "2026-07-30T10:00:00.000Z",
    sourceSequenceId: "reel",
    sourceSequenceName: "Edwin Rager REEL - (9x16)",
    sourceSequenceSnapshot: {
      id: "reel", projectItemId: "seq-reel", name: "Edwin Rager REEL - (9x16)", duration: 90,
      clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 90, inPoint: 17, outPoint: 107, projectItemId: "media-fifa" }]
    },
    words: [word("incorrecto", 0), word("fifa", 1)]
  };

  const ranked = library.rankTranscripts(context, [cacheDirectoViejo, transcripcionGrandeCorrecta]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].data.sourceSequenceId, "youtube");
  assert.deepEqual(ranked[0].mapped.words.map((item) => item.text), ["correcto", "reel"]);
});

test("Reflow no prioriza un SRT recuperado viejo sobre un JSON real compatible", () => {
  const context = {
    activeSequenceId: "reel",
    projectPath: "C:/Trabajo/Programa.prproj",
    sequences: [
      {
        id: "youtube", projectItemId: "seq-youtube", name: "Edwin Rager YouTube", duration: 1200,
        clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 1200, inPoint: 0, outPoint: 1200, projectItemId: "media-edwin" }]
      },
      {
        id: "reel", projectItemId: "seq-reel", name: "Edwin Rager REEL - (9x16)", duration: 90,
        clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 90, inPoint: 200, outPoint: 290, projectItemId: "media-edwin" }]
      }
    ]
  };
  const jsonReal = {
    createdAt: "2026-08-28T10:00:00.000Z",
    model: "deepgram:nova-3",
    sourceSequenceId: "youtube",
    sourceSequenceName: "Edwin Rager YouTube",
    sourceSequenceSnapshot: {
      id: "youtube", name: "Edwin Rager YouTube", duration: 1200,
      clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 1200, inPoint: 0, outPoint: 1200, projectItemId: "media-edwin" }]
    },
    words: [word("json", 205), word("real", 206), word("correcto", 207)]
  };
  const srtViejo = {
    createdAt: "2026-07-30T10:00:00.000Z",
    model: "srt-recuperado",
    sourceSequenceId: "reel",
    sourceSequenceName: "Edwin Rager REEL - (9x16)",
    sourceSequenceSnapshot: {
      id: "reel", name: "Edwin Rager REEL - (9x16)", duration: 90,
      clips: [{ trackType: "audio", trackIndex: 0, start: 0, end: 90, inPoint: 200, outPoint: 290, projectItemId: "media-edwin" }]
    },
    words: [word("srt", 5), word("viejo", 6), word("incorrecto", 7)]
  };

  const ranked = library.rankTranscripts(context, [srtViejo, jsonReal]);
  assert.equal(ranked[0].data.model, "deepgram:nova-3");
  assert.deepEqual(ranked[0].mapped.words.map((item) => item.text), ["json", "real", "correcto"]);
});

test("la biblioteca no recupera SRTs sueltos para evitar reflows contaminados", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "la-subtituleta-srt-"));
  const srtPath = path.join(folder, "El mercado de crecimiento se mudó a Asia.srt");
  fs.writeFileSync(srtPath, [
    "1", "00:01:32,000 --> 00:01:33,000", "texto recuperado", ""
  ].join("\r\n"), "utf8");
  const context = {
    activeSequenceId: "vertical",
    projectPath: "C:/Trabajo/Programa.prproj",
    sequences: [
      { id: "grande", name: "El mercado de crecimiento se mudó a Asia", duration: 200, clips: [
        { trackType: "audio", trackIndex: 0, start: 0, end: 200, inPoint: 0, outPoint: 200, projectItemId: "media-1" }
      ] },
      { id: "vertical", name: "Los europeos se fueron a Asia", duration: 10, clips: [
        { trackType: "audio", trackIndex: 0, start: 0, end: 10, inPoint: 90, outPoint: 100, projectItemId: "media-1" }
      ] }
    ]
  };

  const discovered = library.discoverFolderTranscripts(context, [folder]);
  assert.deepEqual(discovered, []);
  fs.rmSync(folder, { recursive: true, force: true });
});

const test = require("node:test");
const assert = require("node:assert/strict");
const transcript = require("../js/transcript.js");

test("reflow balancea captions sin superar palabras por línea ni líneas", () => {
  const words = Array.from({ length: 13 }, (_, index) => ({
    text: `p${index + 1}`,
    start: index * 0.25,
    end: index * 0.25 + 0.2,
    confidence: 1
  }));
  const captions = transcript.captionize(words, { wordsPerLine: 3, lines: 2 });
  assert.equal(captions.length, 3);
  assert.deepEqual(captions.map((caption) => transcript.tokenize(caption.text).length), [5, 4, 4]);
  captions.forEach((caption) => {
    assert.ok(caption.text.split("\n").length <= 2);
    caption.text.split("\n").forEach((line) => assert.ok(transcript.tokenize(line).length <= 3));
  });
});

test("trece palabras en 6x2 se redistribuyen 7 y 6, nunca 12 y 1", () => {
  const words = "el mapa de la plata del deporte que está siendo redibujado o redefinido.".split(" ").map((text, index) => ({
    text,
    start: index * 0.25,
    end: index * 0.25 + 0.2,
    confidence: 0.9
  }));
  const captions = transcript.captionize(words, { wordsPerLine: 6, lines: 2 });
  assert.deepEqual(captions.map((caption) => transcript.tokenize(caption.text).length), [7, 6]);
  assert.equal(captions[0].text, "el mapa de la\nplata del deporte");
  assert.doesNotMatch(captions[0].text, /\b(?:y|o|de|que)$/i);
});

test("una pausa media no deja Y también aislado", () => {
  const captions = transcript.captionize([
    { text: "Y", start: 0, end: 0.2 },
    { text: "también,", start: 0.2, end: 0.55 },
    { text: "vamos", start: 1.5, end: 1.8 },
    { text: "a", start: 1.8, end: 1.95 },
    { text: "verlo.", start: 1.95, end: 2.35 }
  ], { wordsPerLine: 6, lines: 2 });
  assert.equal(captions.length, 1);
  assert.equal(captions[0].text, "Y también, vamos a verlo.");
});

test("reflow corta ante silencios largos", () => {
  const words = [
    { text: "Hola", start: 0, end: 0.3 },
    { text: "mundo.", start: 0.35, end: 0.7 },
    { text: "Después", start: 2, end: 2.4 }
  ];
  const captions = transcript.captionize(words, { wordsPerLine: 8, lines: 2 });
  assert.equal(captions.length, 2);
  assert.equal(captions[0].text, "Hola mundo.");
});

test("SRT usa tiempo con milisegundos y CRLF", () => {
  const srt = transcript.toSrt([{ start: 61.005, end: 62.25, text: "Línea uno" }]);
  assert.match(srt, /^1\r\n00:01:01,005 --> 00:01:02,250\r\nLínea uno\r\n$/);
});

test("la puntuación de Speechmatics se adjunta a la palabra anterior", () => {
  const words = transcript.attachPunctuation([
    { text: "Hola", start: 0, end: 0.3 },
    { text: ",", start: 0.3, end: 0.31 },
    { text: "mundo", start: 0.4, end: 0.8 },
    { text: "!", start: 0.8, end: 0.81 }
  ]);
  assert.deepEqual(words.map((word) => word.text), ["Hola,", "mundo!"]);
});

test("una traducción se distribuye dentro del intervalo original", () => {
  const words = transcript.distributeText("Buenos días a todos", 10, 14, 0.9);
  assert.equal(words.length, 4);
  assert.equal(words[0].start, 10);
  assert.equal(words[3].end, 14);
});

test("Speechmatics conserva la marca de final de oración al adjuntar puntuación", () => {
  const words = transcript.attachPunctuation([
    { text: "Terminó", start: 0, end: 0.4 },
    { text: ".", start: 0.4, end: 0.41, boundaryAfter: true, sentenceEnd: true }
  ]);
  assert.equal(words[0].text, "Terminó.");
  assert.equal(words[0].boundaryAfter, true);
  assert.equal(words[0].sentenceEnd, true);
});

test("los límites de la API y el speaker separan captions aunque no haya pausa", () => {
  const captions = transcript.captionize([
    { text: "Primera", start: 0, end: 0.25, speaker: "A", utteranceId: "u1" },
    { text: "frase", start: 0.25, end: 0.5, speaker: "A", utteranceId: "u1", boundaryAfter: true },
    { text: "Respuesta", start: 0.5, end: 0.8, speaker: "B", utteranceId: "u2", boundaryBefore: true }
  ], { wordsPerLine: 8, lines: 2 });
  assert.equal(captions.length, 2);
  assert.equal(captions[0].text, "Primera frase");
  assert.equal(captions[1].text, "Respuesta");
});

test("limpia devoluciones cortas pegadas al final de una frase", () => {
  const captions = transcript.captionize([
    { text: "hemos", start: 0, end: 0.2, speaker: "A" },
    { text: "puesto", start: 0.2, end: 0.4, speaker: "A" },
    { text: "nosotros", start: 0.4, end: 0.6, speaker: "A" },
    { text: "en", start: 0.6, end: 0.75, speaker: "A" },
    { text: "equipos", start: 0.75, end: 1.05, speaker: "A" },
    { text: "de", start: 1.05, end: 1.2, speaker: "A" },
    { text: "esports.", start: 1.2, end: 1.55, speaker: "A" },
    { text: "Ajá.", start: 1.72, end: 1.95, speaker: "B" }
  ], { wordsPerLine: 6, lines: 2, cleanBackchannels: true });

  assert.equal(captions.length, 1);
  assert.equal(captions[0].text.replace(/\s*\n\s*/g, " "), "hemos puesto nosotros en equipos de esports.");
  assert.doesNotMatch(captions[0].text, /Ajá/i);
});

test("limpia claro como devolución pegada al diálogo principal", () => {
  const captions = transcript.captionize([
    { text: "de", start: 0, end: 0.12, speaker: "A" },
    { text: "la", start: 0.12, end: 0.24, speaker: "A" },
    { text: "foto", start: 0.24, end: 0.48, speaker: "A" },
    { text: "para", start: 0.48, end: 0.7, speaker: "A" },
    { text: "el", start: 0.7, end: 0.82, speaker: "A" },
    { text: "board.", start: 0.82, end: 1.05, speaker: "A" },
    { text: "Claro.", start: 1.12, end: 1.35, speaker: "B" }
  ], { wordsPerLine: 6, lines: 2, cleanBackchannels: true });

  assert.equal(captions.length, 1);
  assert.equal(captions[0].text.replace(/\s*\n\s*/g, " "), "de la foto para el board.");
  assert.doesNotMatch(captions[0].text, /Claro/i);
});

test("con limpieza apagada conserva devoluciones cortas", () => {
  const captions = transcript.captionize([
    { text: "texto", start: 0, end: 0.3, speaker: "A" },
    { text: "principal.", start: 0.3, end: 0.6, speaker: "A" },
    { text: "Claro.", start: 0.8, end: 1, speaker: "B" }
  ], { wordsPerLine: 6, lines: 2, cleanBackchannels: false });

  assert.deepEqual(captions.map((caption) => caption.text), ["texto principal.", "Claro."]);
});

test("los cortes de audio son obligatorios y los de video requieren una pausa natural", () => {
  const hard = transcript.captionize([
    { text: "antes", start: 3.5, end: 4.2 },
    { text: "después", start: 4.3, end: 4.7 }
  ], { wordsPerLine: 8, lines: 2, hardBoundaries: [4] });
  assert.equal(hard.length, 2);
  assert.equal(hard[0].end, 4);

  const softWithPause = transcript.captionize([
    { text: "plano", start: 5.5, end: 5.8 },
    { text: "nuevo", start: 6.05, end: 6.4 }
  ], { wordsPerLine: 8, lines: 2, softBoundaries: [6] });
  assert.equal(softWithPause.length, 2);

  const softWithoutPause = transcript.captionize([
    { text: "cambio", start: 5.7, end: 5.98 },
    { text: "visual", start: 6, end: 6.3 }
  ], { wordsPerLine: 8, lines: 2, softBoundaries: [6] });
  assert.equal(softWithoutPause.length, 1);
});

test("extrae por separado los cortes principales de audio y video", () => {
  const context = {
    activeSequenceId: "edit",
    sequences: [{
      id: "edit", projectItemId: "seq-edit", duration: 10,
      clips: [
        { trackType: "audio", trackIndex: 0, start: 0, end: 4, inPoint: 0, outPoint: 4, mediaPath: "a.wav", projectItemId: "a" },
        { trackType: "audio", trackIndex: 0, start: 4, end: 10, inPoint: 8, outPoint: 14, mediaPath: "a.wav", projectItemId: "a" },
        { trackType: "video", trackIndex: 0, start: 0, end: 6, inPoint: 0, outPoint: 6, mediaPath: "v.mp4", projectItemId: "v" },
        { trackType: "video", trackIndex: 0, start: 6, end: 10, inPoint: 20, outPoint: 24, mediaPath: "v.mp4", projectItemId: "v" }
      ]
    }]
  };
  assert.deepEqual(transcript.timelineEditBoundaries(context), { hard: [4], soft: [6] });
});

test("en vertical redistribuye los in-out para evitar líneas visualmente envueltas", () => {
  const words = transcript.distributeText(
    "Tuve que dar una capacitación donde parte de la capacitación era mejorar",
    6.785,
    10.833,
    1
  );
  const captions = transcript.captionize(words, {
    wordsPerLine: 6,
    lines: 2,
    maxCharsPerLine: transcript.suggestedMaxCharsPerLine(1080, 1920)
  });

  assert.equal(transcript.suggestedMaxCharsPerLine(1080, 1920), 28);
  assert.ok(captions.length > 1);
  assert.equal(captions[0].start, 6.785);
  assert.equal(captions.at(-1).end, 10.833);
  assert.ok(captions[0].end < captions.at(-1).end);
  captions.forEach((caption) => {
    const lines = caption.text.split("\n");
    assert.ok(lines.length <= 2);
    lines.forEach((line) => {
      assert.ok(transcript.tokenize(line).length <= 6);
      assert.ok(line.length <= 28);
    });
  });
});

test("reflow desde SRT conserva el rango del corte y respeta una sola línea", () => {
  const source = [
    "1",
    "00:43:30,708 --> 00:43:32,583",
    "tengan siempre el ok del periodista.",
    "",
    "2",
    "00:43:32,708 --> 00:43:35,333",
    "Le voy a contar otro caso",
    "que me pasó con una redacción",
    ""
  ].join("\r\n");
  const parsed = transcript.parseSrt(source);
  const captions = transcript.captionize(transcript.captionsToWords(parsed), { wordsPerLine: 5, lines: 1 });

  assert.equal(captions[0].start, 2610.708);
  assert.equal(captions.at(-1).end, 2615.333);
  assert.match(captions[0].text, /^tengan siempre/);
  captions.forEach((caption) => {
    assert.doesNotMatch(caption.text, /\n/);
    assert.ok(transcript.tokenize(caption.text).length <= 5);
  });
});

test("reflow automático toma solo el tramo usado por la secuencia derivada", () => {
  const context = {
    activeSequenceId: "vertical",
    sequences: [
      {
        id: "original",
        projectItemId: "seq-original",
        name: "Entrevista completa",
        duration: 100,
        clips: [{
          trackType: "video", trackIndex: 0, start: 0, end: 100,
          inPoint: 200, outPoint: 300, mediaPath: "C:/media/entrevista.mp4", projectItemId: "media-1"
        }]
      },
      {
        id: "vertical",
        projectItemId: "seq-vertical",
        name: "Corte 9x16",
        duration: 10,
        clips: [{
          trackType: "video", trackIndex: 0, start: 0, end: 10,
          inPoint: 260, outPoint: 270, mediaPath: "C:/media/entrevista.mp4", projectItemId: "media-1"
        }]
      }
    ]
  };
  const words = [
    { text: "principio", start: 1, end: 1.4 },
    { text: "correcto", start: 61, end: 61.4 },
    { text: "final", start: 99, end: 99.4 }
  ];
  const mapped = transcript.mapWordsToSequence(words, context);

  assert.equal(mapped.sourceSequenceId, "original");
  assert.equal(mapped.targetSequenceName, "Corte 9x16");
  assert.deepEqual(mapped.words.map((word) => word.text), ["correcto"]);
  assert.equal(mapped.words[0].start, 1);
  assert.ok(Math.abs(mapped.words[0].end - 1.4) < 0.000001);
});

test("las palabras quedan ancladas al archivo fuente y sobreviven cambios posteriores", () => {
  const originalContext = {
    activeSequenceId: "original",
    sequences: [{
      id: "original", duration: 100,
      clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 100, inPoint: 200, outPoint: 300, projectItemId: "media-1" }]
    }]
  };
  const anchored = transcript.anchorWordsToSource([
    { text: "estable", start: 65, end: 65.3 }
  ], originalContext, "original");
  const changedContext = {
    activeSequenceId: "vertical",
    sequences: [
      {
        id: "original", duration: 100,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 100, inPoint: 1000, outPoint: 1100, projectItemId: "media-1" }]
      },
      {
        id: "vertical", duration: 10,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 10, inPoint: 260, outPoint: 270, projectItemId: "media-1" }]
      }
    ]
  };
  const mapped = transcript.mapWordsToSequence(anchored, changedContext, "original");

  assert.equal(anchored[0].sourceStart, 265);
  assert.deepEqual(mapped.words.map((word) => word.text), ["estable"]);
  assert.equal(mapped.words[0].start, 5);
});

test("reflow automático sigue secuencias anidadas como las creadas al pasar a 9x16", () => {
  const context = {
    activeSequenceId: "vertical",
    sequences: [
      {
        id: "original", projectItemId: "seq-original", name: "Original", duration: 100,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 100, inPoint: 0, outPoint: 100, mediaPath: "C:/media/a.mp4", projectItemId: "media-a" }]
      },
      {
        id: "corte", projectItemId: "seq-corte", name: "Corte", duration: 10,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 10, inPoint: 60, outPoint: 70, mediaPath: "C:/media/a.mp4", projectItemId: "media-a" }]
      },
      {
        id: "vertical", projectItemId: "seq-vertical", name: "Vertical", duration: 10,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 10, inPoint: 0, outPoint: 10, mediaPath: "", projectItemId: "seq-corte" }]
      }
    ]
  };
  const mapped = transcript.mapWordsToSequence([
    { text: "antes", start: 2, end: 2.2 },
    { text: "elegido", start: 65, end: 65.3 }
  ], context, "original");

  assert.deepEqual(mapped.words.map((word) => word.text), ["elegido"]);
  assert.equal(mapped.words[0].start, 5);
  assert.ok(Math.abs(mapped.words[0].end - 5.3) < 0.000001);
});

test("reflow ignora el Start Time visible de una secuencia anidada", () => {
  const context = {
    activeSequenceId: "vertical",
    sequences: [
      {
        id: "original", projectItemId: "seq-original", name: "Original", duration: 100,
        zeroPointSeconds: 3600,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 100, inPoint: 0, outPoint: 100, mediaPath: "C:/media/a.mp4", projectItemId: "media-a" }]
      },
      {
        id: "vertical", projectItemId: "seq-vertical", name: "Vertical", duration: 10,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 10, inPoint: 3660, outPoint: 3670, mediaPath: "", projectItemId: "seq-original" }]
      }
    ]
  };
  const mapped = transcript.mapWordsToSequence([
    { text: "antes", start: 2, end: 2.2 },
    { text: "correcto", start: 65, end: 65.3 }
  ], context, "original");

  assert.deepEqual(mapped.words.map((word) => word.text), ["correcto"]);
  assert.equal(mapped.words[0].start, 5);
  assert.ok(Math.abs(mapped.words[0].end - 5.3) < 0.000001);
});

test("reflow conserva in-out locales aunque la secuencia tenga Start Time", () => {
  const context = {
    activeSequenceId: "vertical",
    sequences: [
      {
        id: "original", projectItemId: "seq-original", name: "Original", duration: 100,
        zeroPointSeconds: 3600,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 100, inPoint: 0, outPoint: 100, mediaPath: "C:/media/a.mp4", projectItemId: "media-a" }]
      },
      {
        id: "vertical", projectItemId: "seq-vertical", name: "Vertical", duration: 10,
        clips: [{ trackType: "video", trackIndex: 0, start: 0, end: 10, inPoint: 60, outPoint: 70, mediaPath: "", projectItemId: "seq-original" }]
      }
    ]
  };
  const mapped = transcript.mapWordsToSequence([
    { text: "correcto", start: 65, end: 65.3 }
  ], context, "original");

  assert.deepEqual(mapped.words.map((word) => word.text), ["correcto"]);
  assert.equal(mapped.words[0].start, 5);
});

test("los speakers reciben nombres por orden y fuerzan captions separados", () => {
  const words = transcript.labelSpeakers([
    { text: "Hola", start: 0, end: 0.3, speaker: "A" },
    { text: "Nico.", start: 0.3, end: 0.7, speaker: "A" },
    { text: "Buenas", start: 0.8, end: 1.1, speaker: "B" }
  ], ["Conductor", "Invitado"]);
  const captions = transcript.captionize(words, { wordsPerLine: 6, lines: 2 });
  assert.equal(captions.length, 2);
  assert.equal(captions[0].text, "Hola Nico.");
  assert.equal(captions[0].speakerLabel, "Conductor");
  assert.equal(captions[1].text, "Buenas");
  assert.equal(captions[1].speakerLabel, "Invitado");
});

test("sin nombres usa Speaker 1, Speaker 2", () => {
  const words = transcript.labelSpeakers([
    { text: "Uno", start: 0, end: 0.2, speaker: 0 },
    { text: "Dos", start: 0.3, end: 0.5, speaker: 1 }
  ], []);
  assert.deepEqual(words.map((word) => word.speakerLabel), ["Speaker 1", "Speaker 2"]);
});

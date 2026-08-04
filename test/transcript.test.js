const test = require("node:test");
const assert = require("node:assert/strict");
const transcript = require("../js/transcript.js");

test("reflow respeta palabras por línea y cantidad de líneas", () => {
  const words = Array.from({ length: 13 }, (_, index) => ({
    text: `p${index + 1}`,
    start: index * 0.25,
    end: index * 0.25 + 0.2,
    confidence: 1
  }));
  const captions = transcript.captionize(words, { wordsPerLine: 3, lines: 2 });
  assert.equal(captions.length, 3);
  assert.equal(captions[0].text, "p1 p2 p3\np4 p5 p6");
  assert.equal(captions[2].text, "p13");
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

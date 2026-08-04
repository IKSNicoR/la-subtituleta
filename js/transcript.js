(function (root) {
  "use strict";

  var TERMINAL = /[.!?…。！？]$/;
  var NO_SPACE_BEFORE = /^[,.;:!?%)}\]»”’…。、！？：；]$/;

  function tokenize(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean);
  }

  function distributeText(text, start, end, confidence) {
    var tokens = tokenize(text);
    if (!tokens.length) {
      return [];
    }
    var duration = Math.max(0.1, Number(end) - Number(start));
    return tokens.map(function (token, index) {
      var tokenStart = Number(start) + duration * (index / tokens.length);
      var tokenEnd = Number(start) + duration * ((index + 1) / tokens.length);
      return { text: token, start: tokenStart, end: tokenEnd, confidence: confidence == null ? 1 : confidence };
    });
  }

  function normalizeWords(words) {
    return (words || []).map(function (word) {
      return {
        text: String(word.text || word.punctuated_word || word.word || word.content || "").trim(),
        start: Number(word.start != null ? word.start : word.start_time || 0),
        end: Number(word.end != null ? word.end : word.end_time || word.start || word.start_time || 0),
        confidence: Number(word.confidence == null ? 1 : word.confidence)
      };
    }).filter(function (word) { return word.text && isFinite(word.start) && isFinite(word.end); });
  }

  function attachPunctuation(words) {
    var output = [];
    (words || []).forEach(function (word) {
      if (NO_SPACE_BEFORE.test(word.text) && output.length) {
        output[output.length - 1].text += word.text;
        output[output.length - 1].end = Math.max(output[output.length - 1].end, word.end);
      } else {
        output.push(word);
      }
    });
    return output;
  }

  function captionize(words, options) {
    var perLine = clampInt(options.wordsPerLine, 1, 20, 6);
    var lineCount = clampInt(options.lines, 1, 3, 2);
    var limit = perLine * lineCount;
    var captions = [];
    var current = [];

    function flush() {
      if (!current.length) {
        return;
      }
      var lines = [];
      for (var i = 0; i < current.length; i += perLine) {
        lines.push(joinWords(current.slice(i, i + perLine)));
      }
      captions.push({
        start: current[0].start,
        end: Math.max(current[current.length - 1].end, current[0].start + 0.1),
        text: lines.join("\n")
      });
      current = [];
    }

    normalizeWords(words).forEach(function (word) {
      var previous = current[current.length - 1];
      if (previous && (word.start - previous.end >= 0.9 || current.length >= limit)) {
        flush();
      }
      current.push(word);
      if (current.length >= limit || (TERMINAL.test(word.text) && current.length >= perLine)) {
        flush();
      }
    });
    flush();
    return captions;
  }

  function joinWords(words) {
    var result = "";
    words.forEach(function (word) {
      if (!result || NO_SPACE_BEFORE.test(word.text)) {
        result += word.text;
      } else {
        result += " " + word.text;
      }
    });
    return result;
  }

  function toSrt(captions) {
    return (captions || []).map(function (caption, index) {
      return (index + 1) + "\r\n" + formatTime(caption.start) + " --> " + formatTime(caption.end) + "\r\n" + caption.text + "\r\n";
    }).join("\r\n");
  }

  function formatTime(seconds) {
    var total = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    var ms = total % 1000;
    var totalSeconds = Math.floor(total / 1000);
    var secs = totalSeconds % 60;
    var totalMinutes = Math.floor(totalSeconds / 60);
    var mins = totalMinutes % 60;
    var hours = Math.floor(totalMinutes / 60);
    return pad(hours, 2) + ":" + pad(mins, 2) + ":" + pad(secs, 2) + "," + pad(ms, 3);
  }

  function pad(value, length) {
    var text = String(value);
    while (text.length < length) {
      text = "0" + text;
    }
    return text;
  }

  function clampInt(value, min, max, fallback) {
    var number = parseInt(value, 10);
    if (!isFinite(number)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, number));
  }

  var api = {
    tokenize: tokenize,
    distributeText: distributeText,
    normalizeWords: normalizeWords,
    attachPunctuation: attachPunctuation,
    captionize: captionize,
    toSrt: toSrt,
    formatTime: formatTime,
    joinWords: joinWords
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.SubtituladorTranscript = api;
})(typeof window === "undefined" ? globalThis : window);

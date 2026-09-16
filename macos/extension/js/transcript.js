(function (root) {
  "use strict";

  var platform = root.LaSubtituletaPlatform || (typeof require === "function" ? require("./platform.js") : null);

  var TERMINAL = /[.!?…。！？]$/;
  var NO_SPACE_BEFORE = /^[,.;:!?%)}\]»”’…。、！？：；]$/;
  var CONNECTOR = /^(?:a|al|con|de|del|e|el|en|la|las|lo|los|o|para|pero|por|que|sin|u|un|una|unos|unas|y)$/i;
  var BACKCHANNEL = /^(?:aja|ajá|claro|dale|exacto|mmm|mm|ok|okay|obvio|si|sí|tal|cual|total)$/i;
  var LONG_PAUSE_SECONDS = 1.2;

  function tokenize(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean);
  }

  function distributeText(text, start, end, confidence, speaker, metadata) {
    var tokens = tokenize(text);
    if (!tokens.length) {
      return [];
    }
    var duration = Math.max(0.1, Number(end) - Number(start));
    metadata = metadata || {};
    return tokens.map(function (token, index) {
      var tokenStart = Number(start) + duration * (index / tokens.length);
      var tokenEnd = Number(start) + duration * ((index + 1) / tokens.length);
      return {
        text: token,
        start: tokenStart,
        end: tokenEnd,
        confidence: confidence == null ? 1 : confidence,
        speaker: speaker == null ? "" : String(speaker),
        utteranceId: String(metadata.utteranceId || ""),
        boundaryBefore: Boolean(metadata.boundaryBefore && index === 0),
        boundaryAfter: Boolean(metadata.boundaryAfter && index === tokens.length - 1),
        sentenceEnd: Boolean(metadata.sentenceEnd && index === tokens.length - 1)
      };
    });
  }

  function normalizeWords(words) {
    return (words || []).map(function (word) {
      return {
        text: String(word.text || word.punctuated_word || word.word || word.content || "").trim(),
        start: Number(word.start != null ? word.start : word.start_time || 0),
        end: Number(word.end != null ? word.end : word.end_time || word.start || word.start_time || 0),
        confidence: Number(word.confidence == null ? 1 : word.confidence),
        speaker: word.speaker == null ? "" : String(word.speaker),
        speakerLabel: String(word.speakerLabel || ""),
        utteranceId: String(word.utteranceId || ""),
        boundaryBefore: Boolean(word.boundaryBefore),
        boundaryAfter: Boolean(word.boundaryAfter),
        sentenceEnd: Boolean(word.sentenceEnd),
        editSegmentId: String(word.editSegmentId || ""),
        sourceKey: String(word.sourceKey || ""),
        sourceStart: word.sourceStart == null ? null : Number(word.sourceStart),
        sourceEnd: word.sourceEnd == null ? null : Number(word.sourceEnd)
      };
    }).filter(function (word) { return word.text && isFinite(word.start) && isFinite(word.end); });
  }

  function attachPunctuation(words) {
    var output = [];
    (words || []).forEach(function (word) {
      if (NO_SPACE_BEFORE.test(word.text) && output.length) {
        output[output.length - 1].text += word.text;
        output[output.length - 1].end = Math.max(output[output.length - 1].end, word.end);
        output[output.length - 1].boundaryAfter = Boolean(output[output.length - 1].boundaryAfter || word.boundaryAfter);
        output[output.length - 1].sentenceEnd = Boolean(output[output.length - 1].sentenceEnd || word.sentenceEnd);
      } else {
        output.push(word);
      }
    });
    return output;
  }

  function cleanToken(value) {
    return String(value || "").toLowerCase().replace(/^[¿¡"'“”‘’([{]+|[,.;:!?…"'“”‘’)}\]]+$/g, "");
  }

  function isBackchannelAtEdge(words, index) {
    var token = cleanToken(words[index] && words[index].text);
    if (!BACKCHANNEL.test(token)) {
      return false;
    }
    if (token === "tal") {
      return cleanToken(words[index + 1] && words[index + 1].text) === "cual";
    }
    if (token === "cual") {
      return cleanToken(words[index - 1] && words[index - 1].text) === "tal";
    }
    return true;
  }

  function cleanBackchannels(words) {
    var normalized = normalizeWords(words);
    return normalized.filter(function (word, index) {
      if (!isBackchannelAtEdge(normalized, index)) {
        return true;
      }
      var previous = normalized[index - 1];
      var next = normalized[index + 1];
      var previousSpeaker = String(previous && (previous.speaker || previous.speakerLabel) || "");
      var currentSpeaker = String(word.speaker || word.speakerLabel || "");
      var nextSpeaker = String(next && (next.speaker || next.speakerLabel) || "");
      var betweenSameSpeaker = previous && next && previousSpeaker && nextSpeaker &&
        previousSpeaker === nextSpeaker && currentSpeaker && currentSpeaker !== previousSpeaker;
      var detachedByTiming = (previous && word.start - previous.end >= 0.08) ||
        (next && next.start - word.end >= 0.08);
      var attachedAfterSentence = previous && TERMINAL.test(previous.text);
      var speakerChanged = (previousSpeaker && currentSpeaker && previousSpeaker !== currentSpeaker) ||
        (nextSpeaker && currentSpeaker && nextSpeaker !== currentSpeaker) || betweenSameSpeaker;
      return !(detachedByTiming || attachedAfterSentence || speakerChanged);
    });
  }

  function captionize(words, options) {
    options = options || {};
    var perLine = clampInt(options.wordsPerLine, 1, 20, 6);
    var lineCount = clampInt(options.lines, 1, 3, 2);
    var requestedChars = parseInt(options.maxCharsPerLine, 10);
    var maxChars = isFinite(requestedChars) && requestedChars > 0 ? Math.max(12, requestedChars) : 0;
    var captions = [];
    var currentGroup = [];
    var hardBoundaries = normalizeBoundaries(options.hardBoundaries);
    var softBoundaries = normalizeBoundaries(options.softBoundaries);
    var normalized = options.cleanBackchannels ? cleanBackchannels(words) : normalizeWords(words);
    var capacity = perLine * lineCount;

    function balancedWrap(items) {
      for (var requestedLines = 1; requestedLines <= lineCount; requestedLines++) {
        var memo = {};
        var targetWords = items.length / requestedLines;
        var targetChars = joinWords(items).length / requestedLines;

        function solve(position, linesLeft) {
          var key = position + ":" + linesLeft;
          if (memo[key]) { return memo[key]; }
          if (!linesLeft) {
            return position === items.length ? { cost: 0, lines: [] } : null;
          }
          var remaining = items.length - position;
          if (remaining < linesLeft || remaining > linesLeft * perLine) { return null; }
          var best = null;
          var maximumEnd = Math.min(items.length - (linesLeft - 1), position + perLine);
          for (var end = maximumEnd; end > position; end--) {
            var line = items.slice(position, end);
            var text = joinWords(line);
            if (maxChars && text.length > maxChars) { continue; }
            var tail = solve(end, linesLeft - 1);
            if (!tail) { continue; }
            var wordDifference = line.length - targetWords;
            var charDifference = text.length - targetChars;
            var cost = tail.cost + wordDifference * wordDifference + charDifference * charDifference * 0.01;
            if (!best || cost < best.cost - 0.0001) {
              best = { cost: cost, lines: [line].concat(tail.lines) };
            }
          }
          memo[key] = best;
          return best;
        }

        var result = solve(0, requestedLines);
        if (result) { return result.lines; }
      }
      return null;
    }

    function boundaryReward(items, nextWord) {
      if (!nextWord || !items.length) { return 0; }
      var last = items[items.length - 1];
      var gap = Math.max(0, nextWord.start - last.end);
      var reward = 0;
      if (TERMINAL.test(last.text)) { reward -= 28; }
      else if (/[,;:]$/.test(last.text)) { reward -= 10; }
      if (gap >= 0.6) { reward -= 24; }
      else if (gap >= 0.25) { reward -= 9; }
      var softBoundary = boundaryBetween(softBoundaries, wordMiddle(last), wordMiddle(nextWord));
      if (isFinite(softBoundary) && (TERMINAL.test(last.text) || gap >= 0.12)) { reward -= 18; }
      return reward;
    }

    function segmentCost(items, nextWord) {
      var unused = capacity - items.length;
      var cost = unused * unused + 4;
      var duration = Math.max(0.04, items[items.length - 1].end - items[0].start);
      var visibleCharacters = joinWords(items).length;
      var cps = visibleCharacters / duration;
      if (items.length === 1) { cost += 520; }
      else if (items.length === 2) { cost += 85; }
      if (duration < 0.8) { cost += (0.8 - duration) * 180; }
      if (cps > 20) { cost += (cps - 20) * (cps - 20) * 0.25; }
      if (nextWord && CONNECTOR.test(cleanToken(items[items.length - 1].text))) { cost += 95; }
      return cost + boundaryReward(items, nextWord);
    }

    function appendCaption(items, endLimit) {
      var wrapped = balancedWrap(items);
      if (!wrapped) { return; }
      var captionEnd = Math.max(items[items.length - 1].end, items[0].start + 0.1);
      if (isFinite(endLimit)) {
        captionEnd = Math.min(captionEnd, Number(endLimit));
      }
      var confidenceTotal = items.reduce(function (total, word) { return total + Number(word.confidence || 0); }, 0);
      captions.push({
        start: items[0].start,
        end: Math.max(captionEnd, items[0].start + 0.04),
        text: wrapped.map(joinWords).join("\n"),
        speaker: items[0].speaker,
        speakerLabel: items[0].speakerLabel,
        confidence: items.length ? confidenceTotal / items.length : 0,
        words: items.slice()
      });
    }

    function flushGroup(endLimit) {
      if (!currentGroup.length) { return; }
      var count = currentGroup.length;
      var best = new Array(count + 1);
      best[count] = { cost: 0, next: count };
      for (var start = count - 1; start >= 0; start--) {
        var bestChoice = null;
        var maximumEnd = Math.min(count, start + capacity);
        for (var end = start + 1; end <= maximumEnd; end++) {
          var items = currentGroup.slice(start, end);
          if (!balancedWrap(items)) { break; }
          if (!best[end]) { continue; }
          var cost = segmentCost(items, end < count ? currentGroup[end] : null) + best[end].cost;
          if (!bestChoice || cost <= bestChoice.cost + 0.0001) {
            bestChoice = { cost: cost, next: end };
          }
        }
        best[start] = bestChoice;
      }
      var position = 0;
      while (position < count && best[position]) {
        var next = best[position].next;
        appendCaption(currentGroup.slice(position, next), next === count ? endLimit : NaN);
        position = next;
      }
      currentGroup = [];
    }

    normalized.forEach(function (word) {
      var previous = currentGroup[currentGroup.length - 1];
      var previousSpeaker = previous && String(previous.speaker || previous.speakerLabel || "");
      var currentSpeaker = String(word.speaker || word.speakerLabel || "");
      var speakerChanged = previous && previousSpeaker && currentSpeaker &&
        !/^(UU|UNKNOWN)$/i.test(previousSpeaker) && !/^(UU|UNKNOWN)$/i.test(currentSpeaker) &&
        previousSpeaker !== currentSpeaker;
      var providerBoundary = previous && (previous.boundaryAfter || previous.sentenceEnd || word.boundaryBefore ||
        (previous.utteranceId && word.utteranceId && previous.utteranceId !== word.utteranceId));
      var hardBoundary = previous ? boundaryBetween(hardBoundaries, wordMiddle(previous), wordMiddle(word)) : NaN;
      var softBoundary = previous ? boundaryBetween(softBoundaries, wordMiddle(previous), wordMiddle(word)) : NaN;
      var naturalBreak = previous && (TERMINAL.test(previous.text) || word.start - previous.end >= 0.12);
      var longPause = previous && word.start - previous.end >= LONG_PAUSE_SECONDS;
      if (previous && (speakerChanged || providerBoundary || isFinite(hardBoundary) ||
        (isFinite(softBoundary) && naturalBreak) || longPause)) {
        if (isFinite(hardBoundary)) {
          previous.end = Math.min(previous.end, hardBoundary);
          word.start = Math.max(word.start, hardBoundary);
        }
        flushGroup(hardBoundary);
      }
      currentGroup.push(word);
    });
    flushGroup();
    return captions;
  }

  function normalizeBoundaries(values) {
    var seen = {};
    return (values || []).map(Number).filter(function (value) {
      if (!isFinite(value) || value <= 0) { return false; }
      var key = Math.round(value * 1000);
      if (seen[key]) { return false; }
      seen[key] = true;
      return true;
    }).sort(function (a, b) { return a - b; });
  }

  function wordMiddle(word) {
    return (Number(word.start) + Number(word.end)) / 2;
  }

  function boundaryBetween(boundaries, start, end) {
    for (var index = 0; index < boundaries.length; index++) {
      if (boundaries[index] > start + 0.002 && boundaries[index] <= end + 0.002) {
        return boundaries[index];
      }
    }
    return NaN;
  }

  function parseTime(value) {
    var match = String(value || "").trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/);
    if (!match) {
      return NaN;
    }
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  }

  function parseSrt(value) {
    var source = String(value || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!source) {
      return [];
    }
    return source.split(/\n{2,}/).map(function (block) {
      var lines = block.split("\n");
      var timingIndex = lines[0] && lines[0].indexOf("-->") >= 0 ? 0 : 1;
      var timing = String(lines[timingIndex] || "").match(/^\s*(\d+:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d{3})/);
      if (!timing) {
        return null;
      }
      var start = parseTime(timing[1]);
      var end = parseTime(timing[2]);
      var text = lines.slice(timingIndex + 1).join(" ").replace(/\s+/g, " ").trim();
      if (!text || !isFinite(start) || !isFinite(end) || end <= start) {
        return null;
      }
      return { start: start, end: end, text: text };
    }).filter(Boolean);
  }

  function captionsToWords(captions) {
    var words = [];
    (captions || []).forEach(function (caption) {
      words = words.concat(distributeText(
        String(caption.text || "").replace(/\s*\n\s*/g, " "),
        caption.start,
        caption.end,
        1,
        caption.speaker || ""
      ));
    });
    return words;
  }

  function sequenceDuration(sequence) {
    var declared = Number(sequence && sequence.duration);
    var clips = (sequence && sequence.clips) || [];
    var clipEnd = clips.reduce(function (maximum, clip) {
      return Math.max(maximum, Number(clip.end) || 0);
    }, 0);
    return Math.max(isFinite(declared) ? declared : 0, clipEnd);
  }

  function primaryClips(sequence, requestedType) {
    var groups = {};
    (sequence.clips || []).forEach(function (clip) {
      if (clip.disabled || clip.adjustmentLayer || !(Number(clip.end) > Number(clip.start))) {
        return;
      }
      var type = String(clip.trackType || "video").toLowerCase();
      var key = type + ":" + String(clip.trackIndex || 0);
      if (!groups[key]) {
        groups[key] = { type: type, clips: [] };
      }
      groups[key].clips.push(clip);
    });

    var candidates = Object.keys(groups).map(function (key) {
      var group = groups[key];
      var ordered = group.clips.slice().sort(function (a, b) { return Number(a.start) - Number(b.start); });
      var coverage = 0;
      var cursor = -Infinity;
      ordered.forEach(function (clip) {
        var start = Number(clip.start);
        var end = Number(clip.end);
        if (end > cursor) {
          coverage += end - Math.max(start, cursor);
          cursor = end;
        }
      });
      return { type: group.type, clips: ordered, coverage: coverage };
    });
    var requested = String(requestedType || "").toLowerCase();
    var matching = requested ? candidates.filter(function (candidate) { return candidate.type === requested; }) : [];
    var videos = candidates.filter(function (candidate) { return candidate.type === "video"; });
    var pool = requested ? matching : (videos.length ? videos : candidates);
    pool.sort(function (a, b) { return b.coverage - a.coverage; });
    return pool.length ? pool[0].clips : [];
  }

  function sourceKey(clip) {
    var mediaPath = platform.fileKey(clip.mediaPath);
    var projectItemId = String(clip.projectItemId || "");
    return projectItemId ? "item:" + projectItemId : (mediaPath ? "media:" + mediaPath : "item:");
  }

  function overlapCoverage(segments, start, end) {
    return (segments || []).reduce(function (total, segment) {
      var overlapStart = Math.max(Number(segment.timelineStart), Number(start));
      var overlapEnd = Math.min(Number(segment.timelineEnd), Number(end));
      return total + Math.max(0, overlapEnd - overlapStart);
    }, 0);
  }

  function nestedSourceWindow(child, segments, inPoint, outPoint) {
    var zeroPoint = Number(child && child.zeroPointSeconds);
    var candidates = [{ start: inPoint, end: outPoint, priority: 0 }];
    if (isFinite(zeroPoint) && Math.abs(zeroPoint) > 0.000001) {
      candidates.push({ start: inPoint - zeroPoint, end: outPoint - zeroPoint, priority: 1 });
      candidates.push({ start: inPoint + zeroPoint, end: outPoint + zeroPoint, priority: 2 });
    }
    candidates.forEach(function (candidate) {
      candidate.coverage = overlapCoverage(segments, candidate.start, candidate.end);
    });
    candidates.sort(function (a, b) {
      if (b.coverage !== a.coverage) { return b.coverage - a.coverage; }
      return a.priority - b.priority;
    });
    return candidates[0];
  }

  function flattenSequence(context, sequenceId, stack, requestedType) {
    var sequences = (context && context.sequences) || [];
    var byId = {};
    var byProjectItem = {};
    sequences.forEach(function (sequence) {
      byId[String(sequence.id)] = sequence;
      if (sequence.projectItemId) {
        byProjectItem[String(sequence.projectItemId)] = sequence;
      }
    });
    var sequence = byId[String(sequenceId)];
    if (!sequence) {
      return [];
    }
    var visited = (stack || []).concat(String(sequenceId));
    var segments = [];

    primaryClips(sequence, requestedType).forEach(function (clip, clipIndex) {
      var start = Number(clip.start);
      var end = Number(clip.end);
      var inPoint = Number(clip.inPoint);
      var outPoint = Number(clip.outPoint);
      if (!isFinite(inPoint)) { inPoint = 0; }
      if (!isFinite(outPoint) || outPoint <= inPoint) {
        outPoint = inPoint + (end - start) * (Number(clip.speed) || 1);
      }
      var child = byProjectItem[String(clip.projectItemId || "")];
      if (child && visited.indexOf(String(child.id)) < 0) {
        var childSegments = flattenSequence(context, child.id, visited, requestedType);
        var sourceWindow = nestedSourceWindow(child, childSegments, inPoint, outPoint);
        inPoint = sourceWindow.start;
        outPoint = sourceWindow.end;
        var parentScale = (end - start) / Math.max(0.001, outPoint - inPoint);
        childSegments.forEach(function (segment) {
          var overlapStart = Math.max(segment.timelineStart, inPoint);
          var overlapEnd = Math.min(segment.timelineEnd, outPoint);
          if (overlapEnd <= overlapStart) {
            return;
          }
          segments.push({
            sourceKey: segment.sourceKey,
            editSegmentId: String(sequenceId) + ":" + String(clip.trackType) + ":" + String(clip.trackIndex) + ":" + String(clipIndex) + ":" + segment.editSegmentId,
            timelineStart: start + (overlapStart - inPoint) * parentScale,
            timelineEnd: start + (overlapEnd - inPoint) * parentScale,
            sourceStart: timelineToSource(segment, overlapStart),
            sourceEnd: timelineToSource(segment, overlapEnd)
          });
        });
        return;
      }

      var key = sourceKey(clip);
      if (key !== "item:") {
        segments.push({
          sourceKey: key,
          editSegmentId: String(sequenceId) + ":" + String(clip.trackType) + ":" + String(clip.trackIndex) + ":" + String(clipIndex),
          timelineStart: start,
          timelineEnd: end,
          sourceStart: clip.reversed ? outPoint : inPoint,
          sourceEnd: clip.reversed ? inPoint : outPoint
        });
      }
    });
    return segments;
  }

  function timelineEditBoundaries(context, sequenceId) {
    var targetId = String(sequenceId || (context && context.activeSequenceId) || "");
    var sequences = (context && context.sequences) || [];
    var sequence = sequences.filter(function (candidate) { return String(candidate.id) === targetId; })[0];
    if (!sequence) {
      return { hard: [], soft: [] };
    }
    var duration = sequenceDuration(sequence);
    function segmentEdges(type) {
      var edges = [];
      flattenSequence(context, targetId, [], type).forEach(function (segment) {
        [segment.timelineStart, segment.timelineEnd].forEach(function (value) {
          value = Number(value);
          if (isFinite(value) && value > 0.002 && value < duration - 0.002) {
            edges.push(value);
          }
        });
      });
      return normalizeBoundaries(edges);
    }
    return {
      hard: segmentEdges("audio"),
      soft: segmentEdges("video")
    };
  }

  function timelineToSource(segment, timelineTime) {
    var ratio = (Number(timelineTime) - segment.timelineStart) /
      Math.max(0.001, segment.timelineEnd - segment.timelineStart);
    return segment.sourceStart + ratio * (segment.sourceEnd - segment.sourceStart);
  }

  function sourceToTimeline(segment, sourceTime) {
    var sourceSpan = segment.sourceEnd - segment.sourceStart;
    if (Math.abs(sourceSpan) < 0.001) {
      return segment.timelineStart;
    }
    return segment.timelineStart + ((Number(sourceTime) - segment.sourceStart) / sourceSpan) *
      (segment.timelineEnd - segment.timelineStart);
  }

  function containsTime(a, b, value) {
    return Number(value) >= Math.min(a, b) - 0.002 && Number(value) <= Math.max(a, b) + 0.002;
  }

  function anchorWordsToSource(words, context, sourceSequenceId) {
    var segments = flattenSequence(context, sourceSequenceId);
    return normalizeWords(words).map(function (word) {
      if (word.sourceKey && isFinite(word.sourceStart) && isFinite(word.sourceEnd)) {
        return word;
      }
      var middle = (word.start + word.end) / 2;
      var origin = segments.filter(function (segment) {
        return containsTime(segment.timelineStart, segment.timelineEnd, middle);
      })[0];
      if (!origin) {
        return word;
      }
      word.sourceKey = origin.sourceKey;
      word.sourceStart = timelineToSource(origin, Math.max(origin.timelineStart, Math.min(origin.timelineEnd, word.start)));
      word.sourceEnd = timelineToSource(origin, Math.max(origin.timelineStart, Math.min(origin.timelineEnd, word.end)));
      return word;
    });
  }

  function inferSourceSequence(words, context, preferredId) {
    var sequences = (context && context.sequences) || [];
    var preferred = sequences.filter(function (sequence) { return String(sequence.id) === String(preferredId || ""); })[0];
    if (preferred) {
      return preferred;
    }
    var normalized = normalizeWords(words);
    var transcriptEnd = normalized.reduce(function (maximum, word) { return Math.max(maximum, word.end); }, 0);
    var ranked = sequences.map(function (sequence) {
      return { sequence: sequence, difference: Math.abs(sequenceDuration(sequence) - transcriptEnd) };
    }).sort(function (a, b) { return a.difference - b.difference; });
    if (!ranked.length || ranked[0].difference > Math.max(30, transcriptEnd * 0.05)) {
      return null;
    }
    return ranked[0].sequence;
  }

  function suggestedMaxCharsPerLine(width, height) {
    var frameWidth = Number(width);
    var frameHeight = Number(height);
    if (!isFinite(frameWidth) || !isFinite(frameHeight) || frameWidth <= 0 || frameHeight <= 0) {
      return 0;
    }
    if (frameHeight > frameWidth) {
      return 28;
    }
    return 0;
  }

  function mapWordsToSequence(words, context, preferredSourceId) {
    var sourceSequence = inferSourceSequence(words, context, preferredSourceId);
    var targetId = String(context && context.activeSequenceId || "");
    if (!sourceSequence || !targetId) {
      return { words: [], sourceSequenceId: "", sourceSequenceName: "", targetSequenceName: "" };
    }
    var targetSequence = ((context && context.sequences) || []).filter(function (sequence) {
      return String(sequence.id) === targetId;
    })[0];
    if (!targetSequence) {
      return { words: [], sourceSequenceId: String(sourceSequence.id), sourceSequenceName: sourceSequence.name || "", targetSequenceName: "" };
    }
    if (String(sourceSequence.id) === targetId) {
      return {
        words: normalizeWords(words),
        sourceSequenceId: String(sourceSequence.id),
        sourceSequenceName: sourceSequence.name || "",
        targetSequenceName: targetSequence.name || ""
      };
    }

    var targetSegments = flattenSequence(context, targetSequence.id);
    var output = [];
    var seen = {};
    anchorWordsToSource(words, context, sourceSequence.id).forEach(function (word, wordIndex) {
      if (!word.sourceKey || !isFinite(word.sourceStart) || !isFinite(word.sourceEnd)) {
        return;
      }
      var sourceMiddle = (word.sourceStart + word.sourceEnd) / 2;
      targetSegments.forEach(function (target) {
          if (target.sourceKey !== word.sourceKey || !containsTime(target.sourceStart, target.sourceEnd, sourceMiddle)) {
            return;
          }
          var mappedStart = sourceToTimeline(target, word.sourceStart);
          var mappedEnd = sourceToTimeline(target, word.sourceEnd);
          var start = Math.max(target.timelineStart, Math.min(mappedStart, mappedEnd));
          var end = Math.min(target.timelineEnd, Math.max(mappedStart, mappedEnd));
          if (end <= start) {
            end = Math.min(target.timelineEnd, start + 0.1);
          }
          var dedupeKey = wordIndex + ":" + Math.round(start * 1000);
          if (!seen[dedupeKey] && end > start) {
            seen[dedupeKey] = true;
            output.push({
              text: word.text,
              start: start,
              end: end,
              confidence: word.confidence,
              speaker: word.speaker,
              speakerLabel: word.speakerLabel,
              utteranceId: word.utteranceId,
              boundaryBefore: word.boundaryBefore,
              boundaryAfter: word.boundaryAfter,
              sentenceEnd: word.sentenceEnd,
              editSegmentId: target.editSegmentId,
              sourceKey: word.sourceKey,
              sourceStart: word.sourceStart,
              sourceEnd: word.sourceEnd
            });
          }
      });
    });
    output.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return {
      words: output,
      sourceSequenceId: String(sourceSequence.id),
      sourceSequenceName: sourceSequence.name || "",
      targetSequenceName: targetSequence.name || ""
    };
  }

  function labelSpeakers(words, names) {
    return applySpeakerMap(words, createSpeakerMap(words, names));
  }

  function createSpeakerMap(words, names) {
    var requestedNames = parseSpeakerNames(names);
    var ids = [];
    normalizeWords(words).forEach(function (word) {
      var raw = String(word.speaker || "").trim();
      if (raw && !/^(UU|UNKNOWN)$/i.test(raw) && ids.indexOf(raw) < 0) {
        ids.push(raw);
      }
    });
    var count = Math.max(ids.length, requestedNames.length);
    if (!count && names != null) {
      count = 1;
    }
    var speakers = [];
    for (var index = 0; index < count; index++) {
      var id = ids[index] || ("manual:" + (index + 1));
      var identifiedName = requestedNames.filter(function (name) {
        return name.toLowerCase() === String(id).toLowerCase();
      })[0];
      speakers.push({
        id: id,
        label: "Speaker " + (index + 1),
        name: identifiedName || requestedNames[index] || ""
      });
    }
    return speakers;
  }

  function applySpeakerMap(words, speakers) {
    var normalized = normalizeWords(words);
    var map = {};
    (speakers || []).forEach(function (speaker, index) {
      map[String(speaker.id)] = String(speaker.name || speaker.label || ("Speaker " + (index + 1)));
    });
    return normalized.map(function (word) {
      var raw = String(word.speaker || "").trim();
      word.speakerLabel = map[raw] || "";
      return word;
    });
  }

  function parseSpeakerNames(names) {
    var values = names instanceof Array ? names : String(names || "").split(",");
    return values.map(function (name) { return String(name).trim(); }).filter(Boolean);
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
    parseTime: parseTime,
    parseSrt: parseSrt,
    captionsToWords: captionsToWords,
    sequenceDuration: sequenceDuration,
    primaryClips: primaryClips,
    flattenSequence: flattenSequence,
    timelineEditBoundaries: timelineEditBoundaries,
    anchorWordsToSource: anchorWordsToSource,
    inferSourceSequence: inferSourceSequence,
    mapWordsToSequence: mapWordsToSequence,
    suggestedMaxCharsPerLine: suggestedMaxCharsPerLine,
    normalizeWords: normalizeWords,
    labelSpeakers: labelSpeakers,
    createSpeakerMap: createSpeakerMap,
    applySpeakerMap: applySpeakerMap,
    parseSpeakerNames: parseSpeakerNames,
    attachPunctuation: attachPunctuation,
    captionize: captionize,
    toSrt: toSrt,
    formatTime: formatTime,
    joinWords: joinWords
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.LaSubtituletaTranscript = api;
})(typeof window === "undefined" ? globalThis : window);

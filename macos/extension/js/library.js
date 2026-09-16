(function (root) {
  "use strict";

  var fs = require("fs");
  var platform = root.LaSubtituletaPlatform || require("./platform.js");
  var path = require("path");
  var transcript = root.LaSubtituletaTranscript || (typeof module !== "undefined" ? require("./transcript.js") : null);

  function appDataRoot() {
    return platform.appDataRoot();
  }

  function normalizeProjectPath(value) {
    return platform.fileKey(value);
  }

  function hashText(value) {
    var hash = 2166136261;
    var text = String(value || "");
    for (var index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  function safePart(value) {
    return String(value || "proyecto")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "proyecto";
  }

  function projectDirectory(projectPath) {
    var normalized = normalizeProjectPath(projectPath);
    var name = safePart(path.basename(String(projectPath || "proyecto")));
    return path.join(appDataRoot(), "projects", name + "-" + hashText(normalized));
  }

  function indexPath(projectPath) {
    return path.join(projectDirectory(projectPath), "index.json");
  }

  function readJson(filePath) {
    try {
      return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
    } catch (_error) {
      return null;
    }
  }

  function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  }

  function transcriptId(data) {
    if (data.libraryId) { return safePart(data.libraryId); }
    var identity = [
      data.sourceSequenceId || data.sourceSequenceName || "secuencia",
      data.createdAt || new Date().toISOString(),
      data.model || "modelo"
    ].join("|");
    return safePart(data.sourceSequenceName || "secuencia") + "-" + hashText(identity);
  }

  function saveTranscript(data) {
    if (!data || !data.projectPath || !data.words || !data.words.length) { return ""; }
    var directory = projectDirectory(data.projectPath);
    var id = transcriptId(data);
    data.libraryId = id;
    var relativeFile = path.join("transcripts", id + ".json");
    var transcriptPath = path.join(directory, relativeFile);
    writeJson(transcriptPath, data);

    var filePath = indexPath(data.projectPath);
    var registry = readJson(filePath) || {
      version: 1,
      projectPath: data.projectPath,
      projectFileName: path.basename(data.projectPath),
      entries: []
    };
    registry.projectPath = data.projectPath;
    registry.projectFileName = path.basename(data.projectPath);
    registry.updatedAt = new Date().toISOString();
    registry.entries = (registry.entries || []).filter(function (entry) { return entry.id !== id; });
    registry.entries.push({
      id: id,
      file: relativeFile.replace(/\\/g, "/"),
      createdAt: data.createdAt || "",
      model: data.model || "",
      sourceSequenceId: data.sourceSequenceId || "",
      sourceSequenceName: data.sourceSequenceName || "",
      outputFolder: data.outputFolder || "",
      outputBaseName: data.outputBaseName || ""
    });
    writeJson(filePath, registry);
    return transcriptPath;
  }

  function registryDirectories(projectPath) {
    var exact = projectDirectory(projectPath);
    var directories = [exact];
    var projectsRoot = path.join(appDataRoot(), "projects");
    if (!fs.existsSync(projectsRoot)) { return directories; }
    var currentFileName = path.basename(String(projectPath || "")).toLowerCase();
    fs.readdirSync(projectsRoot).forEach(function (name) {
      var directory = path.join(projectsRoot, name);
      if (directory === exact) { return; }
      var registry = readJson(path.join(directory, "index.json"));
      if (registry && String(registry.projectFileName || "").toLowerCase() === currentFileName) {
        directories.push(directory);
      }
    });
    return directories;
  }

  function loadProjectTranscripts(projectPath) {
    var output = [];
    var seen = {};
    registryDirectories(projectPath).forEach(function (directory) {
      var registry = readJson(path.join(directory, "index.json"));
      (registry && registry.entries || []).forEach(function (entry) {
        var filePath = path.join(directory, String(entry.file || "").replace(/\//g, path.sep));
        var data = readJson(filePath);
        var key = data && (data.libraryId || entry.id);
        if (data && data.words && data.words.length && !seen[key]) {
          seen[key] = true;
          output.push(data);
        }
      });
    });
    return output;
  }

  function contextWithSnapshot(context, data) {
    var sequences = (context && context.sequences || []).slice();
    var sourceId = String(data.sourceSequenceId || "");
    var activeId = String(context && context.activeSequenceId || "");
    if (data.sourceSequenceSnapshot && sourceId !== activeId) {
      var currentSource = sequences.filter(function (sequence) { return String(sequence.id) === sourceId; })[0];
      var sourceSnapshot = {};
      Object.keys(data.sourceSequenceSnapshot).forEach(function (key) {
        sourceSnapshot[key] = data.sourceSequenceSnapshot[key];
      });
      if (currentSource && currentSource.zeroPointSeconds != null) {
        sourceSnapshot.zeroPointSeconds = currentSource.zeroPointSeconds;
        sourceSnapshot.zeroPointTicks = currentSource.zeroPointTicks;
      }
      sequences = sequences.filter(function (sequence) { return String(sequence.id) !== sourceId; });
      sequences.push(sourceSnapshot);
    } else if (!sequences.some(function (sequence) { return String(sequence.id) === sourceId; }) && data.sourceSequenceSnapshot) {
      sequences.push(data.sourceSequenceSnapshot);
    }
    return {
      activeSequenceId: context.activeSequenceId,
      projectPath: context.projectPath,
      sequences: sequences
    };
  }

  function clipFingerprint(clip) {
    if (!clip) { return ""; }
    var media = String(clip.mediaPath || clip.projectItemId || clip.name || "");
    return [
      clip.trackType || "",
      Number(clip.trackIndex || 0),
      platform.fileKey(media),
      Math.round(Number(clip.inPoint || 0) * 100),
      Math.round(Number(clip.outPoint || 0) * 100)
    ].join("|");
  }

  function sequenceFootprint(sequence) {
    return ((sequence && sequence.clips) || [])
      .filter(function (clip) { return !clip.disabled && (clip.trackType === "audio" || clip.trackType === "video"); })
      .map(clipFingerprint)
      .sort();
  }

  function sequenceSnapshotsMatch(savedSequence, currentSequence) {
    var saved = sequenceFootprint(savedSequence);
    var current = sequenceFootprint(currentSequence);
    if (!saved.length || !current.length) { return true; }
    if (saved.length !== current.length) { return false; }
    for (var index = 0; index < saved.length; index += 1) {
      if (saved[index] !== current[index]) { return false; }
    }
    return true;
  }

  function rankTranscripts(context, candidates) {
    var ranked = [];
    var seen = {};
    (candidates || []).forEach(function (data) {
      if (!data || !data.words || !data.words.length) { return; }
      var key = data.libraryId || [data.sourceSequenceId, data.createdAt, data.model, data.words.length].join("|");
      if (seen[key]) { return; }
      seen[key] = true;
      var mappingContext = contextWithSnapshot(context, data);
      data.words = transcript.anchorWordsToSource(data.words, mappingContext, data.sourceSequenceId);
      var mapped = transcript.mapWordsToSequence(data.words, mappingContext, data.sourceSequenceId);
      if (!mapped.words.length) { return; }
      var exact = String(data.sourceSequenceId || "") === String(context.activeSequenceId || "");
      if (exact && data.sourceSequenceSnapshot) {
        var activeSequence = ((context && context.sequences) || []).filter(function (sequence) {
          return String(sequence.id) === String(context.activeSequenceId || "");
        })[0];
        if (activeSequence && !sequenceSnapshotsMatch(data.sourceSequenceSnapshot, activeSequence)) {
          return;
        }
      }
      var first = mapped.words[0];
      var last = mapped.words[mapped.words.length - 1];
      var span = Math.max(0, Number(last.end || 0) - Number(first.start || 0));
      var recoveredPenalty = data.model === "srt-recuperado" ? 10000 : 0;
      var exactBonus = exact && data.model !== "srt-recuperado" ? 5000 : 0;
      ranked.push({
        data: data,
        mapped: mapped,
        wordCount: mapped.words.length,
        score: exactBonus + mapped.words.length * 1000 + span - recoveredPenalty
      });
    });
    ranked.sort(function (a, b) {
      if (b.score !== a.score) { return b.score - a.score; }
      return String(b.data.createdAt || "").localeCompare(String(a.data.createdAt || ""));
    });
    return ranked;
  }

  function normalizedName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9áéíóúüñ]+/g, " ").replace(/^\s+|\s+$/g, "");
  }

  function sequenceForSrt(filePath, words, context) {
    var base = path.basename(filePath, path.extname(filePath));
    var plainBase = base.replace(/-reflow-.*$/i, "").replace(/-\d{2}$/i, "");
    var expected = normalizedName(plainBase);
    var sequences = context && context.sequences || [];
    var named = sequences.filter(function (sequence) {
      return normalizedName(sequence.name) === expected;
    })[0];
    return named || transcript.inferSourceSequence(words, context, "");
  }

  function discoverFolderTranscripts(context, folders) {
    var output = [];
    var seenFiles = {};
    (folders || []).forEach(function (folder) {
      if (!folder || !fs.existsSync(folder)) { return; }
      var stats;
      try { stats = fs.statSync(folder); } catch (_error) { return; }
      if (!stats.isDirectory()) { return; }
      fs.readdirSync(folder).forEach(function (name) {
        var filePath = path.join(folder, name);
        var extension = path.extname(name).toLowerCase();
        if (seenFiles[platform.fileKey(filePath)] || extension !== ".json") { return; }
        seenFiles[platform.fileKey(filePath)] = true;
        if (extension !== ".json") { return; }
        var saved = readJson(filePath);
        if (saved && saved.words && saved.words.length) { output.push(saved); }
      });
    });
    return output;
  }

  var api = {
    appDataRoot: appDataRoot,
    projectDirectory: projectDirectory,
    saveTranscript: saveTranscript,
    loadProjectTranscripts: loadProjectTranscripts,
    rankTranscripts: rankTranscripts,
    discoverFolderTranscripts: discoverFolderTranscripts,
    normalizeProjectPath: normalizeProjectPath
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  root.LaSubtituletaLibrary = api;
})(typeof window === "undefined" ? globalThis : window);

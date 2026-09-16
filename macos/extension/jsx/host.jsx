/* eslint-disable */
if (!$._LaSubtituleta) {
  $._LaSubtituleta = {};
}

$._LaSubtituleta._stringify = function (value) {
  if (value === null || typeof value === "undefined") {
    return "null";
  }
  if (typeof value === "string") {
    return "\"" + value
      .replace(/\\/g, "\\\\")
      .replace(/\"/g, "\\\"")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t") + "\"";
  }
  if (typeof value === "number") {
    return isFinite(value) ? String(value) : "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value instanceof Array) {
    var items = [];
    for (var i = 0; i < value.length; i++) {
      items.push($._LaSubtituleta._stringify(value[i]));
    }
    return "[" + items.join(",") + "]";
  }
  var properties = [];
  for (var key in value) {
    if (value.hasOwnProperty && !value.hasOwnProperty(key)) {
      continue;
    }
    properties.push($._LaSubtituleta._stringify(key) + ":" + $._LaSubtituleta._stringify(value[key]));
  }
  return "{" + properties.join(",") + "}";
};

$._LaSubtituleta._result = function (value) {
  return $._LaSubtituleta._stringify(value);
};

$._LaSubtituleta.exportAudio = function (outputPath, presetPath) {
  try {
    var sequence = app.project.activeSequence;
    if (!sequence) {
      return $._LaSubtituleta._result({ ok: false, error: "No hay una secuencia activa." });
    }
    var preset = new File(presetPath);
    if (!preset.exists) {
      return $._LaSubtituleta._result({ ok: false, error: "No se encontró el preset de audio del plugin." });
    }

    var output = new File(outputPath);
    if (output.exists) {
      output.remove();
    }

    // Render inside Premiere without launching an external encoder process
    // or waiting on a separate job queue.
    var exported = sequence.exportAsMediaDirect(output.fsName, preset.fsName, 0);
    output = new File(outputPath);
    if (!exported || !output.exists || output.length < 1) {
      return $._LaSubtituleta._result({ ok: false, error: "Premiere no pudo preparar el audio de la secuencia." });
    }
    return $._LaSubtituleta._result({ ok: true, outputPath: output.fsName });
  } catch (error) {
    return $._LaSubtituleta._result({ ok: false, error: String(error) });
  }
};

$._LaSubtituleta._findByMediaPath = function (container, mediaPath) {
  if (!container || !container.children) {
    return null;
  }
  var isWindows = /windows/i.test($.os || "");
  var expected = isWindows ? String(mediaPath).toLowerCase() : String(mediaPath);
  for (var i = 0; i < container.children.numItems; i++) {
    var item = container.children[i];
    if (!item) {
      continue;
    }
    try {
      var actual = item.getMediaPath ? String(item.getMediaPath()) : "";
      if (isWindows) { actual = actual.toLowerCase(); }
      if (actual && actual === expected) {
        return item;
      }
    } catch (_error) {}
    var nested = $._LaSubtituleta._findByMediaPath(item, mediaPath);
    if (nested) {
      return nested;
    }
  }
  return null;
};

$._LaSubtituleta.importCaptions = function (srtPath) {
  try {
    var sequence = app.project.activeSequence;
    if (!sequence) {
      return $._LaSubtituleta._result({ ok: false, error: "No hay una secuencia activa." });
    }
    var srtFile = new File(srtPath);
    if (!srtFile.exists) {
      return $._LaSubtituleta._result({ ok: false, error: "No se encontró el archivo SRT generado." });
    }
    var destination = app.project.getInsertionBin() || app.project.rootItem;
    var imported = app.project.importFiles([srtFile.fsName], true, destination, false);
    if (!imported) {
      return $._LaSubtituleta._result({ ok: false, error: "Premiere no pudo importar el SRT." });
    }
    var projectItem = $._LaSubtituleta._findByMediaPath(destination, srtFile.fsName);
    if (!projectItem) {
      projectItem = $._LaSubtituleta._findByMediaPath(app.project.rootItem, srtFile.fsName);
    }
    if (!projectItem) {
      return $._LaSubtituleta._result({ ok: false, error: "Premiere importó el SRT, pero no se pudo localizar en el proyecto." });
    }
    var created = sequence.createCaptionTrack(projectItem, 0);
    if (!created) {
      return $._LaSubtituleta._result({ ok: false, error: "No se pudo crear la pista de subtítulos." });
    }
    return $._LaSubtituleta._result({ ok: true, srtPath: srtFile.fsName });
  } catch (error) {
    return $._LaSubtituleta._result({ ok: false, error: String(error) });
  }
};

$._LaSubtituleta._timeSeconds = function (value) {
  try {
    if (value && typeof value.seconds !== "undefined") {
      return Number(value.seconds) || 0;
    }
    return Number(value) || 0;
  } catch (_error) {
    return 0;
  }
};

$._LaSubtituleta._clipInfo = function (clip, trackType, trackIndex) {
  var projectItem = null;
  var mediaPath = "";
  var projectItemId = "";
  var speed = 1;
  var reversed = false;
  var adjustmentLayer = false;
  var disabled = false;
  try { projectItem = clip.projectItem; } catch (_error1) {}
  try { projectItemId = projectItem ? String(projectItem.nodeId || "") : ""; } catch (_error2) {}
  try { mediaPath = projectItem && projectItem.getMediaPath ? String(projectItem.getMediaPath() || "") : ""; } catch (_error3) {}
  try { speed = clip.getSpeed ? Number(clip.getSpeed()) || 1 : 1; } catch (_error4) {}
  try { reversed = clip.isSpeedReversed ? Boolean(clip.isSpeedReversed()) : false; } catch (_error5) {}
  try { adjustmentLayer = clip.isAdjustmentLayer ? Boolean(clip.isAdjustmentLayer()) : false; } catch (_error6) {}
  try { disabled = Boolean(clip.disabled); } catch (_error7) {}
  return {
    trackType: trackType,
    trackIndex: trackIndex,
    start: $._LaSubtituleta._timeSeconds(clip.start),
    end: $._LaSubtituleta._timeSeconds(clip.end),
    inPoint: $._LaSubtituleta._timeSeconds(clip.inPoint),
    outPoint: $._LaSubtituleta._timeSeconds(clip.outPoint),
    speed: speed,
    reversed: reversed,
    adjustmentLayer: adjustmentLayer,
    disabled: disabled,
    projectItemId: projectItemId,
    mediaPath: mediaPath,
    name: String(clip.name || (projectItem ? projectItem.name : "") || "")
  };
};

$._LaSubtituleta._sequenceInfo = function (sequence) {
  var clips = [];
  var duration = 0;
  var inPoint = 0;
  var outPoint = 0;
  var zeroPointTicks = "0";
  var zeroPointSeconds = 0;
  var frameRate = 0;
  var trackIndex;
  var clipIndex;
  var clip;
  for (trackIndex = 0; trackIndex < sequence.videoTracks.numTracks; trackIndex++) {
    var videoTrack = sequence.videoTracks[trackIndex];
    for (clipIndex = 0; clipIndex < videoTrack.clips.numItems; clipIndex++) {
      clip = $._LaSubtituleta._clipInfo(videoTrack.clips[clipIndex], "video", trackIndex);
      clips.push(clip);
      duration = Math.max(duration, clip.end);
    }
  }
  for (trackIndex = 0; trackIndex < sequence.audioTracks.numTracks; trackIndex++) {
    var audioTrack = sequence.audioTracks[trackIndex];
    for (clipIndex = 0; clipIndex < audioTrack.clips.numItems; clipIndex++) {
      clip = $._LaSubtituleta._clipInfo(audioTrack.clips[clipIndex], "audio", trackIndex);
      clips.push(clip);
      duration = Math.max(duration, clip.end);
    }
  }
  var projectItemId = "";
  try { projectItemId = sequence.projectItem ? String(sequence.projectItem.nodeId || "") : ""; } catch (_error) {}
  try { inPoint = $._LaSubtituleta._timeSeconds(sequence.getInPoint()); } catch (_error2) {}
  try { outPoint = $._LaSubtituleta._timeSeconds(sequence.getOutPoint()); } catch (_error3) {}
  try {
    zeroPointTicks = String(sequence.zeroPoint || "0");
    zeroPointSeconds = Number(zeroPointTicks) / 254016000000;
    if (!isFinite(zeroPointSeconds)) {
      zeroPointSeconds = 0;
    }
  } catch (_error4) {}
  try {
    var settings = sequence.getSettings();
    var frameTicks = settings && settings.videoFrameRate ? Number(settings.videoFrameRate.ticks) : 0;
    if (frameTicks > 0) {
      frameRate = 254016000000 / frameTicks;
    }
  } catch (_error5) {}
  return {
    id: String(sequence.sequenceID || sequence.id || ""),
    projectItemId: projectItemId,
    name: String(sequence.name || ""),
    duration: duration,
    inPoint: inPoint,
    outPoint: outPoint || duration,
    zeroPointTicks: zeroPointTicks,
    zeroPointSeconds: zeroPointSeconds,
    frameRate: frameRate,
    frameWidth: Number(sequence.frameSizeHorizontal) || 0,
    frameHeight: Number(sequence.frameSizeVertical) || 0,
    clips: clips
  };
};

$._LaSubtituleta.getTimelineContext = function () {
  try {
    var active = app.project.activeSequence;
    if (!active) {
      return $._LaSubtituleta._result({ ok: false, error: "No hay una secuencia activa." });
    }
    var sequences = [];
    for (var index = 0; index < app.project.sequences.numSequences; index++) {
      sequences.push($._LaSubtituleta._sequenceInfo(app.project.sequences[index]));
    }
    return $._LaSubtituleta._result({
      ok: true,
      activeSequenceId: String(active.sequenceID || active.id || ""),
      projectPath: app.project ? app.project.path : "",
      sequences: sequences
    });
  } catch (error) {
    return $._LaSubtituleta._result({ ok: false, error: String(error) });
  }
};

$._LaSubtituleta.getContext = function () {
  try {
    var sequence = app.project.activeSequence;
    return $._LaSubtituleta._result({
      ok: true,
      sequenceId: sequence ? String(sequence.sequenceID || sequence.id || "") : "",
      sequenceName: sequence ? sequence.name : "",
      duration: sequence ? $._LaSubtituleta._sequenceInfo(sequence).duration : 0,
      frameWidth: sequence ? Number(sequence.frameSizeHorizontal) || 0 : 0,
      frameHeight: sequence ? Number(sequence.frameSizeVertical) || 0 : 0,
      projectPath: app.project ? app.project.path : ""
    });
  } catch (error) {
    return $._LaSubtituleta._result({ ok: false, error: String(error) });
  }
};

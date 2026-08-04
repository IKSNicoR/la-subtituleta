/* eslint-disable */
if (!$._Subtitulador) {
  $._Subtitulador = {};
}

$._Subtitulador._result = function (value) {
  return JSON.stringify(value);
};

$._Subtitulador.exportAudio = function (outputPath, presetPath) {
  try {
    var sequence = app.project.activeSequence;
    if (!sequence) {
      return $._Subtitulador._result({ ok: false, error: "No hay una secuencia activa." });
    }
    var preset = new File(presetPath);
    if (!preset.exists) {
      return $._Subtitulador._result({ ok: false, error: "No se encontró el preset de audio del plugin." });
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
      return $._Subtitulador._result({ ok: false, error: "Premiere no pudo preparar el audio de la secuencia." });
    }
    return $._Subtitulador._result({ ok: true, outputPath: output.fsName });
  } catch (error) {
    return $._Subtitulador._result({ ok: false, error: String(error) });
  }
};

$._Subtitulador._findByMediaPath = function (container, mediaPath) {
  if (!container || !container.children) {
    return null;
  }
  var expected = String(mediaPath).toLowerCase();
  for (var i = 0; i < container.children.numItems; i++) {
    var item = container.children[i];
    if (!item) {
      continue;
    }
    try {
      if (item.getMediaPath && String(item.getMediaPath()).toLowerCase() === expected) {
        return item;
      }
    } catch (_error) {}
    var nested = $._Subtitulador._findByMediaPath(item, mediaPath);
    if (nested) {
      return nested;
    }
  }
  return null;
};

$._Subtitulador.importCaptions = function (srtPath) {
  try {
    var sequence = app.project.activeSequence;
    if (!sequence) {
      return $._Subtitulador._result({ ok: false, error: "No hay una secuencia activa." });
    }
    var srtFile = new File(srtPath);
    if (!srtFile.exists) {
      return $._Subtitulador._result({ ok: false, error: "No se encontró el archivo SRT generado." });
    }
    var destination = app.project.getInsertionBin() || app.project.rootItem;
    var imported = app.project.importFiles([srtFile.fsName], true, destination, false);
    if (!imported) {
      return $._Subtitulador._result({ ok: false, error: "Premiere no pudo importar el SRT." });
    }
    var projectItem = $._Subtitulador._findByMediaPath(destination, srtFile.fsName);
    if (!projectItem) {
      projectItem = $._Subtitulador._findByMediaPath(app.project.rootItem, srtFile.fsName);
    }
    if (!projectItem) {
      return $._Subtitulador._result({ ok: false, error: "Premiere importó el SRT, pero no se pudo localizar en el proyecto." });
    }
    var created = sequence.createCaptionTrack(projectItem, 0);
    if (!created) {
      return $._Subtitulador._result({ ok: false, error: "No se pudo crear la pista de subtítulos." });
    }
    return $._Subtitulador._result({ ok: true, srtPath: srtFile.fsName });
  } catch (error) {
    return $._Subtitulador._result({ ok: false, error: String(error) });
  }
};

$._Subtitulador.getContext = function () {
  try {
    var sequence = app.project.activeSequence;
    return $._Subtitulador._result({
      ok: true,
      sequenceName: sequence ? sequence.name : "",
      projectPath: app.project ? app.project.path : ""
    });
  } catch (error) {
    return $._Subtitulador._result({ ok: false, error: String(error) });
  }
};

(function (root) {
  "use strict";

  function getExtensionPath() {
    if (!root.__adobe_cep__) {
      return "";
    }
    return root.LaSubtituletaPlatform.pathFromCep(root.__adobe_cep__.getSystemPath("extension"));
  }

  function invokeHost(method, args) {
    return new Promise(function (resolve, reject) {
      if (!root.__adobe_cep__) {
        reject(new Error("Este panel debe ejecutarse dentro de Premiere Pro."));
        return;
      }
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(method)) {
        reject(new Error("Operación interna no válida."));
        return;
      }

      var hostPath = getExtensionPath().replace(/\\/g, "/") + "/jsx/host.jsx";
      var serialized = (args || []).map(function (value) {
        return JSON.stringify(value);
      }).join(",");
      var command = [
        "(function () {",
        "try {",
        "$.evalFile(" + JSON.stringify(hostPath) + ");",
        "if (typeof $._LaSubtituleta === 'undefined' || typeof $._LaSubtituleta." + method + " !== 'function') {",
        "return 'Premiere no cargó la operación interna " + method + ".';",
        "}",
        "return $._LaSubtituleta." + method + "(" + serialized + ");",
        "} catch (error) {",
        "return 'Error interno de Premiere: ' + String(error) + (error.line ? ' (línea ' + error.line + ')' : '');",
        "}",
        "}())"
      ].join(" ");

      // Loading and invoking host.jsx in the same evalScript call avoids CEP
      // losing the ExtendScript namespace between separate evaluations.
      root.__adobe_cep__.evalScript(command, function (result) {
        if (result === "EvalScript error.") {
          reject(new Error("Premiere no pudo evaluar la operación interna " + method + "."));
          return;
        }
        try {
          var parsed = JSON.parse(result || "{}");
          if (parsed && parsed.ok === false) {
            reject(new Error(parsed.error || "Premiere no pudo completar la operación."));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(new Error(result || error.message));
        }
      });
    });
  }

  function evalScript(method, args) {
    return invokeHost(method, args);
  }

  function exportAudio(outputPath, presetPath) {
    return evalScript("exportAudio", [outputPath, presetPath]).then(function (result) {
      return result.outputPath || outputPath;
    });
  }

  root.LaSubtituletaBridge = {
    evalScript: evalScript,
    exportAudio: exportAudio,
    importCaptions: function (srtPath) {
      return evalScript("importCaptions", [srtPath]);
    },
    getContext: function () {
      return evalScript("getContext", []);
    },
    getTimelineContext: function () {
      return evalScript("getTimelineContext", []);
    },
    getExtensionPath: getExtensionPath
  };
})(window);

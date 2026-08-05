(function (root) {
  "use strict";

  var hostLoadPromise = null;

  function getExtensionPath() {
    if (!root.__adobe_cep__) {
      return "";
    }
    var extensionPath = decodeURIComponent(root.__adobe_cep__.getSystemPath("extension"))
      .replace(/^file:\/\/\/?/, "");

    // Some CEP builds expose Windows paths as file:///C:/...
    // ExtendScript requires C:/..., without the leading slash.
    if (/^\/[A-Za-z]:/.test(extensionPath)) {
      extensionPath = extensionPath.substring(1);
    }
    return extensionPath;
  }

  function loadHostScript() {
    if (hostLoadPromise) {
      return hostLoadPromise;
    }
    hostLoadPromise = new Promise(function (resolve, reject) {
      if (!root.__adobe_cep__) {
        reject(new Error("Este panel debe ejecutarse dentro de Premiere Pro."));
        return;
      }
      var hostPath = getExtensionPath().replace(/\\/g, "/") + "/jsx/host.jsx";
      var marker = "SUBTITULADOR_HOST_READY";
      var command = "$.evalFile(" + JSON.stringify(hostPath) + "); \"" + marker + "\";";
      root.__adobe_cep__.evalScript(command, function (result) {
        if (result === marker) {
          resolve();
          return;
        }
        hostLoadPromise = null;
        reject(new Error("Premiere no pudo cargar el módulo interno del subtitulador (" + (result || "sin respuesta") + ")."));
      });
    });
    return hostLoadPromise;
  }

  function invokeHost(method, args) {
    return new Promise(function (resolve, reject) {
      var serialized = (args || []).map(function (value) {
        return JSON.stringify(value);
      }).join(",");

      root.__adobe_cep__.evalScript("$._Subtitulador." + method + "(" + serialized + ")", function (result) {
        if (result === "EvalScript error.") {
          hostLoadPromise = null;
          reject(new Error("Premiere no pudo ejecutar la operación interna " + method + "."));
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
    return loadHostScript().then(function () {
      return invokeHost(method, args);
    });
  }

  function exportAudio(outputPath, presetPath) {
    return evalScript("exportAudio", [outputPath, presetPath]).then(function (result) {
      return result.outputPath || outputPath;
    });
  }

  root.SubtituladorBridge = {
    evalScript: evalScript,
    exportAudio: exportAudio,
    importCaptions: function (srtPath) {
      return evalScript("importCaptions", [srtPath]);
    },
    getContext: function () {
      return evalScript("getContext", []);
    },
    getExtensionPath: getExtensionPath
  };
})(window);

(function (root) {
  "use strict";

  function evalScript(method, args) {
    return new Promise(function (resolve, reject) {
      if (!root.__adobe_cep__) {
        reject(new Error("Este panel debe ejecutarse dentro de Premiere Pro."));
        return;
      }

      var serialized = (args || []).map(function (value) {
        return JSON.stringify(value);
      }).join(",");

      root.__adobe_cep__.evalScript("$._Subtitulador." + method + "(" + serialized + ")", function (result) {
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
    getExtensionPath: function () {
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
  };
})(window);

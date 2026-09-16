(function (root) {
  "use strict";

  function appDataRoot() {
    var os = require("os");
    var path = require("path");
    var base = process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : (process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"));
    return path.join(base, "La Subtituleta");
  }

  function pathFromCep(value) {
    var result = String(value || "");
    if (/^file:\/\//i.test(result)) {
      result = result.replace(/^file:\/\/(?:localhost(?=\/))?/i, "");
      result = decodeURIComponent(result);
    }
    // Keep /Users/... absolute; only Windows drive letters lose their first slash.
    if (/^\/[A-Za-z]:/.test(result)) { result = result.substring(1); }
    return result;
  }

  function fileKey(value) {
    var result = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
    // Windows paths stay compatible with existing libraries. Preserve case on
    // macOS, including case-sensitive APFS volumes and external drives.
    if (/^[A-Za-z]:\//.test(result) || /^\/\//.test(result)) { return result.toLowerCase(); }
    return typeof result.normalize === "function" ? result.normalize("NFC") : result;
  }

  var api = { appDataRoot: appDataRoot, pathFromCep: pathFromCep, fileKey: fileKey };
  root.LaSubtituletaPlatform = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
})(typeof window !== "undefined" ? window : this);

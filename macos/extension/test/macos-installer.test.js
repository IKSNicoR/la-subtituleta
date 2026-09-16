"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const root = path.resolve(__dirname, "../..");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const bashPath = p => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => "/" + drive.toLowerCase());

// Exercise the real installer on a disposable filesystem. Only OS probes and
// macOS preferences are replaced; copying, backup and install paths run in bash.
test("instalador: alta, actualización, claves, copia y desinstalación", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-mac-installer-"));
  try {
    const source = path.join(temp, "Paquete con espacios y tildes");
    const user = path.join(temp, "Usuario Prueba");
    fs.mkdirSync(source);
    fs.mkdirSync(user);
    for (const name of ["index.html", "CSXS", "css", "js", "jsx", "presets"]) {
      fs.cpSync(path.join(root, "extension", name), path.join(source, name), { recursive: true });
    }
    const original = fs.readFileSync(path.join(root, "instalar-macos.sh"), "utf8");
    const probeOverrides = [
      'ls_test_uname() { printf "%s\\n" "$LS_TEST_OS"; }',
      'ls_test_uid() { printf "501\\n"; }',
      'ls_test_pgrep() { [ "$LS_TEST_PREMIERE" = "running" ]; }',
      'ls_test_defaults() { printf "%s\\n" "$*" >> "$LS_TEST_PREF_LOG"; }'
    ].join("\n");
    const harness = original.replace('set -euo pipefail', 'set -euo pipefail\n' + probeOverrides)
      .replaceAll('/usr/bin/uname', 'ls_test_uname').replaceAll('/usr/bin/pgrep', 'ls_test_pgrep')
      .replaceAll('/usr/bin/defaults', 'ls_test_defaults').replaceAll('$(id -u)', '$(ls_test_uid)')
      .replaceAll('${HOME:-}', '${LS_TEST_USER_DIR:-}').replaceAll('$HOME', '$LS_TEST_USER_DIR');
    const script = path.join(source, "instalar-macos.sh");
    fs.writeFileSync(script, harness);
    const run = (args = [], env = {}) => spawnSync(bash, [bashPath(script), ...args], { encoding: "utf8",
      env: { ...process.env, LS_TEST_USER_DIR: bashPath(user), LS_TEST_OS: "Darwin", LS_TEST_PREMIERE: "closed",
        LS_TEST_PREF_LOG: bashPath(path.join(temp, "preferences.log")), ...env } });
    const check = result => assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.notEqual(run([], { LS_TEST_OS: "Linux" }).status, 0);
    assert.notEqual(run([], { LS_TEST_PREMIERE: "running" }).status, 0);
    assert.equal(fs.existsSync(path.join(user, "Library")), false);
    check(run());
    const installed = path.join(user, "Library/Application Support/Adobe/CEP/extensions/com.iksnicor.lasubtituleta");
    const data = path.join(user, "Library/Application Support/La Subtituleta");
    assert.equal(fs.readFileSync(path.join(installed, "js/platform.js"), "utf8"), fs.readFileSync(path.join(source, "js/platform.js"), "utf8"));
    fs.writeFileSync(path.join(data, "config.json"), '{"assemblyai":"dummy-preserved"}');
    fs.writeFileSync(path.join(data, "ultima-transcripcion.json"), '{"words":[]}');
    fs.writeFileSync(path.join(installed, "index.html"), "previous version");
    // Incomplete packages must leave the installed version untouched.
    fs.renameSync(path.join(source, "js/platform.js"), path.join(source, "js/platform.hold"));
    assert.notEqual(run().status, 0);
    assert.equal(fs.readFileSync(path.join(installed, "index.html"), "utf8"), "previous version");
    fs.renameSync(path.join(source, "js/platform.hold"), path.join(source, "js/platform.js"));
    check(run());
    assert.equal(fs.readFileSync(path.join(data, "config.json"), "utf8"), '{"assemblyai":"dummy-preserved"}');
    const backups = path.join(data, "installation-backups");
    const previous = fs.readdirSync(backups).find(n => n.startsWith("updated-"));
    assert.equal(fs.readFileSync(path.join(backups, previous, "extension/index.html"), "utf8"), "previous version");
    check(run(["--uninstall"]));
    assert.equal(fs.existsSync(installed), false);
    assert.equal(fs.existsSync(path.join(data, "config.json")), true);
    assert.equal(fs.existsSync(path.join(data, "ultima-transcripcion.json")), true);
    assert.ok(fs.readdirSync(backups).some(n => n.startsWith("uninstalled-")));
    check(run(["--uninstall"]));
    assert.match(fs.readFileSync(path.join(temp, "preferences.log"), "utf8"), /com\.adobe\.CSXS\.12 PlayerDebugMode -string 1/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

function loadHttp(failures) {
  let attempts = 0;
  const fakeHttps = {
    request(_options, callback) {
      attempts++;
      const request = new EventEmitter();
      request.write = function () {};
      request.destroy = function (error) { request.emit("error", error); };
      request.end = function () {
        process.nextTick(function () {
          if (attempts <= failures) {
            const error = new Error("read ECONNRESET");
            error.code = "ECONNRESET";
            request.emit("error", error);
            return;
          }
          const response = new EventEmitter();
          response.statusCode = 200;
          response.headers = {};
          callback(response);
          response.emit("data", Buffer.from('{"ok":true}'));
          response.emit("end");
        });
      };
      return request;
    }
  };
  const window = {};
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "http.js"), "utf8");
  vm.runInNewContext(source, {
    window,
    Buffer,
    URL,
    setTimeout,
    require(name) {
      if (name === "https") return fakeHttps;
      if (name === "url") return { URL };
      throw new Error("Unexpected require: " + name);
    }
  });
  return { http: window.LaSubtituletaHttp, attempts: () => attempts };
}

test("reintenta dos veces un GET interrumpido por ECONNRESET", async () => {
  const fixture = loadHttp(2);
  const result = await fixture.http.json("https://api.example.com/status", { retryDelayMs: 0 });
  assert.equal(result.ok, true);
  assert.equal(fixture.attempts(), 3);
});

test("no reintenta automáticamente un POST que podría duplicar consumo", async () => {
  const fixture = loadHttp(1);
  await assert.rejects(
    fixture.http.json("https://api.example.com/transcribe", { method: "POST", retryDelayMs: 0 }, { audio: true }),
    /después de 1 intentos/
  );
  assert.equal(fixture.attempts(), 1);
});

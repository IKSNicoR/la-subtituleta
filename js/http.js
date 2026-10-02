(function (root) {
  "use strict";

  var https = require("https");
  var URLCtor = require("url").URL;

  var TRANSIENT_NETWORK_CODES = {
    ECONNRESET: true,
    ETIMEDOUT: true,
    EAI_AGAIN: true,
    ENETDOWN: true,
    ENETUNREACH: true,
    EPIPE: true
  };

  function request(urlValue, options, body) {
    options = options || {};
    var method = String(options.method || "GET").toUpperCase();
    var retries = options.retries == null ? ((method === "GET" || method === "HEAD") ? 2 : 0) : Math.max(0, Number(options.retries) || 0);
    var retryDelayMs = options.retryDelayMs == null ? 350 : Math.max(0, Number(options.retryDelayMs) || 0);
    var attempt = 0;

    function run() {
      return requestOnce(urlValue, options, body).catch(function (error) {
        if (!isTransientNetworkError(error) || attempt >= retries) {
          if (isTransientNetworkError(error)) {
            error.message = "La conexión con la API se interrumpió después de " + (attempt + 1) + " intentos. " + friendlyNetworkDetail(error);
          }
          throw error;
        }
        attempt++;
        return wait(Math.min(2000, retryDelayMs * Math.pow(2, attempt - 1))).then(run);
      });
    }

    return run();
  }

  function requestOnce(urlValue, options, body) {
    return new Promise(function (resolve, reject) {
      var url = new URLCtor(urlValue);
      var headers = Object.assign({}, (options && options.headers) || {});
      if (body && headers["Content-Length"] === undefined) {
        headers["Content-Length"] = Buffer.byteLength(body);
      }

      var req = https.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: headers,
        timeout: (options && options.timeout) || 120000
      }, function (res) {
        var chunks = [];
        res.on("data", function (chunk) { chunks.push(chunk); });
        res.on("end", function () {
          var payload = Buffer.concat(chunks);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            var detail = payload.toString("utf8");
            try {
              var parsed = JSON.parse(detail);
              detail = parsed.error || parsed.err_msg || parsed.message || detail;
            } catch (_error) {}
            var apiError = new Error("API " + res.statusCode + ": " + detail);
            apiError.statusCode = res.statusCode;
            apiError.detail = detail;
            reject(apiError);
            return;
          }
          resolve({ statusCode: res.statusCode, headers: res.headers, body: payload });
        });
      });

      req.on("timeout", function () {
        req.destroy(new Error("La API tardó demasiado en responder."));
      });
      req.on("error", reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  function isTransientNetworkError(error) {
    var code = String(error && error.code || "").toUpperCase();
    var message = String(error && error.message || "").toLowerCase();
    return Boolean(TRANSIENT_NETWORK_CODES[code]) || /econnreset|socket hang up|network.*(?:reset|unreachable)|timed?\s*out|temporary.*dns/.test(message);
  }

  function friendlyNetworkDetail(error) {
    var code = String(error && error.code || "").toUpperCase();
    if (code === "ECONNRESET" || /econnreset|socket hang up/i.test(String(error && error.message || ""))) {
      return "El servicio cerró la conexión; revisá internet y volvé a intentar.";
    }
    return "Revisá internet y volvé a intentar.";
  }

  function wait(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
  }

  function json(url, options, value) {
    var requestOptions = Object.assign({}, options || {});
    requestOptions.headers = Object.assign({}, requestOptions.headers || {});
    var body = value === undefined ? null : Buffer.from(JSON.stringify(value), "utf8");
    if (body) {
      requestOptions.headers["Content-Type"] = "application/json";
    }
    return request(url, requestOptions, body).then(function (response) {
      var text = response.body.toString("utf8");
      return text ? JSON.parse(text) : {};
    });
  }

  function multipart(url, options, fields, file) {
    var boundary = "----LaSubtituleta" + Date.now().toString(16);
    var parts = [];

    Object.keys(fields || {}).forEach(function (name) {
      parts.push(Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + fields[name] + "\r\n", "utf8"));
    });

    parts.push(Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + file.fieldName + "\"; filename=\"" + file.filename.replace(/\"/g, "") + "\"\r\nContent-Type: " + file.contentType + "\r\n\r\n", "utf8"));
    parts.push(file.data);
    parts.push(Buffer.from("\r\n--" + boundary + "--\r\n", "utf8"));

    var requestOptions = Object.assign({}, options || {});
    requestOptions.headers = Object.assign({}, requestOptions.headers || {}, {
      "Content-Type": "multipart/form-data; boundary=" + boundary
    });
    return jsonFromResponse(url, requestOptions, Buffer.concat(parts));
  }

  function jsonFromResponse(url, options, body) {
    return request(url, options, body).then(function (response) {
      var text = response.body.toString("utf8");
      return text ? JSON.parse(text) : {};
    });
  }

  root.LaSubtituletaHttp = {
    request: request,
    json: json,
    multipart: multipart,
    isTransientNetworkError: isTransientNetworkError
  };
})(window);

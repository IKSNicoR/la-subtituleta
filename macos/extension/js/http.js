(function (root) {
  "use strict";

  var https = require("https");
  var URLCtor = require("url").URL;

  function request(urlValue, options, body) {
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
        method: (options && options.method) || "GET",
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
    multipart: multipart
  };
})(window);

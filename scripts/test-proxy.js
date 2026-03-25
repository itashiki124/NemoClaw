var endpoints = [
  "https://openclaw.ai",
  "https://integrate.api.nvidia.com",
  "https://discord.com/api/v10/gateway"
];
var http = require("http");
var https = require("https");

function testViaProxy(url) {
  return new Promise(function(resolve) {
    var u = new URL(url);
    var proxyReq = http.request({
      host: "10.200.0.1",
      port: 3128,
      method: "CONNECT",
      path: u.host + ":443"
    });
    proxyReq.on("connect", function(res) {
      resolve(url + " => CONNECT " + res.statusCode);
    });
    proxyReq.on("error", function(e) {
      resolve(url + " => ERR: " + e.message);
    });
    proxyReq.end();
  });
}

Promise.all(endpoints.map(testViaProxy)).then(function(results) {
  results.forEach(function(r) { console.log(r); });
});

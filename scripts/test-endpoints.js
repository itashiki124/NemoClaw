// Test connectivity to different endpoints
var endpoints = [
  "https://discord.com/api/v10/gateway",
  "https://api.github.com",
  "https://openclaw.ai"
];

Promise.allSettled(endpoints.map(function(url) {
  return fetch(url).then(function(r) {
    return url + " => " + r.status;
  }).catch(function(e) {
    return url + " => ERR: " + e.message;
  });
})).then(function(results) {
  results.forEach(function(r) { console.log(r.value || r.reason); });
});

fetch("https://discord.com/api/v10/gateway")
  .then(function(r) { return r.text().then(function(t) { console.log("STATUS:", r.status, t); }); })
  .catch(function(e) { console.log("ERR:", e.message, e.cause ? e.cause.message : ""); });

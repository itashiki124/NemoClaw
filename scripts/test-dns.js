const dns = require('dns');
dns.resolve('discord.com', (e, a) => console.log('discord.com:', e ? e.message : a));
dns.resolve('gateway.discord.gg', (e, a) => console.log('gateway.discord.gg:', e ? e.message : a));
dns.resolve('google.com', (e, a) => console.log('google.com:', e ? e.message : a));
dns.resolve('cdn.discordapp.com', (e, a) => console.log('cdn.discordapp.com:', e ? e.message : a));

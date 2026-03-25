#!/bin/bash
cd /mnt/c/Users/kazuk/NemoClaw
source ~/.nvm/nvm.sh
node -e '
const p = require("./bin/lib/policies");
console.log("Applying discord preset...");
const result = p.applyPreset("my-assistant", "discord");
console.log("Result:", result);
'

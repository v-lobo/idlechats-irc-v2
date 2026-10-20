"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "idlechats-session-restart-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
async function run(phase) {
  await new Promise((resolve, reject) => {
    const child = spawn(require("electron"), [path.join(__dirname, "discord-session-restart-smoke.cjs"), `--phase=${phase}`, `--profile=${profile}`],
      { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", data => process.stdout.write(data));
    child.stderr.on("data", data => process.stderr.write(data));
    child.on("error", reject);
    child.on("exit", code => {
      child.stdout.destroy(); child.stderr.destroy();
      if (code === 0) resolve(); else reject(new Error(`Persistence phase ${phase} exited with ${code}`));
    });
  });
}
run("write").then(() => run("read")).then(() => {
  console.log("PASS: Discord browser profile persisted across two independent app processes.");
}).catch(error => { console.error(error); process.exitCode = 1; });

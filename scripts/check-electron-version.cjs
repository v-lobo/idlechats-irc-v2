"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Exit codes: 0 = current, 1 = installation needed, 2 = invalid release files.
function checkElectronVersion(appDir) {
  let expected;
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(appDir, "package-lock.json"), "utf8"));
    expected = lock.packages?.["node_modules/electron"]?.version;
    if (typeof expected !== "string" || !expected) throw new Error("Electron version missing from package-lock.json");
  } catch (error) {
    console.error(`Cannot read required Electron version: ${error.message}`);
    return 2;
  }

  try {
    const electronDir = path.join(appDir, "node_modules", "electron");
    const installed = JSON.parse(fs.readFileSync(path.join(electronDir, "package.json"), "utf8")).version;
    const binaryVersion = fs.readFileSync(path.join(electronDir, "dist", "version"), "utf8").trim();
    if (installed === expected && binaryVersion === expected && fs.existsSync(path.join(electronDir, "dist", "electron.exe"))) return 0;
  } catch {
    // Missing or incomplete dependencies are repaired by npm ci.
  }
  console.log(`Electron ${expected} needs to be installed.`);
  return 1;
}

if (require.main === module) process.exitCode = checkElectronVersion(path.resolve(__dirname, ".."));
module.exports = { checkElectronVersion };

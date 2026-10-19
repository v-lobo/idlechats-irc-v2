"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const operations = new Map();
const LOG_LIMIT_BYTES = 256 * 1024;

function enqueue(file, operation) {
  const next = (operations.get(file) || Promise.resolve()).catch(() => {}).then(operation);
  operations.set(file, next);
  const cleanup = () => { if (operations.get(file) === next) operations.delete(file); };
  next.then(cleanup, cleanup);
  return next;
}

function writeJson(file, value) {
  const contents = JSON.stringify(value, null, 2);
  return enqueue(file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await fs.writeFile(temporary, contents, "utf8");
    await fs.rename(temporary, file);
  });
}

function appendConnectionLog(file, fields) {
  // Only lifecycle metadata is accepted; tokens and IRC messages are never recorded.
  const entry = { time: new Date().toISOString() };
  for (const key of ["event", "account", "state", "reason"]) {
    if (fields[key]) entry[key] = String(fields[key]).slice(0, 80);
  }
  const line = JSON.stringify(entry) + "\n";
  return enqueue(file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const size = await fs.stat(file).then((stat) => stat.size).catch((error) => {
      if (error.code === "ENOENT") return 0;
      throw error;
    });
    if (size + Buffer.byteLength(line) > LOG_LIMIT_BYTES) {
      await fs.rm(`${file}.1`, { force: true });
      await fs.rename(file, `${file}.1`);
    }
    await fs.appendFile(file, line, "utf8");
  });
}

module.exports = { writeJson, appendConnectionLog };

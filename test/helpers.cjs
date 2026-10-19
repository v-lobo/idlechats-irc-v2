"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fakeClock() {
  let now = 1_000_000;
  let sequence = 0;
  const tasks = new Map();
  const add = (callback, delay, interval = false) => {
    const handle = { id: ++sequence, unref() {} };
    tasks.set(handle.id, { callback, due: now + delay, interval: interval ? delay : 0 });
    return handle;
  };
  const clear = (handle) => tasks.delete(handle?.id);
  return {
    globals: {
      Date: class extends Date { static now() { return now; } },
      Math: Object.assign(Object.create(Math), { random: () => 0 }),
      setTimeout: (callback, delay) => add(callback, delay),
      setInterval: (callback, delay) => add(callback, delay, true),
      clearTimeout: clear,
      clearInterval: clear
    },
    now: () => now,
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...tasks.entries()].filter(([, task]) => task.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, task] = next;
        now = task.due;
        if (task.interval) task.due += task.interval;
        else tasks.delete(id);
        task.callback();
      }
      now = target;
    },
    count: () => tasks.size
  };
}

function loadSource(name, mocks, globals, extraSource = "") {
  const file = path.join(__dirname, "..", "src", name);
  const context = {
    module: { exports: {} },
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
    console, Buffer, process, URL, URLSearchParams, AbortSignal,
    __dirname: path.dirname(file), ...globals
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8") + extraSource, context, { filename: file });
  return context.module.exports;
}

async function flush() { for (let index = 0; index < 20; index += 1) await Promise.resolve(); }

module.exports = { fakeClock, loadSource, flush };

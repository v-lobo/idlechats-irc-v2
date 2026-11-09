"use strict";

// Render the vector source with Electron, then build a multi-resolution Windows ICO.
// Run: npx electron scripts/generate-icons.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const source = path.join(__dirname, "..", "src");
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 512, height: 512, useContentSize: true, show: false,
    transparent: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } });
  const painted = new Promise(resolve => window.webContents.once("paint", (_event, _rect, image) => resolve(image)));
  const svg = fs.readFileSync(path.join(source, "app-icon.svg"), "utf8");
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>html,body{margin:0;width:512px;height:512px;overflow:hidden}svg{width:512px;height:512px}</style>${svg}`)}`);
  const image = await painted;
  if (image.isEmpty()) throw new Error("Icon render was empty");
  fs.writeFileSync(path.join(source, "app-icon.png"), image.resize({ width: 256, height: 256, quality: "best" }).toPNG());
  fs.writeFileSync(path.join(source, "tray.png"), image.resize({ width: 32, height: 32, quality: "best" }).toPNG());
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const frames = sizes.map(size => image.resize({ width: size, height: size, quality: "best" }).toPNG());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames[index].length;
  });
  fs.writeFileSync(path.join(source, "app-icon.ico"), Buffer.concat([header, ...frames]));
  console.log("Generated app-icon.png, app-icon.ico (9 sizes) and tray.png from app-icon.svg.");
  window.destroy();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error("Icon rendering timed out"); app.exit(2); }, 15000).unref();

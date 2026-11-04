'use strict';
/* 用 Electron 自带的 Chromium 解码 mp4 并抽帧，避开 ffmpeg 依赖。
 * 用法: electron tools/videoframes.js <video> <outDir> [张数]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('LOAD', JSON.stringify(process.argv.slice(1)));
const VIDEO = process.argv[2];
const OUT = process.argv[3] || path.join(os.tmpdir(), 'frames');
const COUNT = Number(process.argv[4] || 9);


app.whenReady().then(async () => {
  if (!VIDEO || !fs.existsSync(VIDEO)) {
    console.log('ERR video not found');
    app.quit();
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });

  const tmpHtml = path.join(os.tmpdir(), 'vf_' + Date.now() + '.html');
  const fileUrl = 'file:///' + VIDEO.replace(/\\/g, '/').replace(/ /g, '%20');
  fs.writeFileSync(
    tmpHtml,
    `<!doctype html><html><body style="margin:0;background:#000">
     <video id="v" src="${fileUrl}" muted preload="auto" style="width:100%"></video></body></html>`,
    'utf8'
  );

  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    webPreferences: { backgroundThrottling: false }
  });
  win.loadFile(tmpHtml);

  const js = (code) => win.webContents.executeJavaScript(code, true);

  try {
    await new Promise((r) => win.webContents.once('did-finish-load', r));
    const meta = await js(`(async () => {
      const v = document.getElementById('v');
      if (v.readyState < 1) await new Promise(r => v.addEventListener('loadedmetadata', r, {once:true}));
      return { d: v.duration, w: v.videoWidth, h: v.videoHeight };
    })()`);
    console.log('video', JSON.stringify(meta));

    const dur = meta.d || 1;
    const times = [];
    for (let i = 0; i < COUNT; i++) times.push(+(dur * (i / (COUNT - 1 || 1)) * 0.98).toFixed(3));

    for (let i = 0; i < times.length; i++) {
      const dataUrl = await js(`(async () => {
        const v = document.getElementById('v');
        v.currentTime = ${times[i]};
        await new Promise(r => { v.addEventListener('seeked', r, {once:true}); setTimeout(r, 2500); });
        const c = document.createElement('canvas');
        const scale = Math.min(1, 900 / Math.max(v.videoWidth, 1));
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
      })()`);
      const b64 = String(dataUrl).split(',')[1] || '';
      const buf = Buffer.from(b64, 'base64');
      const name = 'f' + String(i).padStart(2, '0') + '_' + times[i] + 's.png';
      fs.writeFileSync(path.join(OUT, name), buf);
      console.log('saved', name, buf.length);
    }
  } catch (e) {
    console.log('ERR', e && e.message);
  }
  try {
    fs.unlinkSync(tmpHtml);
  } catch (e) {
    /* ignore */
  }
  app.quit();
});

'use strict';
/* 自检脚本：合成指针事件，验证「点击开气泡 / 拖拽移动窗口 / 形象切换 / 动作」链路。
 * 仅用于开发验证，不参与打包运行。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

module.exports = function selftest(win, app) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ROOT, name), img.toPNG());
  };
  const log = (...a) => console.log('[selftest]', ...a);

  (async () => {
    try {
      await sleep(4200);

      const info = await js(`(() => {
        const r = document.getElementById('sprite').getBoundingClientRect(); console.log('HREF', location.href, 'SEARCH', JSON.stringify(location.search));
        return { href: location.href,
          sprite: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          win: [window.screenX, window.screenY],
          open: document.getElementById('bubble').classList.contains('open'),
          balance: document.getElementById('balance').textContent,
          today: document.getElementById('todayUsed').textContent,
          week: document.getElementById('weekUsed').textContent,
          phase: document.getElementById('phaseText').textContent,
          timer: document.getElementById('phaseTimer').textContent,
          bars: document.querySelectorAll('#spark .bar').length,
          scaleNow: getComputedStyle(document.documentElement).getPropertyValue('--scale').trim(),
          petH: getComputedStyle(document.documentElement).getPropertyValue('--pet-h').trim()
        };
      })()`);
      log('init', JSON.stringify(info));

      const [sx, sy, sw, sh] = info.sprite;
      const cx = Math.round(sx + sw / 2);
      const cy = Math.round(sy + sh * 0.55);
      const winX = info.win[0];
      const winY = info.win[1];

      /* 1) 悬停：应当从"穿透"变成"可交互" */
      win.webContents.sendInputEvent({ type: 'mouseMove', x: cx, y: cy });
      await sleep(400);
      log('hover ignore =', await js('window.__wbpet.state.ignore'));

      /* 2) 点击：应当打开气泡 */
      await js(`(() => {
        const el = document.getElementById('pet');
        const r = document.getElementById('sprite').getBoundingClientRect(); console.log('HREF', location.href, 'SEARCH', JSON.stringify(location.search));
        const x = r.left + r.width/2, y = r.top + r.height*0.55;
        const sx = window.screenX + x, sy = window.screenY + y;
        el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, cancelable:true, button:0, pointerId:7, clientX:x, clientY:y, screenX:sx, screenY:sy}));
        el.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, cancelable:true, button:0, pointerId:7, clientX:x, clientY:y, screenX:sx, screenY:sy}));
      })()`);
      await sleep(900);
      log('bubble open =', await js(`document.getElementById('bubble').classList.contains('open')`));
      await shot('test-1-bubble.png');

      /* 3) 拖拽：窗口应当真的移动 */
      const pos0 = win.getPosition();
      await js(`(() => {
        const el = document.getElementById('pet');
        const r = document.getElementById('sprite').getBoundingClientRect(); console.log('HREF', location.href, 'SEARCH', JSON.stringify(location.search));
        const x = r.left + r.width/2, y = r.top + r.height*0.55;
        const sx = window.screenX + x, sy = window.screenY + y;
        el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, cancelable:true, button:0, pointerId:9, clientX:x, clientY:y, screenX:sx, screenY:sy}));
        for (let i=1;i<=6;i++){
          el.dispatchEvent(new PointerEvent('pointermove', {bubbles:true, button:0, pointerId:9, clientX:x-i*10, clientY:y-i*8, screenX:sx-i*10, screenY:sy-i*8}));
        }
        el.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, button:0, pointerId:9, clientX:x-60, clientY:y-48, screenX:sx-60, screenY:sy-48}));
      })()`);
      await sleep(1200);
      const pos1 = win.getPosition();
      log('drag', JSON.stringify(pos0), '->', JSON.stringify(pos1), 'moved =', pos0[0] !== pos1[0] || pos0[1] !== pos1[1]);

      /* 4) 换普通版 */
      await js(`window.__wbpet.setForm('normal')`);
      await sleep(900);
      await shot('test-2-normal.png');

      /* 6) 姿态（表情包立绘） */
      await js(`void window.__wbpet.playPose('assets/poses/pose-cheer.png')`);
      await sleep(1100);
      await shot('test-4-pose.png');
      await sleep(1800);

      /* 7) 换回 Q 版 */
      await js(`window.__wbpet.setForm('chibi')`);
      await sleep(600);
      await js(`window.__wbpet.toggleBubble(false)`);

      log('done');
    } catch (e) {
      log('ERROR', e && e.stack ? e.stack : e);
    } finally {
      app.isQuitting = true;
      setTimeout(() => app.quit(), 300);
    }
  })();
};

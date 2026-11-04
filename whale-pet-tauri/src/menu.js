/* 右键菜单：独立作用域，只通过 window.__wbpet / window.petAPI 与主程序交互 */
(function () {
  const ACTIONS = [
    ['hop', '跳一下'],
    ['wobble', '摇一摇'],
    ['spin', '转个圈'],
    ['stretch', '伸懒腰'],
    ['lean', '歪一下'],
    ['dance', '跳个舞'],
    ['look', '左右张望'],
    ['yawn', '打个哈欠'],
    ['peek', '探个头'],
    ['bow', '鞠个躬'],
    ['twirl', '转两圈'],
    ['shy', '害羞'],
    ['angry', '生气'],
    ['fish', '摸鱼'],
    ['eat', '吃小鱼干'],
    ['pose', '换个姿态']
  ];
  const SIZES = [60, 80, 100, 120, 150, 180];
  const INTERVALS = [
    [30, '30 秒'],
    [60, '1 分钟'],
    [90, '1.5 分钟'],
    [180, '3 分钟'],
    [300, '5 分钟'],
    [600, '10 分钟']
  ];

  let el = null;
  let sect = '';

  const api = () => window.petAPI;
  const st = () => (window.__wbpet && window.__wbpet.state) || {};

  function rectOf(node) {
    const r = node.getBoundingClientRect();
    return [Math.round(r.left) - 3, Math.round(r.top) - 3, Math.round(r.width) + 6, Math.round(r.height) + 6];
  }

  function publishRect() {
    window.__menuRect = el && el.classList.contains('open') ? rectOf(el) : null;
    const wb = window.__wbpet;
    if (wb && wb.reportState) wb.reportState();
  }

  function item(act, label, kind, on) {
    let mark = '';
    if (kind === 'check') mark = '<span class="m-box">' + (on ? '✓' : '') + '</span>';
    else if (kind === 'radio') mark = '<span class="m-radio">' + (on ? '<i></i>' : '') + '</span>';
    const go = kind === 'sect' ? '<span class="m-go">›</span>' : '';
    const onCls = kind === 'sect' && sect && sect === act.slice(5) ? ' on' : '';
    const danger = act === 'quit' ? ' danger' : '';
    return '<div class="m-item' + onCls + danger + '" data-act="' + act + '">' + mark + label + go + '</div>';
  }

  function rows() {
    const cfg = st().cfg || {};
    const form = st().form === 'normal' ? 'normal' : 'chibi';
    const sbf = cfg.scaleByForm || {};
    const curPct = Math.round((sbf[form] || 1) * 100);
    let h = '';

    h += item('sect:actions', '动作', 'sect');
    if (sect === 'actions') {
      h += '<div class="m-sub">';
      for (const a of ACTIONS) h += item('do:' + a[0], a[1], 'radio', false);
      h += '</div>';
    }

    h += item('sect:shape', '形象', 'sect');
    if (sect === 'shape') {
      h += '<div class="m-sub">';
      h += item('mode:auto', '自动（Flash / Pro）', 'radio', cfg.mode === 'auto');
      h += item('mode:chibi', '固定 Flash', 'radio', cfg.mode === 'chibi');
      h += item('mode:normal', '固定 Pro', 'radio', cfg.mode === 'normal');
      h += '</div>';
    }

    h += item('sect:interval', '空闲切换间隔', 'sect');
    if (sect === 'interval') {
      h += '<div class="m-sub">';
      for (const iv of INTERVALS) h += item('sw:' + iv[0], iv[1], 'radio', cfg.switchSeconds === iv[0]);
      h += '</div>';
    }

    h += item('sect:size', '大小', 'sect');
    if (sect === 'size') {
      h += '<div class="m-sub">';
      for (const pct of SIZES) h += item('sz:' + pct, pct + '%', 'radio', curPct === pct);
      h += '</div>';
    }

    h += '<div class="m-sep"></div>';
    h += item('refresh', '刷新积分');
    h += '<div class="m-sep"></div>';
    h += item('top', '始终置顶', 'check', !!cfg.alwaysOnTop);
    h += item('snap', '贴边吸附', 'check', !!cfg.snapToEdge);
    h += item('autostart', '开机自启', 'check', !!cfg.autostart);
    h += '<div class="m-sep"></div>';
    h += item('shortcut', '创建桌面快捷方式');
    h += item('readme', '打开说明');
    h += '<div class="m-sep"></div>';
    h += item('hide', '隐藏桌宠');
    h += item('quit', '退出桌宠');
    return h;
  }

  async function fit() {
    let metrics = null;
    try {
      metrics = await api().windowMetrics();
    } catch (e) {
      metrics = null;
    }
    let left = parseFloat(el.style.left || '34');
    let top = parseFloat(el.style.top || '34');
    const w = el.offsetWidth;

    if (!metrics) {
      el.style.left = Math.max(4, Math.min(left, innerWidth - w - 4)) + 'px';
      el.style.top = Math.max(4, Math.min(top, innerHeight - 120)) + 'px';
      return;
    }

    const k = metrics.dpr || 1;
    const pad = 8;
    /* 屏幕坐标 = 窗口屏幕位置 + 窗口内偏移 * 缩放 */
    let scrLeft = metrics.x + left * k;
    let scrTop = metrics.y + top * k;
    const scrRight = scrLeft + w * k;

    if (scrTop < metrics.waTop + pad) {
      top += (metrics.waTop + pad - scrTop) / k;
      scrTop = metrics.waTop + pad;
    }
    if (scrLeft < metrics.waLeft + pad) {
      left += (metrics.waLeft + pad - scrLeft) / k;
      scrLeft = metrics.waLeft + pad;
    }
    if (scrRight > metrics.waRight - pad) {
      left -= (scrRight - (metrics.waRight - pad)) / k;
    }

    /* 可见高度不够就让菜单滚动，而不是顶出屏幕 */
    const visibleBottom = metrics.y + innerHeight * k;
    const avail = (visibleBottom - (metrics.waTop + pad)) / k - pad;
    el.style.maxHeight = Math.max(160, Math.min(avail, innerHeight - 16)) + 'px';

    el.style.left = Math.max(0, left) + 'px';
    el.style.top = Math.max(0, top) + 'px';
  }

  function open(x, y) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'ctxmenu';
      document.body.appendChild(el);
      el.addEventListener('click', onClick);
    }
    sect = '';
    el.innerHTML = rows();
    el.classList.add('open');
    el.style.left = Math.max(34, Math.min(x, innerWidth - 240)) + 'px';
    el.style.top = Math.max(34, Math.min(y, innerHeight - 260)) + 'px';
    fit().then(publishRect);
  }

  function close() {
    if (!el || !el.classList.contains('open')) return;
    el.classList.remove('open');
    publishRect();
  }

  function onClick(e) {
    const node = e.target.closest ? e.target.closest('.m-item') : null;
    if (!node) return;
    const act = node.dataset.act || '';
    e.stopPropagation();

    if (act.indexOf('sect:') === 0) {
      const key = act.slice(5);
      sect = sect === key ? '' : key;
      el.innerHTML = rows();
      fit().then(publishRect);
      return;
    }

    if (act.indexOf('do:') === 0) {
      const id = act.slice(3);
      close();
      const wb = window.__wbpet;
      if (wb) {
        if (id === 'pose' && wb.playPose) wb.playPose();
        else if (wb.playAction) wb.playAction(id);
      }
      return;
    }

    close();
    if (act.indexOf('mode:') === 0) return api().setMode(act.slice(5));
    if (act.indexOf('sw:') === 0) return api().setSwitch(Number(act.slice(3)));
    if (act.indexOf('sz:') === 0) return api().setScale({ form: st().form, scale: Number(act.slice(3)) / 100 });

    const cfg = st().cfg || {};
    switch (act) {
      case 'refresh':
        return api().refresh();
      case 'top':
        return api().setTop(!cfg.alwaysOnTop);
      case 'snap':
        return api().setSnap(!cfg.snapToEdge);
      case 'autostart':
        return api().setAutostart(!cfg.autostart);
      case 'shortcut':
        return api().makeShortcut();
      case 'readme':
        return api().openReadme();
      case 'hide':
        return api().hidePet();
      case 'quit':
        return api().quit();
      default:
        return undefined;
    }
  }

  document.addEventListener('pointerdown', function (e) {
    if (!el || !el.classList.contains('open')) return;
    if (!el.contains(e.target)) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('resize', close);

  try {
    if (window.__TAURI__ && window.__TAURI__.event) {
      window.__TAURI__.event.listen('pet:leave', function () {
        close();
      });
    }
  } catch (e) {
    /* ignore */
  }

  window.addEventListener('DOMContentLoaded', function () {
    const pet = document.getElementById('pet');
    if (!pet) return;
    pet.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (window.__TAURI__) {
        window.__TAURI__.core.invoke('open_menu', { cx: e.clientX, cy: e.clientY });
      }
    });
  });
})();

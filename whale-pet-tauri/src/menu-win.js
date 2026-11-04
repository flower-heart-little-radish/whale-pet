/* 独立菜单窗口：左栏主菜单 + 右栏子菜单 */
(function () {
  const T = window.__TAURI__;
  if (!T) return;
  const invoke = T.core.invoke;

  const ACTIONS = [
    ['hop', '跳一下'], ['wobble', '摇一摇'], ['spin', '转个圈'], ['stretch', '伸懒腰'],
    ['lean', '歪一下'], ['dance', '跳个舞'], ['look', '左右张望'], ['yawn', '打个哈欠'],
    ['peek', '探个头'], ['bow', '鞠个躬'], ['twirl', '转两圈'], ['shy', '害羞'],
    ['angry', '生气'], ['fish', '摸鱼'], ['eat', '吃小鱼干'], ['pose', '换个姿态']
  ];
  const SIZES = [60, 80, 100, 120, 150, 180];
  const INTERVALS = [[30, '30 秒'], [60, '1 分钟'], [90, '1.5 分钟'], [180, '3 分钟'], [300, '5 分钟'], [600, '10 分钟']];

  const main = document.getElementById('menu');
  const sub = document.getElementById('sub');
  let cfg = {};
  let form = 'chibi';
  let openKey = '';

  function item(act, label, kind, on) {
    let mark = '';
    if (kind === 'check') mark = '<span class="m-box">' + (on ? '✓' : '') + '</span>';
    else if (kind === 'radio') mark = '<span class="m-radio">' + (on ? '<i></i>' : '') + '</span>';
    const go = kind === 'sect' ? '<span class="m-go">›</span>' : '';
    const onCls = kind === 'sect' && openKey === act.slice(5) ? ' on' : '';
    const danger = act === 'quit' ? ' danger' : '';
    return '<div class="m-item' + onCls + danger + '" data-act="' + act + '">' + mark + label + go + '</div>';
  }

  function mainRows() {
    let h = '';
    h += item('sect:actions', '动作', 'sect');
    h += item('sect:shape', '形象', 'sect');
    h += item('sect:interval', '空闲切换间隔', 'sect');
    h += item('sect:size', '大小', 'sect');
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

  function subRows(key) {
    const sbf = cfg.scaleByForm || {};
    const curPct = Math.round((sbf[form] || 1) * 100);
    let h = '';
    if (key === 'actions') {
      for (const a of ACTIONS) h += item('do:' + a[0], a[1]);
    } else if (key === 'shape') {
      h += item('mode:auto', '自动切换', 'radio', cfg.mode === 'auto');
      h += item('mode:chibi', '固定 Flash', 'radio', cfg.mode === 'chibi');
      h += item('mode:normal', '固定 Pro', 'radio', cfg.mode === 'normal');
    } else if (key === 'interval') {
      for (const iv of INTERVALS) h += item('sw:' + iv[0], iv[1], 'radio', cfg.switchSeconds === iv[0]);
    } else if (key === 'size') {
      for (const pct of SIZES) h += item('sz:' + pct, pct + '%', 'radio', curPct === pct);
    }
    return h;
  }

  function paint() {
    main.innerHTML = mainRows();
    if (openKey) {
      sub.innerHTML = subRows(openKey);
      sub.classList.add('open');
    } else {
      sub.classList.remove('open');
      sub.innerHTML = '';
    }
  }

  function openSection(key, rowEl) {
    openKey = key;
    paint();
    if (rowEl) {
      const top = rowEl.offsetTop;
      sub.style.marginTop = Math.max(22, top) + 'px';
    }
  }

  function closeSection() {
    openKey = '';
    paint();
  }

  async function run(act) {
    if (act.indexOf('do:') === 0) {
      invoke('close_menu').catch(() => {});
      return invoke('run_action', { id: act.slice(3) }).catch(() => {});
    }
    invoke('close_menu').catch(() => {});
    if (act.indexOf('mode:') === 0) return invoke('set_mode', { mode: act.slice(5) }).catch(() => {});
    if (act.indexOf('sw:') === 0) return invoke('set_switch', { sec: Number(act.slice(3)) }).catch(() => {});
    if (act.indexOf('sz:') === 0) return invoke('set_scale', { form, scale: Number(act.slice(3)) / 100 }).catch(() => {});
    switch (act) {
      case 'refresh': return invoke('refresh_probe').catch(() => {});
      case 'top': return invoke('set_top', { on: !cfg.alwaysOnTop }).catch(() => {});
      case 'snap': return invoke('set_snap', { on: !cfg.snapToEdge }).catch(() => {});
      case 'autostart': return invoke('set_autostart', { on: !cfg.autostart }).catch(() => {});
      case 'shortcut': return invoke('make_shortcut').catch(() => {});
      case 'readme': return invoke('open_readme').catch(() => {});
      case 'hide': return invoke('hide_pet').catch(() => {});
      case 'quit': return invoke('quit_app').catch(() => {});
      default: return undefined;
    }
  }

  document.addEventListener('click', function (e) {
    const node = e.target.closest ? e.target.closest('.m-item') : null;
    if (!node) return;
    const act = node.dataset.act || '';
    if (act.indexOf('sect:') === 0) {
      const key = act.slice(5);
      if (openKey === key) closeSection();
      else openSection(key, node);
      return;
    }
    run(act);
  });

  /* 鼠标划到别的分组时直接切换（和系统菜单一致） */
  main.addEventListener('mouseover', function (e) {
    const node = e.target.closest ? e.target.closest('.m-item') : null;
    if (!node || !openKey) return;
    const act = node.dataset.act || '';
    if (act.indexOf('sect:') === 0) {
      const key = act.slice(5);
      if (key !== openKey) openSection(key, node);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') invoke('close_menu').catch(() => {});
  });
  document.addEventListener('pointerdown', function (e) {
    if (!document.getElementById('wrap').contains(e.target)) invoke('close_menu').catch(() => {});
  });

  window.addEventListener('DOMContentLoaded', async function () {
    try {
      const info = await invoke('init_info');
      cfg = (info && info.config) || {};
      form = cfg.mode === 'normal' ? 'normal' : 'chibi';
    } catch (e) {
      cfg = {};
    }
    paint();
  });

  window.__menuSetForm = function (f) {
    form = f === 'normal' ? 'normal' : 'chibi';
  };
})();

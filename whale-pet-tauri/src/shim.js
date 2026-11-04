/* Tauri 桥：把 Electron 时代的 window.petAPI 用 invoke/listen 复刻一遍，
   前端 app.js 不需要改任何调用方式。 */
(function () {
  const TAURI = window.__TAURI__;
  if (!TAURI) {
    document.title = 'no-tauri-api';
    return;
  }
  const invoke = TAURI.core.invoke;
  const T = (m) => { try { invoke('trace', { msg: String(m) }); } catch (e) {} };
  window.addEventListener('unhandledrejection', (e) => T('REJ ' + (e.reason && (e.reason.stack || e.reason.message || e.reason))));
  window.addEventListener('error', (e) => T('JSERR ' + e.message + ' @' + (e.filename||'') + ':' + (e.lineno||0)));
  T('shim loaded');
  const listen = TAURI.event.listen;

  function on(name, cb) {
    listen(name, (e) => cb(e.payload));
  }

  const skin = {
    cfg: null,
    poses: [],
    poseMeta: {},
    async init() {
      T('init start');
      const info = await invoke('init_info');
      T('init ok ' + JSON.stringify(info.config && info.config.mode));
      skin.cfg = info.config;
      try {
        const res = await fetch('assets/poses.json');
        const meta = await res.json();
        skin.poseMeta = meta || {};
        skin.poses = Object.keys(meta || {});
      } catch (e) {
        T('poses fail ' + e.message);
        skin.poses = [];
      }
      return { config: info.config, poses: skin.poses, poseMeta: skin.poseMeta };
    },
    setIgnoreMouse() {},
    setState: (st) => {
      window.__stCount = (window.__stCount || 0) + 1;
      if (window.__stCount <= 2) T('reportState#' + window.__stCount + ' rect=' + JSON.stringify(st.rect));
      return invoke('report_state', { st }).catch((e) => T('state err ' + e));
    },
    press() {},
    dragStart: () => invoke('start_drag'),
    dragMove() {},
    dragEnd: async () => ({ side: 'none' }),
    refresh: () => invoke('refresh_probe'),
    setMode: (m) => invoke('set_mode', { mode: m }),
    setScale: (p) => {
      const form = p && p.form ? p.form : 'chibi';
      const scale = p && p.scale != null ? p.scale : p;
      return invoke('set_scale', { form, scale });
    },
    setSwitch: (s) => invoke('set_switch', { sec: s }),
    contextMenu: () => invoke('show_menu'),
    setInteractive: (on) => invoke('set_interactive', { on }),
    hidePet: () => invoke('hide_pet'),
    showPet: () => invoke('show_pet'),
    windowMetrics: () => invoke('window_metrics'),
    setTop: (on) => invoke('set_top', { on }),
    setSnap: (on) => invoke('set_snap', { on }),
    setAutostart: (on) => invoke('set_autostart', { on }),
    makeShortcut: () => invoke('make_shortcut'),
    quit: () => invoke('quit_app'),
    openReadme: () => invoke('open_readme'),
    onData: (cb) => on('probe:data', cb),
    onError: (cb) => on('probe:error', cb),
    onConfig: (cb) => on('config', cb),
    onAction: (cb) => on('pet:do-action', cb),
    onView: (cb) => on('pet:view', cb),
    onBubble: (cb) => on('pet:bubble', cb),
    nativeDrag() {},
    onDragStop: (cb) => on('pet:drag-end', cb)
  };

  /* 托盘触发的模式切换也走 api.setMode 那条链路 */
  listen('pet:mode', (e) => {
    if (skin.cfg) skin.cfg.mode = e.payload;
    invoke('set_mode', { mode: e.payload });
  });
  listen('pet:refresh', () => invoke('refresh_probe'));
  listen('pet:scale-pct', (e) => {
    const form =
      (window.__wbpet && window.__wbpet.state && window.__wbpet.state.form) || 'chibi';
    invoke('set_scale', { form, scale: e.payload });
  });

  window.petAPI = skin;
})();

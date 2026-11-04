#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::menu::{CheckMenuItem, ContextMenu, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_autostart::ManagerExt as _;

use std::os::windows::process::CommandExt;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use windows::Win32::Foundation::{COLORREF, HWND, POINT, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassLongPtrW, SetClassLongPtrW,
    GetCursorPos, SetWindowPos, SystemParametersInfoW, HWND_TOP, SPI_GETWORKAREA, SWP_NOACTIVATE,
    SWP_NOSIZE, SWP_NOZORDER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};

const WIN_W: f64 = 440.0;
const WIN_H: f64 = 760.0;
const EDGE_SNAP: f64 = 26.0;
const MENU_W: f64 = 384.0;
const MENU_H: f64 = 760.0;

const ACTIONS: &[(&str, &str)] = &[
    ("hop", "跳一下"),
    ("wobble", "摇一摇"),
    ("spin", "转个圈"),
    ("stretch", "伸懒腰"),
    ("lean", "歪一下"),
    ("dance", "跳个舞"),
    ("look", "左右张望"),
    ("yawn", "打个哈欠"),
    ("peek", "探个头"),
    ("bow", "鞠个躬"),
    ("twirl", "转两圈"),
    ("shy", "害羞"),
    ("angry", "生气"),
    ("fish", "摸鱼"),
    ("eat", "吃小鱼干"),
    ("pose", "换个姿态"),
];

const INTERVALS: &[(u32, &str)] = &[
    (30, "30 秒"),
    (60, "1 分钟"),
    (90, "1.5 分钟"),
    (180, "3 分钟"),
    (300, "5 分钟"),
    (600, "10 分钟"),
];

const SIZES: &[u32] = &[60, 80, 100, 120, 150, 180];

/* ------------------------------- 配置 ------------------------------- */

fn def_true() -> bool {
    true
}
fn def_scale() -> f64 {
    1.0
}
fn def_refresh() -> u32 {
    120
}
fn def_switch() -> u32 {
    90
}
fn def_mode() -> String {
    "auto".into()
}
fn def_python() -> String {
    String::new()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct ScaleByForm {
    #[serde(default = "def_scale")]
    chibi: f64,
    #[serde(default = "def_scale")]
    normal: f64,
}
impl Default for ScaleByForm {
    fn default() -> Self {
        Self {
            chibi: 1.0,
            normal: 1.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Pos {
    x: f64,
    y: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Config {
    #[serde(default = "def_mode")]
    mode: String,
    #[serde(default = "def_scale")]
    scale: f64,
    #[serde(default)]
    scale_by_form: ScaleByForm,
    #[serde(default = "def_true")]
    always_on_top: bool,
    #[serde(default = "def_true")]
    snap_to_edge: bool,
    #[serde(default)]
    autostart: bool,
    #[serde(default = "def_true")]
    remote: bool,
    #[serde(default)]
    pos: Option<Pos>,
    #[serde(default = "def_switch")]
    switch_seconds: u32,
    #[serde(default = "def_refresh")]
    refresh_seconds: u32,
    #[serde(default = "def_python")]
    python: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            mode: def_mode(),
            scale: 1.0,
            scale_by_form: ScaleByForm::default(),
            always_on_top: true,
            snap_to_edge: true,
            autostart: false,
            remote: true,
            pos: None,
            switch_seconds: def_switch(),
            refresh_seconds: def_refresh(),
            python: def_python(),
        }
    }
}

#[derive(Default, Clone, Debug)]
struct HitInfo {
    ratio: f64,
    rect: Option<[f64; 4]>,
    bubble: Option<[f64; 4]>,
    menu: Option<[f64; 4]>,
    mask: Vec<u8>,
    mw: u32,
    mh: u32,
}

static SIZE_FIXED: AtomicBool = AtomicBool::new(false);

struct State {
    force_hit: AtomicBool,
    cfg: Mutex<Config>,
    hit: Mutex<HitInfo>,
    ignore: AtomicBool,
    dragging: AtomicBool,
}

fn config_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let _ = std::fs::create_dir_all(&dir);
    dir.join("config.json")
}

fn load_config(app: &tauri::AppHandle) -> Config {
    if let Ok(s) = std::fs::read_to_string(config_path(app)) {
        if let Ok(c) = serde_json::from_str::<Config>(&s) {
            return c;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Ok(s) = std::fs::read_to_string(dir.join("config.json")) {
                if let Ok(c) = serde_json::from_str::<Config>(&s) {
                    return c;
                }
            }
        }
    }
    Config::default()
}

fn save_config(app: &tauri::AppHandle, cfg: &Config) {
    if let Ok(s) = serde_json::to_string_pretty(cfg) {
        let _ = std::fs::write(config_path(app), s);
    }
}

/* ------------------------------- Win32 ------------------------------- */

fn tlog(app: &tauri::AppHandle, msg: String) {
    use std::io::Write;
    let p = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("trace.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
        let _ = f.write_all(format!("{}\n", msg).as_bytes());
    }
}

fn workbuddy_running() -> bool {
    let out = std::process::Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq WorkBuddy.exe", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_lowercase().contains("workbuddy.exe"),
        Err(_) => true,
    }
}

fn work_area() -> RECT {
    let mut r = RECT::default();
    unsafe {
        let _ = SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(&mut r as *mut RECT as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
    }
    r
}

fn cursor_pos() -> POINT {
    let mut p = POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut p);
    }
    p
}

fn left_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) & 0x8000u16 as i16) != 0 }
}

/// 拖拽：Rust 里读光标 -> SetWindowPos，4ms 一拍。等价 Qt 的 self.move()。
fn run_drag(app: tauri::AppHandle, win: tauri::WebviewWindow, rect: Option<[f64; 4]>) {
    let app2 = app.clone();
    let ratio = {
        let st = app2.state::<State>();
        let h = st.hit.lock().unwrap();
        if h.ratio > 0.3 { h.ratio } else { win.scale_factor().unwrap_or(1.0) }
    };
    let scale = ratio;
    let start_cur = cursor_pos();
    let start_win = win.outer_position().unwrap_or_default();
    let ox = start_cur.x as f64 - start_win.x as f64;
    let oy = start_cur.y as f64 - start_win.y as f64;

    let wa = work_area();
    let (r0, r1, r2, r3) = match rect {
        Some(r) => (r[0] * scale, r[1] * scale, r[2] * scale, r[3] * scale),
        None => (0.0, 0.0, WIN_W * scale, WIN_H * scale),
    };
    let m = 2.0;
    let min_x = wa.left as f64 + m - r0;
    let max_x = wa.right as f64 - m - (r0 + r2);
    let min_y = wa.top as f64 + m - r1;
    let max_y = wa.bottom as f64 - m - (r1 + r3);

    let hwnd = match win.hwnd() {
        Ok(h) => HWND(h.0 as *mut core::ffi::c_void),
        Err(_) => return,
    };

    while left_down() {
        let c = cursor_pos();
        let mut x = c.x as f64 - ox;
        let mut y = c.y as f64 - oy;
        if min_x <= max_x {
            x = x.clamp(min_x, max_x);
        }
        if min_y <= max_y {
            y = y.clamp(min_y, max_y);
        }
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                HWND_TOP,
                x.round() as i32,
                y.round() as i32,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
        std::thread::sleep(Duration::from_millis(4));
    }

    let st = app.state::<State>();
    let mut cfg = st.cfg.lock().unwrap().clone();
    if let Ok(p) = win.outer_position() {
        let mut cx = (p.x as f64 + r0 + r2 / 2.0) / scale;
        let mut bottom = (p.y as f64 + r1 + r3) / scale;
        let mut nx = p.x;
        let mut ny = p.y;
        /* 贴边：靠近工作区四边就吸附。阈值按「她的边缘到屏幕边缘」算，
           而不是中心点——否则边界夹紧先把人挡住了，条件永远不成立 */
        if cfg.snap_to_edge {
            const SNAP: f64 = 200.0;
            let wa = work_area();
            let (wal, war) = (wa.left as f64 / scale, wa.right as f64 / scale);
            let (wat, wab) = (wa.top as f64 / scale, wa.bottom as f64 / scale);
            let half = r2 / 2.0 / scale;
            let hh = r3 / scale;

            let gap_l = (cx - half) - wal;
            let gap_r = war - (cx + half);
            if gap_l < SNAP && gap_l <= gap_r {
                cx = wal + half;
                nx = ((cx * scale) - r0 - half * scale).round() as i32;
            } else if gap_r < SNAP {
                cx = war - half;
                nx = ((cx * scale) - r0 - half * scale).round() as i32;
            }

            let gap_t = (bottom - hh) - wat;
            let gap_b = wab - bottom;
            if gap_t < SNAP && gap_t <= gap_b {
                bottom = wat + hh;
                ny = ((bottom * scale) - r1 - r3).round() as i32;
            } else if gap_b < SNAP {
                bottom = wab;
                ny = ((bottom * scale) - r1 - r3).round() as i32;
            }
        }
        let _ = win.set_position(tauri::PhysicalPosition::new(nx, ny));
        cfg.pos = Some(Pos { x: cx, y: bottom });
        save_config(&app, &cfg);
        *st.cfg.lock().unwrap() = cfg;
    }
    st.dragging.store(false, Ordering::SeqCst);
    let _ = app.emit("pet:drag-end", json!({}));
}

/* ------------------------------- 菜单 ------------------------------- */

fn build_menu(app: &tauri::AppHandle, cfg: &Config) -> tauri::Result<Menu<Wry>> {
    let mut act_items: Vec<MenuItem<Wry>> = Vec::new();
    for (id, label) in ACTIONS {
        act_items.push(MenuItem::with_id(
            app,
            format!("act:{}", id),
            *label,
            true,
            None::<&str>,
        )?);
    }
    let act_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = act_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>)
        .collect();
    let actions = Submenu::with_items(app, "动作", true, &act_refs)?;

    let m_auto = CheckMenuItem::with_id(app, "mode:auto", "自动（Flash/Pro）", true, cfg.mode == "auto", None::<&str>)?;
    let m_flash = CheckMenuItem::with_id(app, "mode:chibi", "固定 Flash", true, cfg.mode == "chibi", None::<&str>)?;
    let m_pro = CheckMenuItem::with_id(app, "mode:normal", "固定 Pro", true, cfg.mode == "normal", None::<&str>)?;
    let shape = Submenu::with_items(app, "形象", true, &[&m_auto, &m_flash, &m_pro])?;

    let mut iv_items: Vec<CheckMenuItem<Wry>> = Vec::new();
    for (sec, label) in INTERVALS {
        iv_items.push(CheckMenuItem::with_id(
            app,
            format!("sw:{}", sec),
            *label,
            cfg.mode == "auto",
            cfg.switch_seconds == *sec,
            None::<&str>,
        )?);
    }
    let iv_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = iv_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>)
        .collect();
    let interval = Submenu::with_items(app, "空闲切换间隔", true, &iv_refs)?;

    let mut sz_items: Vec<MenuItem<Wry>> = Vec::new();
    for pct in SIZES {
        sz_items.push(MenuItem::with_id(
            app,
            format!("sz:{}", pct),
            format!("{}%", pct),
            true,
            None::<&str>,
        )?);
    }
    let sz_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = sz_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>)
        .collect();
    let size = Submenu::with_items(app, "大小（当前形象）", true, &sz_refs)?;

    let top = CheckMenuItem::with_id(app, "top", "始终置顶", true, cfg.always_on_top, None::<&str>)?;
    let snap = CheckMenuItem::with_id(app, "snap", "松手贴边", true, cfg.snap_to_edge, None::<&str>)?;
    let auto = CheckMenuItem::with_id(app, "autostart", "开机自启", true, cfg.autostart, None::<&str>)?;

    let show = MenuItem::with_id(app, "toggle_pet", "显示/隐藏桌宠", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "刷新积分", true, None::<&str>)?;
    let shortcut = MenuItem::with_id(app, "shortcut", "创建桌面快捷方式", true, None::<&str>)?;
    let readme = MenuItem::with_id(app, "readme", "打开说明", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出桌宠", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &actions,
            &shape,
            &interval,
            &size,
            &PredefinedMenuItem::separator(app)?,
            &top,
            &snap,
            &auto,
            &PredefinedMenuItem::separator(app)?,
            &refresh,
            &shortcut,
            &readme,
            &PredefinedMenuItem::separator(app)?,
            &show,
            &quit,
        ],
    )
}

fn refresh_tray(app: &tauri::AppHandle) {
    let cfg = app.state::<State>().cfg.lock().unwrap().clone();
    if let Ok(menu) = build_menu(app, &cfg) {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/* ------------------------------- 命令 ------------------------------- */

#[tauri::command]
fn trace(app: tauri::AppHandle, msg: String) {
    let p = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("trace.log");
    let line = format!("{}\n", msg);
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
        let _ = f.write_all(line.as_bytes());
    }
}

#[tauri::command]
fn set_interactive(state: tauri::State<State>, on: bool) {
    state.force_hit.store(on, Ordering::SeqCst);
}

#[tauri::command]
fn set_top(app: tauri::AppHandle, state: tauri::State<State>, on: bool) {
    let mut cfg = state.cfg.lock().unwrap().clone();
    cfg.always_on_top = on;
    save_config(&app, &cfg);
    *state.cfg.lock().unwrap() = cfg.clone();
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(on);
    }
    let _ = app.emit("config", cfg);
    refresh_tray(&app);
}

#[tauri::command]
fn set_snap(app: tauri::AppHandle, state: tauri::State<State>, on: bool) {
    let mut cfg = state.cfg.lock().unwrap().clone();
    cfg.snap_to_edge = on;
    save_config(&app, &cfg);
    *state.cfg.lock().unwrap() = cfg.clone();
    let _ = app.emit("config", cfg);
    refresh_tray(&app);
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, state: tauri::State<State>, on: bool) {
    let al = app.autolaunch();
    let _ = if on { al.enable() } else { al.disable() };
    let mut cfg = state.cfg.lock().unwrap().clone();
    cfg.autostart = on;
    save_config(&app, &cfg);
    *state.cfg.lock().unwrap() = cfg.clone();
    let _ = app.emit("config", cfg);
    refresh_tray(&app);
}

#[tauri::command]
fn make_shortcut(app: tauri::AppHandle) {
    if let Ok(exe) = std::env::current_exe() {
        let ps = format!(
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\鲸鱼娘.lnk');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Save()",
            exe.display(),
            exe.parent().map(|d| d.display().to_string()).unwrap_or_default()
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    let _ = app;
}

#[tauri::command]
fn init_info(state: tauri::State<State>) -> serde_json::Value {
    json!({ "config": state.cfg.lock().unwrap().clone() })
}

#[tauri::command]
fn report_state(app: tauri::AppHandle, state: tauri::State<State>, st: serde_json::Value) {
    /* 窗口尺寸跟着页面实际视口走：DPI 缩放下 inner_size 和 CSS 像素不一致，
       窗口会比页面高，导致她不在窗口底部、命中坐标也全错 */
    /* 记录「窗口物理像素 / 页面 CSS 像素」的真实比例。
       DPI 缩放时 process 报的 scale_factor 不可靠，用页面视口算最稳。 */
    let dpr = st.get("dpr").and_then(|v| v.as_f64()).unwrap_or(1.0);
    let mut hit = state.hit.lock().unwrap();
    if dpr.is_finite() && dpr > 0.3 && dpr < 4.0 {
        hit.ratio = dpr;
    }
    /* 窗口按 CSS 设计尺寸 * DPI 摆正一次：否则页面视口比设计窄，
       气泡外阴影会被窗口边界裁出一条硬边 */
    if !SIZE_FIXED.swap(true, Ordering::SeqCst) {
        if dpr.is_finite() && (dpr - 1.0).abs() > 0.02 {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_size(tauri::PhysicalSize::new(
                    (WIN_W * dpr).round() as u32,
                    (WIN_H * dpr).round() as u32,
                ));
                /* 改尺寸后按锚点（脚底中点）重新摆位，避免启动时跳一下 */
                if let Some(pos) = state.cfg.lock().unwrap().pos.clone() {
                    let wa = work_area();
                    let ww = (WIN_W * dpr).round() as i32;
                    let wh = (WIN_H * dpr).round() as i32;
                    let mut nx = (pos.x * dpr - ww as f64 / 2.0).round() as i32;
                    let mut ny = (pos.y * dpr - wh as f64).round() as i32;
                    nx = nx.clamp(wa.left + 2, (wa.right - ww - 2).max(wa.left + 2));
                    ny = ny.clamp(wa.top + 2, (wa.bottom - wh - 2).max(wa.top + 2));
                    let _ = w.set_position(tauri::PhysicalPosition::new(nx, ny));
                }
            }
        }
    }
    if let Some(r) = st.get("rect").and_then(|v| v.as_array()) {
        if r.len() == 4 {
            hit.rect = Some([
                r[0].as_f64().unwrap_or(0.0),
                r[1].as_f64().unwrap_or(0.0),
                r[2].as_f64().unwrap_or(0.0),
                r[3].as_f64().unwrap_or(0.0),
            ]);
        }
    }
    hit.menu = st.get("menu").and_then(|v| v.as_array()).and_then(|b| {
        if b.len() == 4 {
            Some([
                b[0].as_f64().unwrap_or(0.0),
                b[1].as_f64().unwrap_or(0.0),
                b[2].as_f64().unwrap_or(0.0),
                b[3].as_f64().unwrap_or(0.0),
            ])
        } else {
            None
        }
    });
    hit.bubble = st
        .get("bubble")
        .and_then(|v| v.as_array())
        .and_then(|b| {
            if b.len() == 4 {
                Some([
                    b[0].as_f64().unwrap_or(0.0),
                    b[1].as_f64().unwrap_or(0.0),
                    b[2].as_f64().unwrap_or(0.0),
                    b[3].as_f64().unwrap_or(0.0),
                ])
            } else {
                None
            }
        });
    if let Some(m) = st.get("mask").and_then(|v| v.as_array()) {
        hit.mask = m.iter().map(|x| x.as_u64().unwrap_or(0) as u8).collect();
        hit.mw = st.get("mw").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        hit.mh = st.get("mh").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    }
}

#[tauri::command]
fn start_drag(app: tauri::AppHandle, state: tauri::State<State>, win: tauri::WebviewWindow) {
    if state.dragging.swap(true, Ordering::SeqCst) {
        return;
    }
    let rect = state.hit.lock().unwrap().rect;
    std::thread::spawn(move || run_drag(app, win, rect));
}

#[tauri::command]
fn refresh_probe(app: tauri::AppHandle, state: tauri::State<State>) {
    let cfg = state.cfg.lock().unwrap().clone();
    let app2 = app.clone();
    std::thread::spawn(move || match probe(&app, &cfg) {
        Ok(v) => {
            let _ = app2.emit("probe:data", v);
        }
        Err(e) => {
            let _ = app2.emit("probe:error", e);
        }
    });
}

fn probe(app: &tauri::AppHandle, cfg: &Config) -> Result<serde_json::Value, String> {
    let mut bases: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(p) = app.path().resource_dir() {
        bases.push(p.join("engine"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            bases.push(d.join("engine"));
        }
    }
    bases.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join("engine"),
    );
    let base = bases
        .into_iter()
        .find(|p| p.exists())
        .ok_or("找不到 engine 目录")?;
    let script = base.join("credit_probe.py");
    let py = if cfg.python.is_empty() {
        "python".to_string()
    } else {
        cfg.python.clone()
    };
    let mut cmd = std::process::Command::new(py);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.arg(script);
    if !cfg.remote {
        cmd.arg("--no-remote");
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    let txt = String::from_utf8_lossy(&out.stdout).to_string();
    serde_json::from_str::<serde_json::Value>(txt.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_mode(app: tauri::AppHandle, state: tauri::State<State>, mode: String) {
    let mut cfg = state.cfg.lock().unwrap().clone();
    cfg.mode = mode;
    save_config(&app, &cfg);
    *state.cfg.lock().unwrap() = cfg.clone();
    let _ = app.emit("config", cfg);
    refresh_tray(&app);
}

fn clamp_with(app: &tauri::AppHandle, win: &tauri::WebviewWindow, p: tauri::PhysicalPosition<i32>, k: f64, r: [f64; 4]) {
    let st = app.state::<State>();
    let wa = work_area();
    let mut l = p.x as f64 + r[0] * k;
    let mut t = p.y as f64 + r[1] * k;
    let w = r[2] * k;
    let h = r[3] * k;
    let mut nx = p.x;
    let mut ny = p.y;
    if l < wa.left as f64 + 2.0 {
        nx += (wa.left as f64 + 2.0 - l) as i32;
        l = wa.left as f64 + 2.0;
    }
    if l + w > wa.right as f64 - 2.0 {
        nx -= ((l + w) - (wa.right as f64 - 2.0)) as i32;
    }
    if t < wa.top as f64 + 2.0 {
        ny += (wa.top as f64 + 2.0 - t) as i32;
        t = wa.top as f64 + 2.0;
    }
    if t + h > wa.bottom as f64 - 2.0 {
        ny -= ((t + h) - (wa.bottom as f64 - 2.0)) as i32;
    }
    tlog(app, format!("clamp l={:.0} t={:.0} w={:.0} h={:.0} win=({},{}) -> ({},{})", l, t, w, h, p.x, p.y, nx, ny));
    if nx != p.x || ny != p.y {
        let _ = win.set_position(tauri::PhysicalPosition::new(nx, ny));
        let mut cfg = st.cfg.lock().unwrap().clone();
        cfg.pos = Some(Pos {
            x: (nx as f64 + r[0] * k + w / 2.0) / k,
            y: (ny as f64 + r[1] * k + h) / k,
        });
        save_config(app, &cfg);
        *st.cfg.lock().unwrap() = cfg;
    }
}

#[tauri::command]
fn set_scale(app: tauri::AppHandle, state: tauri::State<State>, form: String, scale: f64) {
    let mut cfg = state.cfg.lock().unwrap().clone();
    let v = scale.clamp(0.5, 2.0);
    match form.as_str() {
        "normal" => cfg.scale_by_form.normal = v,
        _ => cfg.scale_by_form.chibi = v,
    }
    cfg.scale = v;
    save_config(&app, &cfg);
    *state.cfg.lock().unwrap() = cfg.clone();
    let _ = app.emit("config", cfg);
}

#[tauri::command]
fn set_switch(app: tauri::AppHandle, state: tauri::State<State>, sec: u32) {
    let mut cfg = state.cfg.lock().unwrap().clone();
    cfg.switch_seconds = sec;
    save_config(&app, &cfg);
    *state.cfg.lock().unwrap() = cfg.clone();
    let _ = app.emit("config", cfg);
    refresh_tray(&app);
}

#[tauri::command]
fn show_menu(app: tauri::AppHandle) {
    let cfg = app.state::<State>().cfg.lock().unwrap().clone();
    if let Ok(menu) = build_menu(&app, &cfg) {
        if let Some(w) = app.get_window("main") {
            let _ = menu.popup(w);
        }
    }
}

#[tauri::command]
fn open_readme(app: tauri::AppHandle) {
    let mut cands: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            cands.push(d.join("README.md"));
        }
    }
    cands.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join("README.md"),
    );
    if let Some(p) = cands.into_iter().find(|p| p.exists()) {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", &p.to_string_lossy()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    let _ = app;
}

static MENU_ANCHOR: Mutex<(i32, i32)> = Mutex::new((0, 0));

#[tauri::command]
fn open_menu(app: tauri::AppHandle, cx: f64, cy: f64) {
    let Some(main) = app.get_webview_window("main") else { return };
    let k = main.scale_factor().unwrap_or(1.0);
    let Ok(p) = main.outer_position() else { return };
    let sx = p.x + (cx * k) as i32;
    let sy = p.y + (cy * k) as i32;
    if let Ok(mut a) = MENU_ANCHOR.lock() {
        *a = (sx, sy);
    }
    if let Some(mw) = app.get_webview_window("menu") {
        /* 菜单窗口的尺寸要按真实缩放换算成物理像素，否则高 DPI 下视口会窄一截，
           两栏放不下、子菜单被裁成直角 */
        let kk = {
            let st = app.state::<State>();
            let h = st.hit.lock().unwrap();
            if h.ratio > 0.3 {
                h.ratio
            } else {
                k
            }
        };
        let _ = mw.set_size(tauri::PhysicalSize::new(
            (MENU_W * kk).round() as u32,
            (MENU_H * kk).round() as u32,
        ));
        place_menu(&mw, sx, sy);
        let _ = mw.show();
        let _ = mw.set_focus();
    }
}

fn place_menu(win: &tauri::WebviewWindow, sx: i32, sy: i32) {
    let wa = work_area();
    let Ok(sz) = win.inner_size() else { return };
    let (w, h) = (sz.width as i32, sz.height as i32);
    let mut x = sx + 4;
    let mut y = sy + 4;
    if x + w > wa.right - 8 {
        x = (sx - w - 4).max(wa.left + 8);
    }
    if y + h > wa.bottom - 8 {
        y = (wa.bottom - 8 - h).max(wa.top + 8);
    }
    if y < wa.top + 8 {
        y = wa.top + 8;
    }
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

#[tauri::command]
fn resize_menu(app: tauri::AppHandle, height: f64) {
    let Some(mw) = app.get_webview_window("menu") else { return };
    let k = mw.scale_factor().unwrap_or(1.0);
    let wa = work_area();
    let maxh = (wa.bottom - wa.top - 20) as f64;
    let h = height.clamp(80.0, maxh);
    let _ = mw.set_size(tauri::LogicalSize::new(250.0, h));
    let (sx, sy) = *MENU_ANCHOR.lock().unwrap();
    place_menu(&mw, sx, sy);
    let _ = mw.show();
    let _ = mw.set_focus();
    let _ = k;
}

#[tauri::command]
fn close_menu(app: tauri::AppHandle) {
    if let Some(mw) = app.get_webview_window("menu") {
        let _ = mw.hide();
    }
}

#[tauri::command]
fn run_action(app: tauri::AppHandle, id: String) {
    let _ = app.emit("pet:do-action", id);
}

#[tauri::command]
fn window_metrics(app: tauri::AppHandle) -> serde_json::Value {
    let wa = work_area();
    let mut out = json!({
        "x": 0, "y": 0, "w": 0, "h": 0, "dpr": 1.0,
        "waLeft": wa.left, "waTop": wa.top, "waRight": wa.right, "waBottom": wa.bottom
    });
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(p) = w.outer_position() {
            if let Ok(sz) = w.inner_size() {
                out["x"] = json!(p.x);
                out["y"] = json!(p.y);
                out["w"] = json!(sz.width);
                out["h"] = json!(sz.height);
                out["dpr"] = json!(w.scale_factor().unwrap_or(1.0));
            }
        }
    }
    out
}

#[tauri::command]
fn hide_pet(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn show_pet(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_always_on_top(true);
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/* ------------------------------- 主函数 ------------------------------- */

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(State {
            force_hit: AtomicBool::new(false),
            cfg: Mutex::new(Config::default()),
            hit: Mutex::new(HitInfo::default()),
            ignore: AtomicBool::new(true),
            dragging: AtomicBool::new(false),
        })
        .setup(|app| {
            let cfg = load_config(app.handle());
            {
                let st = app.state::<State>();
                *st.cfg.lock().unwrap() = cfg.clone();
            }
            let wa = work_area();
            let pos = cfg.pos.clone().unwrap_or(Pos {
                x: wa.right as f64 - 150.0,
                y: wa.bottom as f64 - 6.0,
            });
            let wa0 = work_area();
            let pw = (WIN_W * 1.2) as i32; // 先用保守值，拿到 dpr 后会重设
            let x = (pos.x - WIN_W / 2.0).max(wa0.left as f64 + 4.0);
            let y = (pos.y - WIN_H).max(wa0.top as f64 + 4.0);
            let _ = pw;

            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("WhalePet")
                .inner_size(WIN_W, WIN_H)
                .position(x, y)
                .transparent(true)
                .decorations(false)
                .always_on_top(cfg.always_on_top)
                .skip_taskbar(true)
                .resizable(false)
                .focused(false)
                .shadow(false)
                .build()?;
            let _ = win.set_ignore_cursor_events(true);

            let menu_win = WebviewWindowBuilder::new(app, "menu", WebviewUrl::App("menu.html".into()))
                .title("WhalePetMenu")
                .inner_size(384.0, 760.0)
                .transparent(true)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .visible(false)
                .build()?;
            let _ = menu_win.set_ignore_cursor_events(false);
            /* 菜单窗口也不要系统投影，否则面板四周会出现一个矩形边 */
            unsafe {
                if let Ok(h) = menu_win.hwnd() {
                    let hwnd = HWND(h.0 as *mut core::ffi::c_void);
                    let cs = GetClassLongPtrW(hwnd, windows::Win32::UI::WindowsAndMessaging::GCL_STYLE);
                    let _ = SetClassLongPtrW(
                        hwnd,
                        windows::Win32::UI::WindowsAndMessaging::GCL_STYLE,
                        (cs & !(0x0002_0000usize)) as isize,
                    );
                    let none: COLORREF = COLORREF(0xFFFF_FFFE);
                    let _ = DwmSetWindowAttribute(
                        hwnd,
                        DWMWA_BORDER_COLOR,
                        &none as *const _ as *const core::ffi::c_void,
                        std::mem::size_of::<COLORREF>() as u32,
                    );
                    let pref: u32 = 1;
                    let _ = DwmSetWindowAttribute(
                        hwnd,
                        DWMWA_WINDOW_CORNER_PREFERENCE,
                        &pref as *const _ as *const core::ffi::c_void,
                        4,
                    );
                }
            }

            /* 只清掉窗口类的 CS_DROPSHADOW（窗口自身投影）——
               不要动 DWM_NCRENDERING，那条路会把标题栏带回来 */
            unsafe {
                if let Ok(h) = win.hwnd() {
                    let hwnd = HWND(h.0 as *mut core::ffi::c_void);
                    let cs = GetClassLongPtrW(hwnd, windows::Win32::UI::WindowsAndMessaging::GCL_STYLE);
                    let _ = SetClassLongPtrW(
                        hwnd,
                        windows::Win32::UI::WindowsAndMessaging::GCL_STYLE,
                        (cs & !(0x0002_0000usize)) as isize,
                    );
                }
            }
            /* 去掉 Win11 给无边框窗口画的那道 1px 边框 */
            unsafe {
                if let Ok(h) = win.hwnd() {
                    let hwnd = HWND(h.0 as *mut core::ffi::c_void);
                    let none: COLORREF = COLORREF(0xFFFF_FFFE);
                    let _ = DwmSetWindowAttribute(
                        hwnd,
                        DWMWA_BORDER_COLOR,
                        &none as *const _ as *const core::ffi::c_void,
                        std::mem::size_of::<COLORREF>() as u32,
                    );
                    let pref: u32 = 1; // DWMWCP_DONOTROUND
                    let _ = DwmSetWindowAttribute(
                        hwnd,
                        DWMWA_WINDOW_CORNER_PREFERENCE,
                        &pref as *const _ as *const core::ffi::c_void,
                        4,
                    );
                }
            }

            #[cfg(debug_assertions)]
            win.open_devtools();

            let menu = build_menu(app.handle(), &cfg)?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).ok();
            let mut builder = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .tooltip("鲸鱼娘桌宠")
                .show_menu_on_left_click(true);
            if let Some(i) = icon {
                builder = builder.icon(i);
            }
            let menu_handle = app.handle().clone();
            menu_win.on_window_event(move |ev| {
                if let tauri::WindowEvent::Focused(false) = ev {
                    if let Some(mw) = menu_handle.get_webview_window("menu") {
                        let _ = mw.hide();
                    }
                }
            });

            builder
                .on_menu_event(|app, ev| {
                    let id = ev.id.as_ref().to_string();
                    let st = app.state::<State>();
                    if let Some(act) = id.strip_prefix("act:") {
                        let _ = app.emit("pet:do-action", act.to_string());
                        return;
                    }
                    if let Some(m) = id.strip_prefix("mode:") {
                        let mut cfg = st.cfg.lock().unwrap().clone();
                        cfg.mode = m.to_string();
                        save_config(app, &cfg);
                        *st.cfg.lock().unwrap() = cfg.clone();
                        let _ = app.emit("config", cfg);
                        refresh_tray(app);
                        return;
                    }
                    if let Some(s) = id.strip_prefix("sw:") {
                        if let Ok(sec) = s.parse::<u32>() {
                            let mut cfg = st.cfg.lock().unwrap().clone();
                            cfg.switch_seconds = sec;
                            save_config(app, &cfg);
                            *st.cfg.lock().unwrap() = cfg.clone();
                            let _ = app.emit("config", cfg);
                            refresh_tray(app);
                        }
                        return;
                    }
                    if let Some(s) = id.strip_prefix("sz:") {
                        if let Ok(pct) = s.parse::<f64>() {
                            let _ = app.emit("pet:scale-pct", pct / 100.0);
                        }
                        return;
                    }
                    match id.as_str() {
                        "quit" => app.exit(0),
                        "toggle_pet" => {
                            if let Some(w) = app.get_webview_window("main") {
                                if w.is_visible().unwrap_or(true) {
                                    let _ = w.hide();
                                } else {
                                    let _ = w.show();
                                    let _ = w.set_always_on_top(true);
                                }
                            }
                        }
                        "refresh" => {
                            let _ = app.emit("pet:refresh", json!({}));
                        }
                        "readme" => {
                            let h = app.clone();
                            std::thread::spawn(move || open_readme(h));
                        }
                        "shortcut" => {
                            if let Ok(exe) = std::env::current_exe() {
                                let ps = format!(
                                    "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\鲸鱼娘.lnk');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Save()",
                                    exe.display(),
                                    exe.parent().map(|d| d.display().to_string()).unwrap_or_default()
                                );
                                let _ = std::process::Command::new("powershell")
                                    .args(["-NoProfile", "-Command", &ps])
                                    .creation_flags(CREATE_NO_WINDOW)
                                    .spawn();
                            }
                        }
                        "top" => {
                            let mut cfg = st.cfg.lock().unwrap().clone();
                            cfg.always_on_top = !cfg.always_on_top;
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.set_always_on_top(cfg.always_on_top);
                            }
                            save_config(app, &cfg);
                            *st.cfg.lock().unwrap() = cfg;
                            refresh_tray(app);
                        }
                        "snap" => {
                            let mut cfg = st.cfg.lock().unwrap().clone();
                            cfg.snap_to_edge = !cfg.snap_to_edge;
                            save_config(app, &cfg);
                            *st.cfg.lock().unwrap() = cfg;
                            refresh_tray(app);
                        }
                        "autostart" => {
                            let mut cfg = st.cfg.lock().unwrap().clone();
                            let al = app.autolaunch();
                            let now = al.is_enabled().unwrap_or(false);
                            let _ = if now { al.disable() } else { al.enable() };
                            cfg.autostart = !now;
                            save_config(app, &cfg);
                            *st.cfg.lock().unwrap() = cfg;
                            refresh_tray(app);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            /* 自动刷新：客户端开着按 refreshSeconds（默认 120s），没开降到 10 分钟 */
            let h2 = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(600));
                loop {
                    let (cfg, app2) = {
                        let st = h2.state::<State>();
                        let c = st.cfg.lock().unwrap().clone();
                        (c, h2.clone())
                    };
                    match probe(&h2, &cfg) {
                        Ok(v) => {
                            let _ = app2.emit("probe:data", v);
                        }
                        Err(e) => {
                            let _ = app2.emit("probe:error", e);
                        }
                    }
                    let wb = workbuddy_running();
                    let secs = if wb {
                        cfg.refresh_seconds.max(30) as u64
                    } else {
                        (cfg.refresh_seconds.max(30) as u64 * 5).max(600)
                    };
                    std::thread::sleep(Duration::from_secs(secs));
                }
            });

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                let Some(win) = handle.clone().get_webview_window("main") else {
                    tlog(&handle, "hit thread: window not found".into());
                    return;
                };
                tlog(&handle, "hit thread start".into());
                let mut last = true;
                let mut ticks: u64 = 0;
                let mut last_sig: (i64, i64, i64, i64, i64) = (0, 0, 0, 0, 0);
                loop {
                    std::thread::sleep(Duration::from_millis(40));
                    ticks += 1;
                    let st = handle.state::<State>();
                    if st.dragging.load(Ordering::SeqCst) {
                        continue;
                    }
                    let Ok(wp) = win.outer_position() else { continue };
                    let c = cursor_pos();
                    let force = st.force_hit.load(Ordering::SeqCst);
                    let hit = if force {
                        true
                    } else {
                        let h = st.hit.lock().unwrap();
                        let k = if h.ratio > 0.3 { h.ratio } else { win.scale_factor().unwrap_or(1.0) };
                        let lx = (c.x as f64 - wp.x as f64) / k;
                        let ly = (c.y as f64 - wp.y as f64) / k;
                        let mut is = false;
                        if let Some(b) = h.bubble {
                            if lx >= b[0] && lx <= b[0] + b[2] && ly >= b[1] && ly <= b[1] + b[3] {
                                is = true;
                            }
                        }
                        if let Some(m) = h.menu {
                            if lx >= m[0] && lx <= m[0] + m[2] && ly >= m[1] && ly <= m[1] + m[3] {
                                is = true;
                            }
                        }
                        if !is {
                            if let Some(r) = h.rect {
                                if lx >= r[0] && lx <= r[0] + r[2] && ly >= r[1] && ly <= r[1] + r[3]
                                {
                                    if h.mw > 0 && h.mh > 0 {
                                        let u = ((lx - r[0]) / r[2] * h.mw as f64) as usize;
                                        let v = ((ly - r[1]) / r[3] * h.mh as f64) as usize;
                                        let idx = v.min(h.mh as usize - 1) * h.mw as usize
                                            + u.min(h.mw as usize - 1);
                                        is = h.mask.get(idx).copied().unwrap_or(1) > 0;
                                    } else {
                                        is = true;
                                    }
                                }
                            }
                        }
                        is
                    };
                    /* 只有她的尺寸/DPI 变了才重新夹紧（复用这次已经读到的窗口位置），
                       另外每 2 秒兜底一次；平时零额外系统调用 */
                    {
                        let st0 = handle.state::<State>();
                        let dragging = st0.dragging.load(Ordering::SeqCst);
                        let (rect0, k0) = {
                            let h = st0.hit.lock().unwrap();
                            (h.rect, if h.ratio > 0.3 { h.ratio } else { 1.0 })
                        };
                        if let Some(r0) = rect0 {
                            let sig = (
                                (r0[0] * 10.0) as i64,
                                (r0[1] * 10.0) as i64,
                                (r0[2] * 10.0) as i64,
                                (r0[3] * 10.0) as i64,
                                (k0 * 100.0) as i64,
                            );
                            if !dragging && (sig != last_sig || ticks % 50 == 0) {
                                last_sig = sig;
                                clamp_with(&handle, &win, wp, k0, r0);
                            }
                        }
                    }

                    if hit != last {
                        tlog(&handle, format!("hit={}", hit));
                        last = hit;
                        let _ = win.set_ignore_cursor_events(!hit);
                        st.ignore.store(!hit, Ordering::SeqCst);
                        if !hit {
                            let _ = handle.emit("pet:leave", json!({}));
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            trace,
            init_info,
            report_state,
            start_drag,
            refresh_probe,
            set_mode,
            set_scale,
            set_switch,
            set_interactive,
            set_top,
            set_snap,
            set_autostart,
            make_shortcut,
            open_menu,
            close_menu,
            resize_menu,
            run_action,
            window_metrics,
            hide_pet,
            show_pet,
            show_menu,
            open_readme,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

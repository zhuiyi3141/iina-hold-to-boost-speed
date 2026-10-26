//
// Hold to Boost Speed —— IINA 插件（播放器入口）
//
// 长按方向键临时加速，松开恢复原速；短按保留系统默认的快进 / 快退。
//
//   · 长按 →  → 2× 播放，松开恢复原速
//   · 长按 ←  → 3× 播放，松开恢复原速
//   · 短按 →  → 快进 5 秒
//   · 短按 ←  → 快退 5 秒
//
// 倍速 / 快进秒数 / 长按阈值都能在「IINA 设置 → 插件 → Hold to Boost Speed」里改。
//
// ── 为什么需要配套的 input.conf ──────────────────────────────────────────────
// IINA 的 MainWindow.keyDown 第一件事是 `menu?.performKeyEquivalent(with:)`，而菜单项的
// 快捷键来自 PlayerCore.keyBindings。默认 input.conf 有 `RIGHT seek 5` / `LEFT seek -5`，
// IINA 会把它们挂到「回放 → 渐进 5秒 / 渐退 5秒」菜单项的 key equivalent 上（实测
// AXMenuItemCmdChar = 63235 = NSRightArrowFunctionKey）。于是方向键在 NSApplication
// 派发阶段就被菜单吃掉，窗口收不到 keyDown，插件的 onKeyDown 永远不触发
// （keyUp 不走菜单，所以能到 —— 这也是"只有 UP 没有 DOWN"的原因）。
//
// 解决方式：把绑定写成 `RIGHT seek 5 keyframes`。MenuController.sameKeyAction 在比对菜单项时
// 只剥离 `relative` / `exact` 两个 flag，`keyframes` 会被保留，于是不再匹配菜单项
// → 方向键落回窗口 → 插件拿得到 keyDown。
//
// 关键点：`seek 5 keyframes` 本身仍然是一条正常的 seek 绑定，行为与 `seek 5` 等价
// （mpv 的 seek 默认就按关键帧跳转，源码注释亦如此说明）。所以：
//
//   >>> 关掉本插件后，方向键会自动回到 IINA 原装的快进 / 快退，无需改回任何配置。 <<<
//
// ── 另一个坑 ────────────────────────────────────────────────────────────────
// 绝对不要在插件加载期间调用 iina.menu.forceUpdate()——它会在
// MenuController.updatePluginMenu() 里重入 libdispatch 的 once 锁，直接 SIGTRAP 崩溃。
//

const { core, input, mpv, event, console } = iina;

// ---------------------------------------------------------------------------
// 诊断日志：写到插件自己的 @tmp 目录（不需要额外权限）。每次加载覆盖写。
// ---------------------------------------------------------------------------
let DBG = "";
function dbg(msg) {
  DBG += new Date().toISOString().slice(11, 23) + " " + msg + "\n";
  if (DBG.length > 20000) DBG = DBG.slice(-16000);
  try { iina.file.write("@tmp/debug.log", DBG); } catch (_) {}
  try { console.log("[hold-speed] " + msg); } catch (_) {}
}

// 每个触发键：mpv 键名、方向、对应的偏好项、兜底倍速
const KEYS = [
  { key: "RIGHT", dir: +1, speedPref: "rightSpeed", defaultSpeed: 2.0 },
  { key: "LEFT", dir: -1, speedPref: "leftSpeed", defaultSpeed: 3.0 },
];

function pref(key, fallback) {
  try {
    const v = iina.preferences.get(key);
    return (v === undefined || v === null) ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

const seekSeconds = () => Math.max(0, Number(pref("seekSeconds", 5)) || 0);
const longMs = () => Math.max(60, Number(pref("longMs", 250)) || 250);
const speedFor = (cfg) => {
  const n = Number(pref(cfg.speedPref, cfg.defaultSpeed));
  return (isFinite(n) && n > 0) ? n : cfg.defaultSpeed;
};

function currentSpeed() {
  try {
    const n = Number(mpv.getNumber("speed"));
    return (isFinite(n) && n > 0) ? n : 1.0;
  } catch (_) {
    return 1.0;
  }
}

const pending = new Map(); // key -> 长按判定定时器
let active = null;         // { key, prev, applied } 当前正在加速的键

function osd(msg) {
  try { core.osd(msg); } catch (_) {}
}

function startBoost(cfg) {
  const speed = speedFor(cfg);
  const prev = currentSpeed();
  active = { key: cfg.key, prev, applied: speed };
  core.setSpeed(speed);
  // 不额外发 OSD：IINA 的 PlayerCore.speedChanged 已经会显示「速度: Nx」
  dbg("boost " + cfg.key + " -> " + speed + "x (prev " + prev + ")");
}

function restoreSpeed() {
  if (!active) return;
  const { key, prev, applied } = active;
  active = null;
  const now = currentSpeed();
  // 长按期间用户自己用快捷键改过速度 → 以用户的为准，不要覆盖回旧值
  if (Math.abs(now - applied) > 1e-6) {
    dbg("restore " + key + " skipped (speed changed by user: " + now + ")");
    return;
  }
  core.setSpeed(prev);
  dbg("restore " + key + " -> " + prev + "x");
}

function resetAll() {
  pending.forEach((t) => clearTimeout(t));
  pending.clear();
  // 先恢复速度再清状态：否则换片后 mpv 的 speed 会一直卡在加速值上
  restoreSpeed();
}

function onDown(cfg, data) {
  const isRepeat = !!(data && data.isRepeat);
  dbg("DOWN " + cfg.key + " isRepeat=" + isRepeat +
      " pending=" + pending.has(cfg.key) + " active=" + (active ? active.key : "none"));
  if (isRepeat) return true;                          // 自动重复，吞掉
  if (pending.has(cfg.key)) return true;              // 正在判定长按
  if (active && active.key === cfg.key) return true;  // 已经在加速

  // 另一个键正加速中 → 先恢复，再按本次按键重新计时
  if (active) restoreSpeed();

  const timer = setTimeout(() => {
    pending.delete(cfg.key);
    startBoost(cfg);
  }, longMs());
  pending.set(cfg.key, timer);
  return true; // 消费 keyDown，屏蔽 mpv 默认的 immediate seek
}

function onUp(cfg) {
  const timer = pending.get(cfg.key);
  const wasShortPress = timer !== undefined;
  dbg("UP " + cfg.key + " pending=" + wasShortPress + " active=" + (active ? active.key : "none"));
  if (wasShortPress) {
    clearTimeout(timer);
    pending.delete(cfg.key);
  }

  if (active && active.key === cfg.key) {
    restoreSpeed();
    return true;
  }

  // 短按：keyDown 已被本插件吃掉，这里补上 IINA 默认的 seek 行为
  if (wasShortPress) {
    const secs = seekSeconds();
    dbg("short press seek " + (secs * cfg.dir));
    if (secs > 0) core.seek(secs * cfg.dir, false);
  }
  return true;
}

// ---------------------------------------------------------------------------
// 启动：探测 API + 检查输入配置是否会把方向键交给菜单，再注册监听
// ---------------------------------------------------------------------------
dbg("=== session start ===");
dbg("input type=" + (typeof input) +
    " PRIORITY_HIGH=" + (input && input.PRIORITY_HIGH) +
    " PRIORITY_LOW=" + (input && input.PRIORITY_LOW));

// 只有「不带 keyframes flag 的裸 seek」才会被挂到菜单项上，从而抢走 keyDown。
// `seek 5 keyframes` 是安全写法：仍在 keyBindings 里，但菜单项不匹配 → keyDown 到窗口。
const BARE_SEEK = /^seek\s+-?\d+(\.\d+)?$/;

function menuStealsKey(action) {
  if (!action) return false;
  const a = String(action).trim();
  if (!BARE_SEEK.test(a)) return false;
  // 菜单项只覆盖 5~60 秒的跳转；其他秒数不会匹配到菜单
  const n = Math.abs(parseFloat(a.split(/\s+/)[1]));
  return n >= 5 && n <= 60;
}

let badConfig = [];
try {
  const kb = input.getAllKeyBindings() || {};
  badConfig = KEYS.filter((c) => {
    const b = kb[c.key];
    return b && menuStealsKey(b.action);
  }).map((c) => c.key);
  dbg("bindings=" + Object.keys(kb).length +
      " stolenByMenu=" + JSON.stringify(badConfig) +
      " actions=" + JSON.stringify(KEYS.map((c) => (kb[c.key] ? kb[c.key].action : null))));
} catch (e) {
  dbg("binding probe failed: " + e);
}

try {
  KEYS.forEach((cfg) => {
    input.onKeyDown(cfg.key, (data) => onDown(cfg, data), input.PRIORITY_HIGH);
    input.onKeyUp(cfg.key, () => onUp(cfg), input.PRIORITY_HIGH);
    dbg("registered " + cfg.key);
  });
} catch (e) {
  dbg("REGISTER FAILED: " + e);
}

// 换片 / 关窗时复位，避免倍速卡在加速状态
try {
  event.on("iina.file-loaded", () => {
    resetAll();
    // 加载期发 OSD 不一定能显示，换片后再提示（只提示一次）
    if (badConfig.length > 0) {
      osd("Hold to Boost Speed: 请在「快捷键 → 输入配置」选择 holdspeed 后重启 IINA");
      dbg("WARN menu steals " + JSON.stringify(badConfig));
      badConfig = [];
    }
  });
  event.on("iina.window-will-close", resetAll);
} catch (_) {}

// 把实际生效的配置打进日志，便于确认偏好是否真的被读到
dbg("effective: " + KEYS.map((c) => c.key + "=" + speedFor(c) + "x").join(" ") +
    " seek=" + seekSeconds() + "s longMs=" + longMs());
dbg("ready. speed=" + currentSpeed());

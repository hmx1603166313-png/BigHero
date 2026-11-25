'use strict';

const { ipcRenderer, webFrame } = require('electron');

// 在主世界执行：伪装页面始终处于前台可见状态，并按主进程指令动态切换 rAF 帧率（前台 60fps / 后台降帧保活）
const MAIN_WORLD_INJECT = `
(function () {
  'use strict';
  if (window.__gbPcPatched) return;
  try {
    Object.defineProperty(window, '__gbPcPatched', { value: true, enumerable: false });
  } catch (_) {
    window.__gbPcPatched = true;
  }

  function defGetter(obj, prop, getter) {
    try {
      Object.defineProperty(obj, prop, { configurable: true, enumerable: true, get: getter });
    } catch (_) {}
  }

  // 1. Page Visibility / Focus 伪装
  var DP = window.Document && Document.prototype;
  if (DP) {
    defGetter(DP, 'hidden', function () { return false; });
    defGetter(DP, 'visibilityState', function () { return 'visible'; });
    defGetter(DP, 'webkitHidden', function () { return false; });
    defGetter(DP, 'webkitVisibilityState', function () { return 'visible'; });
    try {
      Object.defineProperty(DP, 'hasFocus', {
        configurable: true,
        writable: true,
        value: function hasFocus() { return true; }
      });
    } catch (_) {}
  }

  // 2. 捕获阶段拦截切后台事件，游戏感知不到标签切换或窗口最小化
  var stopper = function (e) { e.stopImmediatePropagation(); };
  ['visibilitychange', 'webkitvisibilitychange', 'freeze'].forEach(function (type) {
    window.addEventListener(type, stopper, true);
    document.addEventListener(type, stopper, true);
  });
  window.addEventListener('blur', function (e) {
    if (e.target === window) e.stopImmediatePropagation();
  }, true);

  // 3. 动态 rAF 节流器：bgFps === 0 时走原生 60fps；bgFps > 0 时用 setTimeout 按低帧率保活
  var bgFps = 0;
  window.__gbSetBgFps = function (fps) {
    bgFps = Number(fps) > 0 ? Number(fps) : 0;
  };

  if (typeof window.requestAnimationFrame === 'function') {
    var nativeRAF = window.requestAnimationFrame.bind(window);
    var nativeCAF = window.cancelAnimationFrame.bind(window);
    var seq = 0;
    var pending = new Map();
    var lastBgTick = 0;

    var wrappedRAF = function requestAnimationFrame(cb) {
      if (typeof cb !== 'function') return nativeRAF(cb);
      var id = ++seq;
      if (bgFps <= 0) {
        var rId = nativeRAF(function (ts) {
          pending.delete(id);
          cb(ts);
        });
        pending.set(id, { type: 'r', handle: rId });
      } else {
        var interval = Math.max(16, Math.round(1000 / bgFps));
        var now = performance.now();
        var wait = Math.max(0, interval - (now - lastBgTick));
        var tId = setTimeout(function () {
          pending.delete(id);
          lastBgTick = performance.now();
          cb(lastBgTick);
        }, wait);
        pending.set(id, { type: 't', handle: tId });
      }
      return id;
    };

    var wrappedCAF = function cancelAnimationFrame(id) {
      var item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      if (item.type === 'r') nativeCAF(item.handle);
      else clearTimeout(item.handle);
    };

    window.requestAnimationFrame = wrappedRAF;
    window.cancelAnimationFrame = wrappedCAF;
    try {
      window.webkitRequestAnimationFrame = wrappedRAF;
      window.webkitCancelAnimationFrame = wrappedCAF;
    } catch (_) {}
  }
})();
`;

try {
  webFrame.executeJavaScript(MAIN_WORLD_INJECT).catch(() => {});
} catch (_) {}

ipcRenderer.on('gb:bg-fps', (_event, fps) => {
  const safeFps = Number(fps) > 0 ? Number(fps) : 0;
  try {
    webFrame.executeJavaScript(`window.__gbSetBgFps && window.__gbSetBgFps(${safeFps});`).catch(() => {});
  } catch (_) {}
});

// 任意宫格内鼠标点击即通知主进程切换焦点与音频归属
window.addEventListener('mousedown', () => {
  try {
    ipcRenderer.send('gb:view-clicked');
  } catch (_) {}
}, true);

// 注入现代 Chrome 风格细滚动条样式（含内嵌游戏 iframe）
const SCROLLBAR_STYLE_ID = '__gb_chrome_scrollbar';
const SCROLLBAR_CSS = `
  ::-webkit-scrollbar {
    width: 8px !important;
    height: 8px !important;
    background: transparent !important;
  }
  ::-webkit-scrollbar-track,
  ::-webkit-scrollbar-corner {
    background: transparent !important;
  }
  ::-webkit-scrollbar-button {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
  ::-webkit-scrollbar-thumb {
    background-color: rgba(154, 160, 166, 0.35) !important;
    border-radius: 999px !important;
    border: 2px solid transparent !important;
    background-clip: content-box !important;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: rgba(154, 160, 166, 0.62) !important;
  }
  ::-webkit-scrollbar-thumb:active {
    background-color: rgba(154, 160, 166, 0.8) !important;
  }
`;

function injectScrollbarStyle() {
  try {
    if (!document.head && !document.documentElement) return;
    if (document.getElementById(SCROLLBAR_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SCROLLBAR_STYLE_ID;
    style.textContent = SCROLLBAR_CSS;
    (document.head || document.documentElement).appendChild(style);
  } catch (_) {}
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', injectScrollbarStyle, { once: true });
} else {
  injectScrollbarStyle();
}

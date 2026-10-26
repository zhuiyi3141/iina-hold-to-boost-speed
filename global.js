// 全局入口（global）—— IINA 1.4 起，播放器插件需要 entry + globalEntry 才会被挂到播放窗口。
// 这里不做任何界面改动，只在加载时打一行日志。
try { iina.console.log("Hold-to-Boost: global 入口已加载"); } catch (_) {}
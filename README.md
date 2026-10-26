# Hold to Boost Speed

> 长按方向键临时加速，松开立刻回到原速 —— 专为 IINA 打造。

[![IINA](https://img.shields.io/badge/IINA-%E2%89%A51.4-blue)](https://iina.io)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-%E2%89%A511-lightgrey)](https://www.apple.com/macos/)

---

## 这是什么

看网课、看讲座时最常见的两个需求：**跳过废话** 和 **听不懂的地方慢放**。
IINA 自带的方向键只能固定 ±5 秒跳转，倍速得用 `⌘]` 手动调、再手动调回来。

这个插件把它变成"像按住快进键一样自然"：

| 操作 | 效果 |
| --- | --- |
| **长按 `→`** | 以 **2×** 播放，**松开立刻恢复原速** |
| **长按 `←`** | 以 **3×** 播放，**松开立刻恢复原速** |
| **短按 `→`** | 快进 5 秒（和 IINA 原装完全一样） |
| **短按 `←`** | 快退 5 秒（和 IINA 原装完全一样） |

- 倍速、快进秒数、长按阈值全部可在设置里改，不用改代码。
- 松开时**回到按之前的那个速度**，而不是硬编码回 1×：你本来用 1.5× 看，长按加速后松开仍然是 1.5×。
- 加速期间如果你自己用 `⌘]` / `⌘\` 改了速度，插件**不会**覆盖你的选择。

## 安装

### 方式一：下载发布包（推荐）

1. 到 [Releases](../../releases) 下载最新的 `hold-to-boost-speed-x.y.z.iinaplgz`
2. 打开 IINA → 菜单栏 **插件 → 显示插件面板**
3. 点 **安装本地插件…**，选中刚下载的文件
4. 按下面的「**必做：安装配套输入配置**」操作一次

### 方式二：从源码

```bash
git clone https://github.com/zhuiyi3141/iina-hold-to-boost-speed.git
cd iina-hold-to-boost-speed
/Applications/IINA.app/Contents/MacOS/iina-plugin link .
```

改完代码要**重启 IINA** 才生效（插件不热重载）。

## 必做：安装配套输入配置

> ⚠️ 不做这一步，插件**不会工作**，而且不会有任何报错。这是本插件唯一需要手动操作的地方。

```bash
cp input.conf ~/Library/Application\ Support/com.colliderli.iina/input_conf/holdspeed.conf
defaults write com.colliderli.iina currentInputConfigName -string "holdspeed"
```

然后**重启 IINA**。

也可以手动操作：IINA → 设置 → 快捷键 → 输入配置 → 选择 `holdspeed`。

### 为什么需要它

IINA 的键盘事件流程里，`MainWindow.keyDown` 的**第一件事**是：

```swift
if menu?.performKeyEquivalent(with: event) == true { return }
```

而菜单项的快捷键来自 `PlayerCore.keyBindings`。IINA 默认配置里有 `RIGHT seek 5`，它会被 `MenuController.updateKeyEquivalentsFrom()` 挂到「回放 → 渐进 5 秒」菜单项上（实测 `AXMenuItemCmdChar = 63235 = NSRightArrowFunctionKey`）。

结果就是：**按方向键时，事件在 `NSApplication` 派发阶段就被菜单抢走，播放窗口根本收不到 `keyDown`**。而 `keyUp` 不走菜单，所以能到窗口 —— 这会造成"只有松开事件、没有按下事件"的诡异现象，插件的 `onKeyDown` 永远是死的。

### 解决办法

配套的 `input.conf` 只把两行改动了：

```diff
- RIGHT seek  5
- LEFT  seek -5
+ RIGHT seek 5 keyframes
+ LEFT  seek -5 keyframes
```

`MenuController.sameKeyAction()` 在比对菜单项时会**剥掉 `relative` 和 `exact` 两个 flag**，但 `keyframes` 会被保留：

```swift
if let index = splitArray.firstIndex(of: "relative") {
  splitArray.remove(at: index)   // mpv 默认就是 relative，比对时忽略
}
```

于是 `seek 5 keyframes` 不再匹配「渐进 5 秒」菜单项 → 方向键落回窗口 → 插件拿到 `keyDown`。

> 顺带一提，如果你试过 `seek 5 relative`，它**不管用** —— 正因为 `relative` 会被剥掉，照样匹配上菜单项。

### 关掉插件会怎样？

**方向键会自动回到 IINA 原装的快进 / 快退，不需要改回任何配置。**

因为 `seek 5 keyframes` 本身就是一条**正常的 seek 绑定**，行为与 `seek 5` 完全等价（mpv 的 seek 默认就按关键帧跳转 —— IINA 源码注释里也这么写：*"the mpv seek command normally defaults to seeking by keyframes"*）。

插件只是"叠加"在原生行为之上，禁用后不留下任何副作用。你可以放心开关试。

## 设置项

IINA → 设置 → 插件 → Hold to Boost Speed → 简介（ⓘ 图标）

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| 长按 `→` 时的倍速 | `2.0` | 范围 1–8 |
| 长按 `←` 时的倍速 | `3.0` | 范围 1–8 |
| 短按快进秒数 | `5` | 与 IINA 原生一致 |
| 长按判定阈值（毫秒） | `250` | 按下超过这个时间才算长按 |

`250ms` 是个比较舒服的值：低于它松手算短按（跳转），高于它算长按（加速）。嫌容易误触发就调大。

## 兼容性

- IINA **1.4 及以上**（用到了 `iina.input.onKeyDown` / `onKeyUp` API，1.3 没有）
- macOS 11+
- 几乎不耗资源：只有按键事件触发时才执行，没有轮询、没有定时器空转

已知情况：
- **全屏和普通窗口都可用**，不用切窗口。
- 如果方向键被其他插件/菜单抢占，插件会在换片时用 OSD 提醒你。

## 排查

插件会把诊断信息写到：

```
$TMPDIR/iina-com.zhuiyi3141.iina.hold-speed/debug.log
```

正常加载时应该长这样：

```
=== session start ===
input type=object PRIORITY_HIGH=200 PRIORITY_LOW=100
bindings=91 stolenByMenu=[] actions=["seek 5 keyframes","seek -5 keyframes"]
registered RIGHT
registered LEFT
effective: RIGHT=2x LEFT=3x seek=5s longMs=250
ready. speed=1
```

**关键看这两行：**

- `stolenByMenu=[]` —— 空数组才是对的。如果出现 `["RIGHT"]`，说明输入配置没切到 `holdspeed`，方向键又被菜单抢走了。
- `actions=["seek 5 keyframes", ...]` —— 必须带 `keyframes`。如果显示 `seek 5`，同上。

长按生效时会出现：

```
DOWN RIGHT isRepeat=false → boost RIGHT -> 2x (prev 1)
UP RIGHT → restore RIGHT -> 1x
```

## 我踩过的坑（留给未来的自己）

1. **绝对不要在插件加载期间调用 `iina.menu.forceUpdate()`。**
   它会在 `MenuController.updatePluginMenu()` 里重入 `libdispatch` 的 once 锁，IINA 直接 `SIGTRAP` 崩溃：
   ```
   BUG IN CLIENT OF LIBDISPATCH: trying to lock recursively
   ```
   我为此崩了十几次。

2. **`seek 5 relative` 不能用来绕开菜单**，因为 `sameKeyAction` 会剥掉 `relative`。
   能用的只有 `keyframes`（保留）或 `no-osd`（前缀不同，但不匹配菜单项）—— 后者会吞掉 seek 的时长 OSD，所以选了 `keyframes`。

3. **手写 `input.conf` 很容易丢绑定。**
   一开始我只抄了默认文件的一部分，`bindings` 从 89 掉到 50，丢了 40 条快捷键。
   正确做法是基于 `/Applications/IINA.app/Contents/Resources/config/iina-default-input.conf` 完整复制、只改需要的行。

4. **换片时要先恢复速度再清状态。**
   否则 mpv 的 `speed` 会跨文件延续，新视频一上来就是 2× 播放。

5. **别自己发「速度已改变」的 OSD。**
   IINA 的 `PlayerCore.speedChanged()` 已经会发 `sendOSD(.speed(speed))`，重复发会互相盖掉。

## 开发

```bash
# 打包成可发布的分发包
/Applications/IINA.app/Contents/MacOS/iina-plugin pack .

# 语法检查（macOS 自带，不需要 node）
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
  -e "load('main.js')"
```

## 许可

[MIT](LICENSE)

最初基于 [TheSunset/iina-plugin-hold-speed](https://github.com/TheSunset/iina-plugin-hold-speed) 的思路（单键 + 单倍速）改造而成，现已重写为双键独立倍速 + 输入配置联动方案。

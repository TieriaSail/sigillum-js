# sigillum-js v2.0-dev 维护日志

> 本文档为 sigillum-js 的独立维护记录，不会提交到 GitHub。
> aemeath-js 的维护记录见 `/Users/tieriasail/tieriasail/OPEN_SOURCE_GUIDE.md`。
> 最后更新：2026-04-10

---

## 目录

- [一、v2.0 架构演进概述](#一v20-架构演进概述)
- [二、核心模块清单](#二核心模块清单)
- [三、代码审查全记录（R2-R15）](#三代码审查全记录r2-r15)
- [四、已修复问题汇总（44 项）](#四已修复问题汇总44-项)
- [五、已确认的设计决策（非 Bug）](#五已确认的设计决策非-bug)
- [六、当前代码质量状态](#六当前代码质量状态)
- [七、技术架构详解](#七技术架构详解)
- [八、平台适配器对照表](#八平台适配器对照表)
- [九、冒烟测试](#九冒烟测试)
- [十、发版前检查清单](#十发版前检查清单)
- [十一、统一录制协议（SigillumRecording）](#十一统一录制协议sigillumrecording)
- [十二、后续 Roadmap](#十二后续-roadmap)

---

## 一、v2.0 架构演进概述

### 1.1 从 Snapshot 到 ActionChain

sigillum-js v1.x 基于 rrweb 的 DOM 快照录制，仅支持 Web 端。v2.0 的核心变化：

| 维度 | v1.x | v2.0-dev |
|------|------|----------|
| 录制方式 | rrweb DOM 快照 | 语义化行为链（ActionChain） |
| 平台支持 | 仅 Web（浏览器） | Web + 微信小程序 + Taro 小程序 |
| 数据模型 | `UINode` / `UISnapshot` | `TrackEvent` / `ActionNode` |
| 回放方式 | DOM 重建 | 行为链可视化 + 时间线播放 |
| 监控粒度 | 固定 | 三档预设（lite/standard/full）+ 自定义规则 |
| 隐私保护 | 基础 | `maskInputs` 输入脱敏（默认开启） |

### 1.2 已移除的 v1.x 组件

- `UINode` / `UINodeRect` / `UISnapshot` 类型
- `SnapshotCollector` / `SnapshotConfig`
- `HybridPlayer`
- `snapshotCount` / `snapshots` 字段

### 1.3 新增核心组件

- **监控系统**：`MonitoringPreset` / `MonitoringConfig` / `ActionRule` / `ResolvedMonitoringConfig`
- **事件类型**：`touch_start/move/end` / `scroll_depth` / `drag_start/move/end` / `app_hide/show`
- **增强数据**：`ScrollEventData` / `SwipeEventData` / `DragEventData` / `TouchEventData` / `ScrollDepthEventData`
- **共享工具**：`ThrottleManager` / `ScrollDepthTracker` / `computeScrollDirection` / `detectSwipe`
- **回放系统**：`ActionChain` / `ActionChainPlayer` / `ActionChainStats`

---

## 二、核心模块清单

### 2.1 核心层（src/core/）

| 文件 | 职责 |
|------|------|
| `types.ts` | 全部类型定义：事件、录制选项、会话元数据 |
| `presets.ts` | 三档监控预设（lite/standard/full）+ `resolveMonitoringConfig` |
| `EventBuffer.ts` | 事件缓冲区，溢出保护，NaN 防御 |
| `EventRecorder.ts` | 核心录制器：事件采集 → 缓冲 → 统计 → 上传调度 |
| `SessionManager.ts` | 会话管理：ID、元数据、分段/完整上传、重试回滚 |

### 2.2 平台适配器（src/platform/）

| 文件 | 职责 |
|------|------|
| `types.ts` | `MiniAppPlatformAdapter` 接口定义 |
| `miniapp/shared.ts` | 共享工具：ThrottleManager、ScrollDepthTracker、detectSwipe |
| `miniapp/taro.ts` | Taro 适配器：monkey-patch `dispatchEvent` 自动捕获 |
| `miniapp/wechat.ts` | WeChat 适配器：声明式 `track()` + Page 生命周期 hook |

### 2.3 入口层

| 文件 | 职责 |
|------|------|
| `miniapp.ts` | WeChat 小程序入口：`createMiniAppRecorder()` |
| `miniapp-taro.ts` | Taro 小程序入口：`createTaroRecorder()` |

### 2.4 回放层（src/replay/）

| 文件 | 职责 |
|------|------|
| `ActionChain.ts` | 构建语义行为链 + HTML 渲染 |
| `ActionChainPlayer.tsx` | React 组件：行为链可视化播放器 |
| `TimelinePlayer.ts` | 无头时间线播放器（headless） |
| `index.ts` | 回放模块公开导出 |

---

## 三、代码审查全记录（R2-R15）

> 从 v2.0 架构重构完成后启动，共 14 轮审查，44 个高优问题全部修复。

### 审查趋势

```
轮次  高优数量  趋势
R2    8        ████████
R3    5        █████
R4    5        █████
R5    5        █████
R6    5        █████
R7    2        ██
R8    3        ███
R9    1        █
R10   2        ██
R11   2        ██
R12   1        █
R13   1        █
R14   2        ██
R15   0        ✅ 归零
```

### 各轮审查重点

| 轮次 | 审查焦点 | 高优数 |
|------|---------|--------|
| R2 | 快照残留清理、基础数据完整性 | 8 |
| R3 | 生命周期管理、session_end 保障 | 5 |
| R4 | 异步上传、page_enter 语义、重复订阅 | 5 |
| R5 | adapter.destroy()、app_hide/show、safeOnError、TimelinePlayer 状态 | 5 |
| R6 | ActionChain 完整性、onAppShow 接口、chunk 回滚、getChunkIndex | 5 |
| R7 | session_end reason 清理、maxDuration 上传 | 2 |
| R8 | retryWithBackoff 返回值、chunk 回滚、WeChat hook 防护、eventFilter 防护 | 3 |
| R9 | Taro processAutoEvent 缺失分支（change/submit/touchcancel） | 1 |
| R10 | Taro routerListener try-catch、WeChat touchcancel 分支 | 2 |
| R11 | maskInputs 未实现、Taro 坐标 `\|\|` vs `??` | 2 |
| R12 | Storage get `\|\|` vs `??` | 1 |
| R13 | TimelinePlayer/ActionChainPlayer speed=0 除零 | 1 |
| R14 | EventBuffer maxEvents NaN 防御、maskInputs 非字符串值 | 2 |
| R15 | **归零** | 0 |

---

## 四、已修复问题汇总（44 项）

### 4.1 核心层修复

| # | 轮次 | 文件 | 问题 | 修复 |
|---|------|------|------|------|
| 1 | R2 | types.ts | 残留快照类型 `UINode`/`UISnapshot` | 移除 |
| 2 | R2 | types.ts | `snapshotCount`/`snapshots` 字段残留 | 移除 |
| 3 | R2 | SessionManager.ts | `retryWithBackoff` 泛型 `<T>` 未使用 | 移除 |
| 4 | R2 | SessionManager.ts | 重复重试逻辑未提取 | 提取为 `retryWithBackoff()` |
| 5 | R2 | SessionManager.ts | 重试耗尽不调用 `onError` | 添加 `onError` 调用 |
| 6 | R2 | SessionManager.ts | `buildRecordingData` 含 `snapshots: []` | 移除 |
| 7 | R2 | EventRecorder.ts | `buildSummary()` 含 `snapshotCount: 0` | 移除 |
| 8 | R2 | EventRecorder.ts | `startChunkTimer` 不捕获上传错误 | 添加 `.catch(onError)` |
| 9 | R3 | EventRecorder.ts | `stop()` buffer 满时 `session_end` 丢失 | 使用 `forceAppend` |
| 10 | R3 | SessionManager.ts | `shouldRetry: false` 不调用 `onError` | 添加调用 |
| 11 | R4 | EventRecorder.ts | 缺少 `flushUploads()` 方法 | 新增，buffer_full 时触发 |
| 12 | R4 | EventRecorder.ts | `stop()` 状态转换时序问题 | 重构：先设 stopped，再清理，最后广播 |
| 13 | R5 | SessionManager.ts | 用户 `onError` 回调抛异常破坏 SDK | 新增 `safeOnError` 包装 |
| 14 | R5 | types.ts | 缺少 `app_hide`/`app_show` 事件类型 | 添加到 `TrackEventType` |
| 15 | R6 | SessionManager.ts | 缺少 `getChunkIndex()` getter | 新增 |
| 16 | R7 | types.ts | `SessionEndEventData.reason` 含冗余 `app_hide` | 移除 |
| 17 | R7 | EventRecorder.ts | `startMaxDurationTimer` 不触发 `flushUploads` | 添加调用 |
| 18 | R8 | SessionManager.ts | `retryWithBackoff` 返回 `void` 无法判断成功 | 改为返回 `boolean` |
| 19 | R8 | SessionManager.ts | `uploadChunk` 失败不回滚 chunkIndex | 保存 prev 值，失败时回滚 |
| 20 | R11 | EventRecorder.ts | `maskInputs` 选项声明但从未实现 | 在 `captureEvent` 中实现脱敏 |
| 21 | R14 | EventBuffer.ts | `maxEvents` 为 NaN 时缓冲区无上限 | 构造函数校验 + 回退默认值 |
| 22 | R14 | EventRecorder.ts | `maskInputs` 只处理 string 值 | 非字符串非 null 值统一替换为 `***` |
| 23 | R2 | presets.ts | 缺少运行时 preset 名称校验 | 添加校验 |
| 24 | R2 | EventBuffer.ts | 缺少 `forceAppend` 方法 | 新增 |

### 4.2 平台适配器修复

| # | 轮次 | 文件 | 问题 | 修复 |
|---|------|------|------|------|
| 25 | R3 | taro.ts | `onPageHide` 不触发（依赖 `onPageShow` 注册顺序） | 重构为共享 `ensureRouterListener` |
| 26 | R3 | taro.ts | `dispatchEvent` patch 中 SDK 错误阻断原生事件 | 添加 try-catch |
| 27 | R3 | wechat.ts | `Page` 未定义时 `hookPageLifecycles` 崩溃 | 添加 `typeof Page !== 'function'` 守卫 |
| 28 | R4 | taro.ts | touchmove throttle=0 被当作禁用 | 修正为"不节流" |
| 29 | R4 | wechat.ts | 同上 | 同上 |
| 30 | R5 | taro.ts | 缺少 `destroy()` 方法 | 新增：清理 eventCenter 监听 |
| 31 | R5 | wechat.ts | 缺少 `destroy()` 方法 | 新增：恢复 `globalThis.Page` |
| 32 | R6 | taro.ts | 缺少 `onAppShow` 实现 | 新增 |
| 33 | R8 | wechat.ts | Page onShow/onHide hook 中 SDK 异常阻断原始钩子 | SDK 回调包裹 try-catch |
| 34 | R8 | taro.ts + wechat.ts | `filteredHandler` 中 `eventFilter` 异常破坏事件处理 | 包裹 try-catch |
| 35 | R9 | taro.ts | `processAutoEvent` 缺少 change/submit/touchcancel | 添加 switch case |
| 36 | R10 | taro.ts | `routerListenerFn` 回调未 try-catch | 整体包裹 try-catch |
| 37 | R10 | wechat.ts | `track()` 缺少 touchcancel 分支 | 添加 case，清理 touchStartState |
| 38 | R11 | taro.ts | tap/longpress 坐标用 `\|\|` 丢失 x=0/y=0 | 改为 `??` |
| 39 | R12 | taro.ts + wechat.ts | `storage.get` 用 `\|\|` 丢失空字符串 | 改为 `??` |

### 4.3 入口层修复

| # | 轮次 | 文件 | 问题 | 修复 |
|---|------|------|------|------|
| 40 | R4 | miniapp.ts + miniapp-taro.ts | `page_enter` 的 `from` 字段在 setCurrentPage 之后取 | 调整为之前取 |
| 41 | R4 | miniapp.ts + miniapp-taro.ts | `start()` 重复调用导致 lifecycle hook 重复注册 | 先清理 unsubscribers |
| 42 | R5 | miniapp.ts + miniapp-taro.ts | `destroy()` 不调用 `adapter.destroy()` | 添加调用 |
| 43 | R5 | miniapp.ts + miniapp-taro.ts | `onAppHide` 不发 `app_hide` 事件、不 pause | 添加事件 + pause/resume |

### 4.4 回放层修复

| # | 轮次 | 文件 | 问题 | 修复 |
|---|------|------|------|------|
| 44 | R2 | ActionChain.ts | 根 div 缺少 CSS class | 添加 `class="sigillum-action-chain"` |
| 45 | R2 | ActionChainPlayer.tsx | `useEffect` 依赖问题导致 autoPlay 重启 | useRef 稳定化 |
| 46 | R2 | TimelinePlayer.ts | `getCurrentTime()` paused 时仍推进 | 修正为 `pauseOffset * speed` |
| 47 | R5 | TimelinePlayer.ts | `seekTo` finished 状态不转 paused | 添加状态转换 |
| 48 | R5 | TimelinePlayer.ts | `setSpeed` paused 状态不重算 pauseOffset | 添加重算 |
| 49 | R6 | ActionChain.ts | 缺少 app_hide/app_show 的 ActionType/ICONS/COLORS | 添加 |
| 50 | R13 | TimelinePlayer.ts | speed=0 导致除零 Infinity/NaN | 构造函数 clamp + setSpeed 守卫 |
| 51 | R13 | ActionChainPlayer.tsx | playNext 中 speed=0 导致 Infinity delay | Math.max(0.1, speed) 保护 |

> 注：实际高优问题为 44 个，部分修复涉及多个文件或同一文件的多个问题，故编号超过 44。

---

## 五、已确认的设计决策（非 Bug）

以下项目在审查中被提出但经评估确认为合理的设计选择，不作修改：

| 项目 | 理由 |
|------|------|
| chunk 上传使用 setInterval 不序列化 | 默认 60s 间隔，实际重叠概率极低 |
| maxDuration 在 resume 后重新计时 | 设计为"录制时长"而非"墙钟时长" |
| session_end reason 在 buffer_full + max_duration 交叉时可能不精确 | 极端边界，中优 |
| destroy() 不清理 native onAppHide/onAppShow | 入口层 unsubscribers 已处理 |
| Taro onPageHide 仅在路由变化时触发 | Taro 框架限制，app_hide 事件独立覆盖 |
| ActionChainPlayer 用引用比较重置状态 | 消费者传稳定引用即可 |
| TimelinePlayer getCurrentTime idle 返回 0 | 语义正确 |
| TimelinePlayer destroy 后 play | destroy 是终态操作 |
| getEvents() 返回内部数组引用 | API 契约 |
| 回放组件用户回调未 try-catch | 中优，不影响宿主应用 |
| 多 WechatAdapter 实例 destroy 顺序 | 单例设计 |
| buildActionChain rule.match/transform 未 try-catch | 中优 |
| captureEvent 在非 recording 状态静默丢弃 | 正确行为 |
| onUpload 返回值由 TypeScript 类型约束 | 消费者契约 |
| maskInputs 原地修改 event.data | 适配器每次创建新对象 |

---

## 六、当前代码质量状态

### 6.1 编译与测试

```
TypeScript:  tsc --noEmit → 0 errors
Unit Tests:  364 passed / 0 failed / 18 test files
Coverage:    核心模块 + 平台适配器 + 回放层全覆盖
```

### 6.2 防御性编程覆盖

| 防御点 | Taro | WeChat |
|--------|:----:|:------:|
| Page/全局 hook try-catch | ✅ | ✅ |
| routerListener try-catch | ✅ | ✅ |
| filteredHandler try-catch | ✅ | ✅ |
| dispatchEvent patch try-catch | ✅ | N/A |
| onShow/onHide SDK 回调 try-catch | N/A | ✅ |
| safeOnError 包装 | ✅ | ✅ |
| touchcancel 处理 | ✅ | ✅ |
| change/submit 处理 | ✅ | N/A（声明式） |
| destroy() 清理 | ✅ | ✅ |
| storage.get ?? 防护 | ✅ | ✅ |
| 坐标提取 ?? 防护 | ✅ | ✅ |

### 6.3 输入校验覆盖

| 参数 | 校验方式 |
|------|---------|
| `maxEvents` | `Number.isFinite && > 0`，否则回退 50000 |
| `speed`（TimelinePlayer） | 构造函数 clamp ≥ 0.1，setSpeed 拒绝非正有限数 |
| `speed`（ActionChainPlayer） | playNext 中 Math.max(0.1, speed) |
| `maskInputs` | 默认 true，string 等长替换，非 string 替换为 `***` |
| `preset` 名称 | 运行时校验 |

---

## 七、技术架构详解

### 7.1 事件流

```
用户交互
    │
    ▼
平台适配器（Taro / WeChat）
    │  processAutoEvent / track()
    │  filteredHandler（try-catch 保护）
    ▼
EventRecorder.captureEvent()
    │  maskInputs 脱敏
    │  buffer.push()
    │  analyzeEvent()（统计计数）
    │  onEventEmit 回调
    ▼
EventBuffer
    │  溢出 → forceAppend session_end → flushUploads
    ▼
SessionManager
    │  uploadChunk()（分段）/ upload()（完整）
    │  retryWithBackoff（成功返回 true，失败回滚 + onError）
    ▼
用户 onChunkUpload / onUpload 回调
```

### 7.2 状态机

```
idle ──start()──→ recording ──stop()──→ stopped
                     │   ↑
                  pause() resume()
                     │   ↑
                     ▼   │
                   paused

recording ──buffer_full──→ stopped（自动）
recording ──max_duration──→ stopped（自动）

任意状态 ──destroy()──→ idle（终态）
```

### 7.3 监控预设

| 能力 | lite | standard | full |
|------|:----:|:--------:|:----:|
| tap | ✅ | ✅ | ✅ |
| longpress | ❌ | ✅ | ✅ |
| input | ❌ | ✅ | ✅ |
| scroll | ❌ | ✅ | ✅ |
| touch（start/move/end） | ❌ | ❌ | ✅ |
| swipe | ❌ | ❌ | ✅ |
| drag | ❌ | ❌ | ✅ |
| scroll_depth | ❌ | ❌ | ✅ |
| custom | ❌ | ✅ | ✅ |

#### 节流间隔（throttle）

| 事件类型 | lite | standard | full | 说明 |
|----------|-----:|---------:|-----:|------|
| scroll | 1000ms | 300ms | 100ms | 滚动事件最小间隔 |
| touchMove | —（不采集） | —（不采集） | 50ms | touchmove 最小间隔 |
| drag | —（不采集） | —（不采集） | 100ms | 拖拽事件最小间隔（规划中） |

用户可在 `monitoring.throttle` 中覆盖任意字段，如 `{ scroll: 500 }` 将滚动节流调整为 500ms。

#### 事件粒度对比（以"点击一个按钮"为例）

| 接入方式 | 产生的事件 | 数量 | 适用场景 |
|----------|-----------|:----:|----------|
| lite/standard，只绑 `bindtap` | tap | **1** | 轻量埋点，只关心语义操作 |
| full，只绑 `bindtap`（不绑根 view touch） | tap | **1** | 需要 full 的其他能力但不需要全局触摸链 |
| full + 根 view 绑 `bindtouchstart`/`bindtouchend` | touch_start → touch_end → tap | **3** | 完整触摸语义链还原，精细回放 |

> **设计原则**：根 view 的 `bindtouchstart`/`bindtouchend` 是 full 模式的**可选增强**，不是必须的。是否绑定由用户根据业务需求决定：
> - **绑定**：可捕获空白区域的触摸、还原完整触摸→点击语义链，但每次 tap/longpress 会多 2 个 touch 事件
> - **不绑定**：事件更精简，每次操作只产生 1 个语义事件，但丢失空白区域触摸数据

---

## 八、平台适配器对照表

### 8.1 事件捕获方式

| 事件 | Taro（自动捕获） | WeChat（声明式） |
|------|:---:|:---:|
| tap / longpress | `dispatchEvent` monkey-patch | `track('tap', e)` |
| input / confirm | 同上 | `track('input', e)` |
| scroll | 同上 | `track('scroll', e)` |
| touchstart/move/end | 同上 | `track('touchstart', e)` |
| touchcancel | 同上 → touch_end | `track('touchcancel', e)` → touch_end |
| change / submit | 同上 → custom | N/A（声明式由用户选择 track） |
| page_enter / page_leave | `__taroRouterChange` 事件 | Page onShow/onHide hook |
| app_hide / app_show | `nativeApi.onAppHide/Show` | `wx.onAppHide/Show` |

### 8.2 生命周期管理

| 操作 | Taro | WeChat |
|------|------|--------|
| 初始化 | `ensureRouterListener()` 注册共享监听 | `hookPageLifecycles()` 替换全局 `Page` |
| 销毁 | `eventCenter.off` + 清空回调数组 | 恢复 `globalThis.Page` + 清空回调数组 |
| 页面切换检测 | `__taroRouterChange` 事件 | Page onShow 中比较 path |
| 状态重置 | 路由变化时重置 scroll/touch 状态 | onHide 中重置 |

---

## 九、冒烟测试

### 9.1 项目位置

```
/Users/tieriasail/tieriasail/sigillum-smoke-test/
├── setup.sh                    ← 一键构建 + 拷贝（WeChat + Taro）
├── replay-preview.html         ← 回放预览页面
└── wechat-native/              ← 微信原生冒烟测试小程序
    ├── app.js                  ← v2.0 配置（full 预设 + chunkedUpload）
    ├── app.json
    ├── lib/miniapp.js          ← setup.sh 自动拷贝的构建产物
    └── pages/index/
        ├── index.js            ← 自动化测试 + 交互测试
        ├── index.wxml          ← 测试 UI（触摸事件绑定在根 view）
        └── index.wxss
```

### 9.2 运行流程

```bash
# 1. 构建 + 拷贝
cd /Users/tieriasail/tieriasail/sigillum-smoke-test
bash setup.sh

# 2. 用微信开发者工具打开 wechat-native/ 目录

# 3. 在模拟器中点击"开始冒烟测试"
#    → 自动化阶段：13 项自动测试
#    → 交互阶段：手动点击、长按、输入、滚动
#    → 点击"停止录制 & 验证导出"

# 4. 从控制台复制 REPLAY DATA JSON，粘贴到 replay-preview.html 验证回放
```

### 9.3 自动化测试用例（Phase 1）

| # | 用例 | 验证点 |
|---|------|--------|
| T1 | createRecorder | 实例创建成功，无异常 |
| T2 | getSigillum | 全局实例非 null |
| T3 | getStatus:idle | start 前状态为 idle |
| T4 | start | 状态变为 recording |
| T5 | getSessionId | 返回非空字符串 |
| T6 | identify | 用户身份关联无异常 |
| T7 | track:custom | 自定义事件采集，eventCount >= 1 |
| T8 | track:tap | tap 事件采集成功 |
| T9 | maskInputs | input 事件被计数且 maskInputs=true 已启用（脱敏在 captureEvent 内同步生效） |
| T10 | track:touch | touchstart + touchend 采集成功 |
| T11 | track:touchcancel | touchcancel → touch_end 映射成功 |
| T12 | pause/resume | pause→paused, resume→recording |
| T13 | getSummary | 返回对象，含 tapCount/inputCount |

### 9.4 交互测试用例（Phase 2）

| 操作 | 预期采集事件 | 说明 |
|------|-------------|------|
| 点击紫色 tap 区域 | touch_start + touch_end + tap = **3 事件** | 根 view 捕获触摸 + 子元素 track tap，这是 full 模式的预期行为 |
| 长按蓝色区域 | touch_start + longpress + touch_end = **3 事件** | 同上 |
| 输入框输入文字 | input = **1 事件** | — |
| 触摸青色区域 | touch_start + touch_end = **2 事件** | 根 view 全局捕获 |
| 滚动列表 | scroll（节流后）= **N 事件** | — |
| 触摸空白区域 | touch_start + touch_end = **2 事件** | 根 view 全局捕获 |

> **注意**：full 模式下，根 view 的 `bindtouchstart`/`bindtouchend` 会捕获所有触摸事件（包括 tap/longpress 区域的），因此一次 tap 操作会产生 touch_start + touch_end + tap 共 3 个事件。这是**预期行为**，行为链分析器会从中还原完整的触摸→点击语义链。

### 9.5 停止 & 导出验证（Phase 3）

| # | 用例 | 验证点 |
|---|------|--------|
| stop | status=stopped |
| exportRecording | events 数组非空 |
| eventTypes | 类型分布包含 session_start/tap/input/scroll 等 |
| session_start/end | 首尾事件完整 |
| getMetadata | platform=wechat, sdkVersion 非空 |
| destroy | getSigillum() 返回 null |

### 9.6 回放验证

导出的 JSON 数据可粘贴到 `replay-preview.html` 中验证行为链渲染。

### 9.7 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `import` 报错 | lib/miniapp.js 未拷贝 | 重新运行 `bash setup.sh` |
| getSigillum() 返回 null | app.js 中未调用 createRecorder | 检查 app.js |
| page_enter 不触发 | Page hook 未生效 | 确认 createRecorder 在所有 Page() 之前调用 |
| maskInputs 测试失败 | 构建产物过旧 | 重新 `bash setup.sh` |
| 触摸事件不记录 | 根 view 未绑定 touchstart/touchend | 检查 wxml 根元素 |
| tap 点击 +3 事件 | full 模式预期行为：根 view 捕获 touch_start/end + 子元素 track tap | 非 bug，行为链分析器会合并为完整语义链 |

---

## 十、发版前检查清单

```
□ tsc --noEmit 零错误
□ npx vitest run 全部通过（当前 364 tests / 18 files）
□ npm run build 构建成功
□ npm pack --dry-run 检查发布文件正确
□ 微信原生冒烟测试全部通过（bash setup.sh → 开发者工具）
□ Taro 冒烟测试全部通过（如适用）
□ CHANGELOG.md 已更新
□ README.md / README.zh_CN.md 示例代码是最新的
□ package.json version 已更新
□ 版本号遵循 semver
□ 无意外的 breaking change
□ docs/ACTION_CHAIN_MONITORING_PLAN.md 与实际代码一致
□ example-miniapp-taro.tsx 和 example-miniapp-wechat.js 可运行
□ maskInputs 默认开启（隐私合规）
```

---

## 十一、统一录制协议（SigillumRecording）

### 11.1 设计动机

Web（rrweb）和小程序（ActionChain）的导出数据结构完全不同。为了：

1. 后端能自动区分数据来源，选择正确的存储和回放策略
2. 前端回放组件能自动路由到正确的播放器
3. 降低用户集成成本（一个 `ReplayRouter` 搞定所有平台）

引入 `SigillumRecording` 信封格式包裹所有平台的原始录制数据。

### 11.2 信封结构

```typescript
interface SigillumRecording<T = unknown> {
  sigillum: true;           // 魔术标记
  schemaVersion: number;    // 协议版本，当前为 1
  source: 'web' | 'miniapp';
  sdkVersion: string;
  exportedAt: number;       // 导出时间戳（ms）
  recording: T;             // 平台原始数据
}
```

### 11.3 变更清单

| 文件 | 变更 |
|------|------|
| `src/core/types.ts` | 新增 `SigillumRecording`、`isSigillumRecording`、`unwrapRecording`、`detectRecordingSource` |
| `src/core/EventRecorder.ts` | `exportRecording()` 返回 `SigillumRecording<MiniAppRawRecordingData>` |
| `src/SessionRecorder.ts` | `exportRecording()` 返回 `SigillumRecording<RawRecordingData>` |
| `src/replay/ActionChainPlayer.tsx` | `data` prop 兼容信封和裸数据 |
| `src/ui/ReplayPlayer.tsx` | `recordingData` 解包兼容信封和裸数据 |
| `src/ui/ReplayRouter.tsx` | **新增** 统一回放路由组件 |
| `src/miniapp.ts` / `src/miniapp-taro.ts` | 导出协议类型和辅助函数 |
| `src/index.ts` / `src/replay/index.ts` | 导出协议类型和辅助函数 |

### 11.4 向后兼容

- 所有回放组件同时接受 `SigillumRecording` 和裸数据
- `detectRecordingSource()` 可自动识别旧版裸数据的来源（通过 `events[0].type` 是 number 还是 string）
- 旧版日志文件无需迁移，直接传入回放组件即可

---

## 十二、后续 Roadmap

### 12.1 v2.0-dev 剩余工作

| 优先级 | 项目 | 状态 |
|--------|------|------|
| P0 | 代码审查归零 | ✅ 完成（R15 零高优） |
| P0 | 统一录制协议 | ✅ 完成 |
| P1 | 冒烟测试通过 | 待验证 |
| P1 | README 文档更新 | ✅ 完成 |
| P2 | 补充单元测试（maskInputs、touchcancel、storage 边界） | 待补充 |
| P2 | CHANGELOG.md 编写 | 待编写 |

### 12.2 中期规划

| 项目 | 说明 |
|------|------|
| chunk 上传序列化 | 当前 setInterval 不等待上一次完成，高延迟网络下可优化 |
| 回放组件防御性增强 | TimelinePlayer/ActionChainPlayer 用户回调 try-catch |
| buildActionChain 自定义规则防护 | rule.match/transform try-catch |
| 支付宝/抖音/百度小程序适配器 | 基于现有架构扩展 |

### 12.3 与 aemeath-js 的关系

sigillum-js v2.0 的小程序适配器架构（`MiniAppPlatformAdapter` + 平台检测 + 共享工具）与 aemeath-js v2.0 的 `PlatformAdapter` 模式独立设计但理念一致。两个库：

- **独立仓库、独立版本、独立发布**
- 共享开源管理流程（见 `OPEN_SOURCE_GUIDE.md`）
- 不共享代码依赖

---

> 📅 文档创建日期：2026-04-09 | 最后更新：2026-04-10
> 📌 适用版本：sigillum-js v2.0-dev（v2-dev 分支）
> 🔄 建议每次重大修改后更新此文档

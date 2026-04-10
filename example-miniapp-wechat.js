/**
 * sigillum-js 微信原生小程序接入示例
 *
 * 环境要求：微信基础库 >= 1.4.0（推荐 >= 2.1.0）
 * 采集模式：声明式埋点（每个需要追踪的事件处理函数加一行 track）
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ 监控预设与事件粒度                                              │
 * │                                                                 │
 * │ 以"点击一个按钮"为例：                                          │
 * │  lite / standard（不绑根 view touch）→ tap         = 1 事件     │
 * │  full（不绑根 view touch）           → tap         = 1 事件     │
 * │  full + 根 view 绑 touch            → touch_start              │
 * │                                       + touch_end              │
 * │                                       + tap       = 3 事件     │
 * │                                                                 │
 * │ 根 view 的 bindtouchstart/bindtouchend 是 full 模式的可选增强， │
 * │ 不是必须的。绑定后可捕获空白区域触摸 + 还原完整触摸→点击语义链；│
 * │ 不绑定则每次操作只产生 1 个语义事件，更精简。                    │
 * └─────────────────────────────────────────────────────────────────┘
 */

// ==================== app.js ====================

import { createMiniAppRecorder } from 'sigillum-js/miniapp';

App({
  onLaunch() {
    // 按需选择预设：'lite' | 'standard' | 'full'
    // 各预设的 scroll 节流：full=100ms, standard=300ms, lite=1000ms
    // 可通过 throttle 覆盖，如 throttle: { scroll: 500 } 降低滚动事件频率
    this.recorder = createMiniAppRecorder({
      monitoring: { preset: 'full' },

      // data 是 SigillumRecording 信封格式，包含 sigillum/schemaVersion/source/recording 等字段
      // 后端可通过 data.source 区分 web / miniapp，选择不同的存储和回放策略
      onUpload: async (data) => {
        const res = await new Promise((resolve, reject) => {
          wx.request({
            url: 'https://your-api.com/api/recordings',
            method: 'POST',
            header: { 'Content-Type': 'application/json' },
            data: data,
            success: resolve,
            fail: reject,
          });
        });
        return { success: res.statusCode === 200 };
      },

      maxDuration: 30 * 60 * 1000,
      debug: false,
    });

    this.recorder.start();
  },
});

// ==================== pages/index/index.js ====================
// 示例 A：full 模式 + 根 view 全局触摸捕获（完整触摸语义链）
// ==================== ↓↓↓ ====================

import { getSigillum } from 'sigillum-js/miniapp';

Page({
  data: { items: [] },

  onLoad(options) {
    this.loadData();
  },

  // ── 全局触摸捕获（可选，仅 full 模式推荐） ──
  // WXML: <view bindtouchstart="onTouchStart" bindtouchend="onTouchEnd">...</view>
  // 使用 bind（而非 catch）不阻止冒泡，对业务逻辑无影响。
  // 绑定后，点击子元素会产生 touch_start + touch_end + tap = 3 事件，
  // 行为链分析器会从中还原完整的"触摸→点击"语义链。
  onTouchStart(e) {
    getSigillum()?.track('touchstart', e);
  },
  onTouchEnd(e) {
    getSigillum()?.track('touchend', e);
  },

  // ── 语义事件（所有预设通用） ──
  onTap(e) {
    getSigillum()?.track('tap', e);
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },
  onInput(e) {
    getSigillum()?.track('input', e);
    this.setData({ searchText: e.detail.value });
  },
  onScroll(e) {
    getSigillum()?.track('scroll', e);
  },
  onLongpress(e) {
    getSigillum()?.track('longpress', e);
    wx.showActionSheet({ itemList: ['收藏', '分享', '删除'] });
  },

  loadData() {
    wx.request({
      url: 'https://your-api.com/api/items',
      success: (res) => { this.setData({ items: res.data }); },
    });
  },
});

// ==================== pages/index/index.js ====================
// 示例 B：standard / lite 模式（精简，不绑根 view touch）
// ==================== ↓↓↓ ====================
//
// WXML: <view>...</view>  ← 根 view 无需绑定 touch 事件
//
// Page({
//   onTap(e) {
//     getSigillum()?.track('tap', e);    // 点击 → 仅 1 个 tap 事件
//   },
//   onInput(e) {
//     getSigillum()?.track('input', e);
//   },
//   onScroll(e) {
//     getSigillum()?.track('scroll', e);
//   },
// });

// ==================== 用户登录后关联身份 ====================

function onLoginSuccess(userInfo) {
  getSigillum()?.identify(userInfo.userId, {
    name: userInfo.nickname,
    avatar: userInfo.avatarUrl,
  });
}

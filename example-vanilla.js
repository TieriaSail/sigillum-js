/**
 * Session Recorder - 原生 JS / jQuery / 非框架项目使用示例
 *
 * 核心 SessionRecorder 本身与框架无关，可直接在任何 JS 环境中使用。
 *
 * 安装依赖：
 * npm install sigillum-js rrweb
 */

// ==================== 示例 1: 最简使用 ====================

import { getRecorder } from 'sigillum-js';

const recorder = getRecorder({
  onUpload: async (data) => {
    await fetch('/api/recordings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return { success: true };
  },
});

// 开始录制
recorder.start();

// 停止录制并上传
// await recorder.stop();

// ==================== 示例 2: 带字段映射 ====================

/*
import { getRecorder } from 'sigillum-js';

const recorder = getRecorder({
  fieldMapping: [
    ['sessionId', 'id'],
    ['events', 'content', JSON.stringify, JSON.parse],
    ['startTime', 'start_at'],
    ['endTime', 'end_at'],
    ['duration', 'duration_ms'],
    ['url', 'page_url'],
  ],
  beforeUpload: (data) => ({
    ...data,
    user_id: 'current-user-id',
    created_at: new Date().toISOString(),
  }),
  onUpload: async (data) => {
    // data 已经是后端结构: { id, content, start_at, ... }
    const res = await fetch('/api/recordings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return { success: res.ok };
  },
});

recorder.start();
*/

// ==================== 示例 3: 配合 jQuery 使用 ====================

/*
import { getRecorder, resetRecorder } from 'sigillum-js';

$(document).ready(function () {
  const recorder = getRecorder({
    onUpload: async (data) => {
      // 用 jQuery ajax 上传也可以
      return new Promise((resolve) => {
        $.ajax({
          url: '/api/recordings',
          method: 'POST',
          contentType: 'application/json',
          data: JSON.stringify(data),
          success: () => resolve({ success: true }),
          error: () => resolve({ success: false, error: 'Upload failed' }),
        });
      });
    },
    debug: true,
  });

  recorder.start();

  // 在按钮点击时添加标记
  $('#buy-btn').on('click', function () {
    recorder.addTag('click-buy', {
      productId: $(this).data('product-id'),
      time: Date.now(),
    });
  });

  // 在表单提交时添加标记
  $('#checkout-form').on('submit', function () {
    recorder.addTag('checkout-submit', {
      formData: $(this).serialize(),
    });
  });

  // 页面离开时自动保存到 IndexedDB（默认行为，无需手动处理）
  // 下次打开页面时会自动恢复并上传
});
*/

// ==================== 示例 4: 手动控制录制生命周期 ====================

/*
import { getRecorder, resetRecorder } from 'sigillum-js';

const recorder = getRecorder({
  onUpload: async (data) => {
    await fetch('/api/recordings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return { success: true };
  },
});

// 开始按钮
document.getElementById('startBtn').addEventListener('click', () => {
  recorder.start();
  console.log('录制已开始, sessionId:', recorder.getSessionId());
});

// 暂停按钮
document.getElementById('pauseBtn').addEventListener('click', () => {
  recorder.pause();
  console.log('录制已暂停');
});

// 恢复按钮
document.getElementById('resumeBtn').addEventListener('click', () => {
  recorder.resume();
  console.log('录制已恢复');
});

// 停止按钮（停止并上传）
document.getElementById('stopBtn').addEventListener('click', async () => {
  await recorder.stop();
  console.log('录制已停止并上传');
});

// 显示状态
setInterval(() => {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = `状态: ${recorder.getStatus()} | 事件数: ${recorder.getEventCount()}`;
  }
}, 1000);
*/

// ==================== 示例 5: 条件启用 ====================

/*
import { getRecorder } from 'sigillum-js';

const recorder = getRecorder({
  // 只录制 VIP 用户，或 10% 的普通用户
  enabled: () => {
    const isVIP = localStorage.getItem('isVIP') === 'true';
    return isVIP || Math.random() < 0.1;
  },

  // 不兼容时的回调
  onUnsupported: (reason) => {
    console.log('浏览器不支持录制:', reason);
  },

  onUpload: async (data) => {
    await fetch('/api/recordings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return { success: true };
  },
});

recorder.start();
*/

// ==================== 示例 6: 生产环境推荐配置 ====================

/*
import { getRecorder } from 'sigillum-js';

const isProd = location.hostname !== 'localhost';

const recorder = getRecorder({
  enabled: () => !isProd || Math.random() < 0.1,

  fieldMapping: [
    ['sessionId', 'id'],
    ['events', 'content', JSON.stringify, JSON.parse],
    ['startTime', 'start_at'],
    ['endTime', 'end_at'],
    ['duration', 'duration_ms'],
  ],

  rrwebConfig: {
    recordMouseMove: true,
    mouseMoveInterval: isProd ? 100 : 50,
    recordCanvas: false,
    privacy: {
      maskInputOptions: { password: true },
      maskTextSelector: '.sensitive',
    },
  },

  cache: { enabled: true, saveInterval: 5000 },
  maxDuration: 30 * 60 * 1000,
  maxRetries: 3,

  onUpload: async (data) => {
    const res = await fetch('/api/recordings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken(),
      },
      body: JSON.stringify(data),
    });
    return { success: res.ok };
  },

  onUnsupported: (reason) => {
    console.log('Session replay not supported:', reason);
  },
});

recorder.start();

// 在关键操作处添加标记
document.querySelector('.checkout-btn')?.addEventListener('click', () => {
  recorder.addTag('checkout-click');
});

document.querySelector('.error-boundary')?.addEventListener('error', (e) => {
  recorder.addTag('js-error', { message: e.message });
  recorder.stop(); // 出错时立即停止并上传
});
*/


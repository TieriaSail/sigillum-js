/**
 * Session Recorder - Vue 3 使用示例
 *
 * 安装依赖：
 * npm install sigillum-js rrweb vue
 */

// ==================== 示例 1: Plugin 方式（推荐） ====================

/**
 * main.ts - 应用入口
 *
 * ```ts
 * import { createApp } from 'vue';
 * import { createSigillumPlugin } from 'sigillum-js/vue';
 * import App from './App.vue';
 *
 * const app = createApp(App);
 *
 * app.use(createSigillumPlugin({
 *   onUpload: async (data) => {
 *     await fetch('/api/recordings', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify(data),
 *     });
 *     return { success: true };
 *   },
 *   // autoStart: true（默认），安装插件即自动开始录制
 * }));
 *
 * app.mount('#app');
 * ```
 */

// ==================== 示例 2: Plugin + 字段映射 ====================

/**
 * main.ts - 带字段映射的配置
 *
 * ```ts
 * import { createApp } from 'vue';
 * import { createSigillumPlugin } from 'sigillum-js/vue';
 * import App from './App.vue';
 *
 * const app = createApp(App);
 *
 * app.use(createSigillumPlugin({
 *   fieldMapping: [
 *     ['sessionId', 'id'],
 *     ['events', 'content', JSON.stringify, JSON.parse],
 *     ['startTime', 'start_at'],
 *     ['endTime', 'end_at'],
 *     ['duration', 'duration_ms'],
 *     ['url', 'page_url'],
 *   ],
 *   beforeUpload: (data) => ({
 *     ...data,
 *     user_id: getCurrentUserId(),
 *     created_at: new Date().toISOString(),
 *   }),
 *   onUpload: async (data) => {
 *     const res = await fetch('/api/recordings', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify(data),
 *     });
 *     return { success: res.ok };
 *   },
 * }));
 *
 * app.mount('#app');
 * ```
 */

// ==================== 示例 3: 组件中手动控制 ====================

/**
 * RecordingPage.vue
 *
 * ```vue
 * <template>
 *   <div>
 *     <p>状态: {{ recorder?.getStatus() }}</p>
 *     <p>SessionId: {{ recorder?.getSessionId() }}</p>
 *     <button @click="recorder?.start()">开始录制</button>
 *     <button @click="recorder?.stop()">停止录制</button>
 *     <button @click="recorder?.pause()">暂停</button>
 *     <button @click="recorder?.resume()">恢复</button>
 *     <button @click="recorder?.addTag('user-action', { action: 'click' })">
 *       添加标记
 *     </button>
 *   </div>
 * </template>
 *
 * <script setup>
 * import { inject } from 'vue';
 * import { useSessionRecorder } from 'sigillum-js/vue';
 *
 * const recorder = useSessionRecorder(inject);
 * </script>
 * ```
 */

// ==================== 示例 4: 自动录制（组件级） ====================

/**
 * AutoRecordPage.vue
 *
 * ```vue
 * <template>
 *   <div>
 *     <p>录制状态: {{ status }}</p>
 *     <p>SessionId: {{ sessionId }}</p>
 *     <button @click="addTag('page-action', { time: Date.now() })">
 *       添加标记
 *     </button>
 *   </div>
 * </template>
 *
 * <script setup>
 * import { inject, onUnmounted } from 'vue';
 * import { useAutoRecord } from 'sigillum-js/vue';
 *
 * // 组件挂载时自动开始录制，卸载时自动停止
 * const { status, sessionId, addTag } = useAutoRecord(inject, onUnmounted);
 * </script>
 * ```
 */

// ==================== 示例 5: 不使用 Plugin，直接在组件中初始化 ====================

/**
 * StandalonePage.vue
 *
 * 如果不想用 Plugin，也可以直接在组件中使用核心 API
 *
 * ```vue
 * <template>
 *   <div>录制中...</div>
 * </template>
 *
 * <script setup>
 * import { onMounted, onUnmounted } from 'vue';
 * import { getRecorder, resetRecorder } from 'sigillum-js';
 *
 * onMounted(() => {
 *   const recorder = getRecorder({
 *     onUpload: async (data) => {
 *       await fetch('/api/recordings', {
 *         method: 'POST',
 *         body: JSON.stringify(data),
 *       });
 *       return { success: true };
 *     },
 *   });
 *   recorder.start();
 * });
 *
 * onUnmounted(() => {
 *   const recorder = getRecorder();
 *   recorder.stop();
 * });
 * </script>
 * ```
 */

// ==================== 示例 6: 生产环境推荐配置 ====================

/**
 * main.ts - 生产环境完整配置
 *
 * ```ts
 * import { createApp } from 'vue';
 * import { createSigillumPlugin } from 'sigillum-js/vue';
 * import App from './App.vue';
 *
 * const isProd = import.meta.env.PROD;
 *
 * const app = createApp(App);
 *
 * app.use(createSigillumPlugin({
 *   // 条件启用：生产环境 10% 采样
 *   enabled: () => !isProd || Math.random() < 0.1,
 *
 *   // 字段映射
 *   fieldMapping: [
 *     ['sessionId', 'id'],
 *     ['events', 'content', JSON.stringify, JSON.parse],
 *     ['startTime', 'start_at'],
 *     ['endTime', 'end_at'],
 *     ['duration', 'duration_ms'],
 *   ],
 *
 *   // rrweb 配置
 *   rrwebConfig: {
 *     recordMouseMove: true,
 *     mouseMoveInterval: isProd ? 100 : 50,
 *     recordCanvas: false,
 *     privacy: {
 *       maskInputTypes: ['password', 'credit-card', 'cvv'],
 *       maskTextSelector: '.sensitive',
 *     },
 *   },
 *
 *   // 缓存（防崩溃）
 *   cache: { enabled: true, saveInterval: 5000 },
 *
 *   maxDuration: 30 * 60 * 1000,
 *   maxRetries: 3,
 *
 *   onUpload: async (data) => {
 *     const res = await fetch('/api/recordings', {
 *       method: 'POST',
 *       headers: {
 *         'Content-Type': 'application/json',
 *         'Authorization': `Bearer ${getToken()}`,
 *       },
 *       body: JSON.stringify(data),
 *     });
 *     return { success: res.ok };
 *   },
 *
 *   onUnsupported: (reason) => {
 *     console.log('Session replay not supported:', reason);
 *   },
 * }));
 *
 * app.mount('#app');
 * ```
 */


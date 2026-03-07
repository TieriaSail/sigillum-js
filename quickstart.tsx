/**
 * Drop one of these components into your app.tsx to start recording.
 */

import { useEffect } from 'react';
import { getRecorder, resetRecorder } from 'sigillum-js';

/**
 * 方式 1: 最简单 - 适合快速验证
 */
export function QuickStartBasic() {
  useEffect(() => {
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

    recorder.start();
    console.log('[SessionRecorder] 录制已开始');

    return () => {
      recorder.stop();
      console.log('[SessionRecorder] 录制已停止');
    };
  }, []);

  return null;
}

/**
 * 方式 2: 带字段映射 - 适配自定义后端
 */
export function QuickStartWithFieldMapping() {
  useEffect(() => {
    const recorder = getRecorder({
      // 字段映射：适配你的后端数据结构
      fieldMapping: [
        ['sessionId', 'id'],
        ['events', 'content', JSON.stringify, JSON.parse],
        ['startTime', 'start_at'],
        ['endTime', 'end_at'],
        ['duration', 'duration_ms'],
        ['url', 'page_url'],
        ['userAgent', 'user_agent'],
        ['screenResolution', 'screen'],
        ['viewport', 'viewport'],
        ['tags', 'tags', JSON.stringify, JSON.parse],
      ],
      // 上传前添加额外字段
      beforeUpload: (data) => ({
        ...data,
        user_id: getUserId(), // 你的用户 ID 获取函数
        created_at: new Date().toISOString(),
      }),
      onUpload: async (data) => {
        const response = await fetch('/api/recordings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        return { success: response.ok };
      },
    });

    recorder.start();

    return () => {
      recorder.stop();
    };
  }, []);

  return null;
}

// 假设的用户 ID 获取函数
function getUserId(): string {
  return 'user-123';
}

/**
 * 方式 3: 生产环境推荐配置
 */
export function QuickStartProduction() {
  useEffect(() => {
    const isProd = process.env.NODE_ENV === 'production';

    const recorder = getRecorder({
      // 条件启用：生产环境 10% 采样，开发环境全量
      enabled: () => !isProd || Math.random() < 0.1,

      // 字段映射
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

      cache: {
        enabled: true,
        saveInterval: 5000,
      },

      maxDuration: 30 * 60 * 1000,
      maxRetries: 3,

      onUpload: async (data) => {
        const response = await fetch('/api/recordings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        return { success: response.ok };
      },

      
      onUnsupported: (reason) => {
        // 可以上报到日志系统
        console.log('Session replay not supported:', reason);
      },
    });

    recorder.start();

    return () => {
      recorder.stop();
      resetRecorder();
    };
  }, []);

  return null;
}

/**
 * 方式 4: 纯本地模式（调试用）
 * 不上传，仅本地缓存，用户手动导出数据
 */
export function QuickStartLocalOnly() {
  useEffect(() => {
    const recorder = getRecorder({
      debug: true,
    });

    recorder.start();

    return () => {
      recorder.stop();
    };
  }, []);

  const handleExport = async () => {
    const recorder = getRecorder();
    if (!recorder) return;

    // 需要先 stop 才能 export
    await recorder.stop();
    const data = recorder.exportRecording();
    if (data) {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recording-${data.sessionId}.json`;
      a.click();
      URL.revokeObjectURL(url);

      recorder.clearRecording();
    }
  };

  return <button onClick={handleExport}>Export Recording</button>;
}

/**
 * 方式 5: 与 Logger 配合
 */
export function QuickStartWithLogger() {
  useEffect(() => {
    // 假设 logger 已初始化
    // import { logger } from '@/utils/logger-config';

    const recorder = getRecorder({
      onUpload: async () => {
        return { success: true };
      },
    });

    // 从 logger 获取 sessionId
    // recorder.setSessionId(logger.getSessionId());

    recorder.start();

    // 监听 error 事件，停止并上传
    // logger.on('error', () => {
    //   recorder.stop();
    // });

    return () => {
      recorder.stop();
    };
  }, []);

  return null;
}

/**
 * 使用指南：
 *
 * 1. 在 app.tsx 中导入并使用：
 *
 * import { QuickStartProduction } from './quickstart';
 *
 * function App() {
 *   return (
 *     <>
 *       <QuickStartProduction />
 *       <YourApp />
 *     </>
 *   );
 * }
 *
 * 2. 在业务代码中添加标记：
 *
 * import { getRecorder } from 'sigillum-js';
 *
 * function handleCheckout() {
 *   const recorder = getRecorder();
 *   recorder?.addTag('checkout-start', { cartValue: 100 });
 * }
 *
 * 3. 后端接口：
 *
 * - POST /api/recordings - 接收录制数据
 * - GET /api/recordings/:id - 获取录制数据（用于回放）
 *
 * 4. 回放页面：
 *
 * import { ReplayPage } from 'sigillum-js/ui';
 *
 * function ReplayView({ sessionId }) {
 *   const [data, setData] = useState(null);
 *
 *   useEffect(() => {
 *     fetch(`/api/recordings/${sessionId}`)
 *       .then(res => res.json())
 *       .then(setData);
 *   }, [sessionId]);
 *
 *   if (!data) return <div>Loading...</div>;
 *
 *   return (
 *     <ReplayPage
 *       data={data}
 *       fieldMapping={[
 *         ['sessionId', 'id'],
 *         ['events', 'content', JSON.stringify, JSON.parse],
 *         // ... 和录制时相同
 *       ]}
 *     />
 *   );
 * }
 */

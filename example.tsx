/**
 * sigillum-js React examples.
 */

import { useEffect } from 'react';
import { getRecorder, resetRecorder } from 'sigillum-js';
import { useSessionRecorder, useAutoRecord } from 'sigillum-js/react';
import { ReplayPlayer, ReplayPage } from 'sigillum-js/ui';

/**
 * 示例 1: 基础使用
 */
export function Example1_BasicUsage() {
  useEffect(() => {
    const recorder = getRecorder({
      onUpload: async (data) => {
        console.log('上传数据:', data);
        await fetch('/api/recordings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        return { success: true };
      },
      debug: true,
    });

    recorder.start();

    return () => {
      recorder.stop();
    };
  }, []);

  return <div>基础使用示例 - 查看控制台</div>;
}

/**
 * 示例 2: 字段映射（适配后端）
 */
export function Example2_FieldMapping() {
  useEffect(() => {
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
        console.log('后端格式数据:', data);
        // data 结构: { id, content, start_at, end_at, duration_ms, page_url, user_id, created_at }
        return { success: true };
      },
    });

    recorder.start();

    return () => {
      recorder.stop();
    };
  }, []);

  return <div>字段映射示例 - 查看控制台</div>;
}

/**
 * 示例 3: 条件启用
 */
export function Example3_ConditionalEnable() {
  useEffect(() => {
    const recorder = getRecorder({
      // 只录制 VIP 用户或 10% 的普通用户
      enabled: () => {
        const isVIP = localStorage.getItem('isVIP') === 'true';
        return isVIP || Math.random() < 0.1;
      },
      onUpload: async () => {
        return { success: true };
      },
      onUnsupported: (reason) => {
        console.log('录制不支持:', reason);
      },
    });

    recorder.start();

    return () => {
      recorder.stop();
    };
  }, []);

  return <div>条件启用示例</div>;
}

/**
 * 示例 4: 与 Logger 配合
 */
export function Example4_WithLogger() {
  useEffect(() => {
    // 假设 logger 已初始化
    // import { logger } from '@/utils/logger-config';

    const recorder = getRecorder({
      onUpload: async () => {
        return { success: true };
      },
    });

    // 从 logger 获取 sessionId（假设 logger 有这个方法）
    // recorder.setSessionId(logger.getSessionId());

    recorder.start();

    // 监听 logger 的 error 事件，停止并上传
    // logger.on('error', () => {
    //   recorder.stop();
    // });

    return () => {
      recorder.stop();
    };
  }, []);

  return <div>与 Logger 配合示例</div>;
}

/**
 * 示例 5: React Hook - 手动控制
 */
export function Example5_ReactHook() {
  const { start, stop, pause, resume, addTag, getStatus, getSessionId } =
    useSessionRecorder({
      onUpload: async (data) => {
        console.log('上传:', data);
        return { success: true };
      },
    });

  return (
    <div>
      <h2>React Hook 示例</h2>
      <p>状态: {getStatus()}</p>
      <p>SessionId: {getSessionId()}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={start}>开始</button>
        <button onClick={() => stop()}>停止</button>
        <button onClick={pause}>暂停</button>
        <button onClick={resume}>恢复</button>
        <button onClick={() => addTag('custom-tag', { time: Date.now() })}>
          添加标记
        </button>
      </div>
    </div>
  );
}

/**
 * 示例 6: React Hook - 自动录制
 */
export function Example6_AutoRecord() {
  const { sessionId, status, addTag, identify } = useAutoRecord({
    onUpload: async (data) => {
      console.log('上传:', data);
      return { success: true };
    },
  });

  // 关联用户身份（登录后等任意时刻调用）
  identify('user-123', { plan: 'pro' });

  return (
    <div>
      <h2>自动录制示例</h2>
      <p>状态: {status}，SessionId: {sessionId}</p>
      <button onClick={() => addTag('button-click')}>添加标记</button>
    </div>
  );
}

/**
 * 示例 7: 回放组件
 */
export function Example7_ReplayPlayer() {
  // 模拟从后端获取的数据（使用固定时间戳，仅为示例）
  const serverData = {
    id: 'session-123',
    content: '[]', // JSON.stringify(events)
    start_at: 1700000000000, // 固定时间戳
    end_at: 1700000060000,
    duration_ms: 60000,
    page_url: 'https://example.com',
    viewport: { width: 1280, height: 720 },
  };

  return (
    <div style={{ height: 600 }}>
      <h2>回放组件示例</h2>
      <ReplayPlayer
        data={serverData}
        fieldMapping={[
          ['sessionId', 'id'],
          ['events', 'content', JSON.stringify, JSON.parse],
          ['startTime', 'start_at'],
          ['endTime', 'end_at'],
          ['duration', 'duration_ms'],
          ['url', 'page_url'],
        ]}
        config={{
          speed: 1,
          autoPlay: false,
          showController: true,
        }}
      />
    </div>
  );
}

/**
 * 示例 8: 完整回放页面
 */
export function Example8_ReplayPage() {
  // 模拟从后端获取的数据（使用固定时间戳，仅为示例）
  const serverData = {
    id: 'session-123',
    content: '[]',
    start_at: 1700000000000, // 固定时间戳
    end_at: 1700000060000,
    duration_ms: 60000,
    page_url: 'https://example.com',
    viewport: { width: 1280, height: 720 },
  };

  return (
    <div style={{ height: '100vh', padding: 16 }}>
      <h2>完整回放页面示例</h2>
      <ReplayPage
        data={serverData}
        fieldMapping={[
          ['sessionId', 'id'],
          ['events', 'content', JSON.stringify, JSON.parse],
          ['startTime', 'start_at'],
          ['endTime', 'end_at'],
          ['duration', 'duration_ms'],
          ['url', 'page_url'],
        ]}
        showInfo={true}
      />
    </div>
  );
}

/**
 * 示例 9: 隐私保护
 */
export function Example9_Privacy() {
  useEffect(() => {
    const recorder = getRecorder({
      rrwebConfig: {
        privacy: {
          maskAllInputs: false,
          maskInputOptions: { password: true },
          maskTextSelector: '.sensitive',
          ignoreClass: 'rr-ignore',
        },
      },
      onUpload: async () => {
        return { success: true };
      },
    });

    recorder.start();

    return () => {
      recorder.stop();
    };
  }, []);

  return (
    <div>
      <h2>隐私保护示例</h2>
      <form>
        <div>
          <label>用户名:</label>
          <input type="text" placeholder="会被录制" />
        </div>
        <div>
          <label>密码:</label>
          <input type="password" placeholder="会被屏蔽" />
        </div>
        <div className="sensitive">这段文字会被屏蔽</div>
        <div className="rr-ignore">这个区域完全不录制</div>
      </form>
    </div>
  );
}

/**
 * 示例 10: 生产环境配置
 */
export function Example10_Production() {
  useEffect(() => {
    const isProd = process.env.NODE_ENV === 'production';

    const recorder = getRecorder({
      enabled: () => {
        // 生产环境：只录制 10% 的用户
        // 开发环境：总是录制
        return !isProd || Math.random() < 0.1;
      },
      rrwebConfig: {
        recordMouseMove: true,
        mouseMoveInterval: isProd ? 100 : 50, // 生产环境降低采样
        recordCanvas: false, // 不录制 Canvas
        privacy: {
          maskInputOptions: { password: true },
        },
      },
      cache: {
        enabled: true,
        saveInterval: 5000,
      },
      maxDuration: 30 * 60 * 1000, // 30 分钟
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
        // 记录到日志系统
        console.log('Session replay not supported:', reason);
      },
    });

    recorder.start();

    return () => {
      recorder.stop();
      resetRecorder();
    };
  }, []);

  return <div>生产环境配置示例</div>;
}

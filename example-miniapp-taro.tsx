/**
 * sigillum-js Taro 框架接入示例
 *
 * 环境要求：Taro >= 3.0.0
 * 采集模式：自动采集（monkey-patch dispatchEvent，零手动埋点）
 */

// ==================== app.tsx ====================

import { useEffect, type ReactNode } from 'react';
import Taro from '@tarojs/taro';
import { createTaroRecorder, getTaroSigillum } from 'sigillum-js/miniapp/taro';

const recorder = createTaroRecorder({
  autoCapture: true,
  appVersion: '1.0.0',
  monitoring: { preset: 'full' },

  // data 是 SigillumRecording 信封格式，后端可通过 data.source 区分 web / miniapp
  onUpload: async (data) => {
    const res = await Taro.request({
      url: 'https://your-api.com/api/recordings',
      method: 'POST',
      data,
    });
    return { success: res.statusCode === 200 };
  },

  chunkedUpload: {
    enabled: true,
    interval: 60000,
  },
  onChunkUpload: async (chunk) => {
    await Taro.request({
      url: 'https://your-api.com/api/recording-chunks',
      method: 'POST',
      data: chunk,
    });
    return { success: true };
  },

  onError: (error) => {
    console.error('[sigillum] 错误:', error.message);
  },
});

function App({ children }: { children: ReactNode }) {
  useEffect(() => {
    recorder.start();
    return () => {
      // fire-and-forget: stop 是异步的，但 React 清理函数不能 await
      // 未上传完的数据会由 onChunkUpload 在下次启动时恢复
      recorder.stop();
    };
  }, []);

  return <>{children}</>;
}

export default App;

// ==================== pages/index/index.tsx ====================

import { View, Button, Input, ScrollView, Text } from '@tarojs/components';

function IndexPage() {
  const handleBuy = () => {
    // 不需要手动 track —— 自动采集
    Taro.navigateTo({ url: '/pages/order/order?productId=123' });
  };

  const handleSearch = (e: any) => {
    // 不需要手动 track —— 自动采集
    console.log('搜索:', e.detail.value);
  };

  // 在页面根 View 上绑定 onTouchStart，使 full 模式能捕获任意位置的触摸。
  // 使用 onTouchStart（而非 catchTouchStart）不会阻止事件冒泡，对业务逻辑无影响。
  return (
    <View onTouchStart={() => {}} onTouchEnd={() => {}}>
      <Input placeholder="搜索商品..." onInput={handleSearch} />

      <ScrollView scrollY style={{ height: '80vh' }}>
        <View data-id="product-1">
          <Text>商品 A - ¥99</Text>
          <Button onClick={handleBuy}>立即购买</Button>
        </View>
        <View data-id="product-2">
          <Text>商品 B - ¥199</Text>
          <Button onClick={handleBuy}>立即购买</Button>
        </View>
      </ScrollView>
    </View>
  );
}

export default IndexPage;

// ==================== 手动追踪自定义业务事件 ====================

function trackAddToCart(productId: string, price: number) {
  getTaroSigillum()?.trackEvent({
    type: 'custom',
    timestamp: Date.now(),
    data: {
      name: 'add_to_cart',
      payload: { productId, price },
    },
  });
}

// ==================== 登录后关联用户 ====================

async function handleLogin() {
  const userInfo = await Taro.getUserInfo();
  getTaroSigillum()?.identify('user-456', {
    nickname: userInfo.userInfo.nickName,
  });
}

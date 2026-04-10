import { defineConfig } from 'tsup';
import pkg from './package.json';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    vue: 'src/vue.ts',
    'ui/index': 'src/ui/index.ts',
    miniapp: 'src/miniapp.ts',
    'miniapp-taro': 'src/miniapp-taro.ts',
    'replay/index': 'src/replay/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: ['react', 'react-dom', 'vue', 'rrweb', 'rrweb-player', '@tarojs/runtime', '@tarojs/taro'],
  treeshake: true,
  minify: false,
  target: 'es2020',
  define: {
    __SIGILLUM_VERSION__: JSON.stringify(pkg.version),
  },
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});


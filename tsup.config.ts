import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'index.ts',
    react: 'react.ts',
    vue: 'vue.ts',
    'ui/index': 'ui/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: ['react', 'react-dom', 'vue', 'rrweb', 'rrweb-player'],
  treeshake: true,
  minify: false,
  target: 'es2020',
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});


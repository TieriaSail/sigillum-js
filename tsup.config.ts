import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    vue: 'src/vue.ts',
    'ui/index': 'src/ui/index.ts',
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


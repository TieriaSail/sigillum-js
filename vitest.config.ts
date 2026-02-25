import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: [
        'SessionRecorder.ts',
        'FieldMapper.ts',
        'CacheManager.ts',
        'compatibility.ts',
        'react.ts',
        'vue.ts',
        'ui/**/*.tsx',
      ],
    },
  },
});


import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/SessionRecorder.ts',
        'src/FieldMapper.ts',
        'src/CacheManager.ts',
        'src/compatibility.ts',
        'src/react.ts',
        'src/vue.ts',
        'src/ui/**/*.tsx',
      ],
    },
  },
});


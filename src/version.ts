/**
 * SDK 版本号
 *
 * 构建时由 tsup 的 define 从 package.json 注入。
 * 测试环境（vitest）中 __SIGILLUM_VERSION__ 未定义，回退到硬编码值。
 */
export const SDK_VERSION: string =
  typeof __SIGILLUM_VERSION__ !== 'undefined'
    ? __SIGILLUM_VERSION__
    : '2.0.0-beta.1';

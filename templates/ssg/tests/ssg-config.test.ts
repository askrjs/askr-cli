import { describe, expect, it } from 'vite-plus/test';
import { routes } from '../ssg.config';

describe('SSG config', () => {
  it('keeps the sample route tree explicit', () => {
    expect(routes.map((route) => route.path).sort()).toEqual([
      '/',
      '/content',
      '/preview',
      '/workflow',
    ].sort());
    expect(routes).toHaveLength(4);
    expect(routes.every((route) => typeof route.handler === 'function')).toBe(true);
  });
});
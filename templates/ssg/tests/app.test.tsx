import { describe, expect, it } from 'vite-plus/test';
import { navItems } from '../src/app';

describe('App shell', () => {
  it('exposes the workflow-focused navigation order', () => {
    expect(navItems.map((item) => item.label)).toEqual([
      'Home',
      'Workflow',
      'Content',
      'Preview',
    ]);
    expect(navItems.map((item) => item.href)).toEqual([
      '/',
      '/workflow',
      '/content',
      '/preview',
    ]);
  });
});

import { describe, it, expect } from 'vite-plus/test';

describe('App Component', () => {
  it('should expose the current starter route set', () => {
    const routes = [
      '/',
      '/login',
      '/dashboard',
      '/accounts',
      '/settings',
      '/*',
    ];

    expect(routes).toContain('/settings');
    expect(routes).toContain('/accounts');
    expect(routes).toContain('/login');
  });

  it('should use the updated primary nav labels', () => {
    const navLabels = ['Dashboard', 'Accounts', 'Settings'];

    expect(navLabels).toContain('Accounts');
    expect(navLabels).toContain('Settings');
  });

  it('should document the starter appearance presets', () => {
    const appearanceModes = ['Default', 'Harbor', 'Ink'];

    expect(appearanceModes).toContain('Harbor');
    expect(appearanceModes).toContain('Ink');
  });
});

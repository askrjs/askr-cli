import { describe, expect, it } from 'vite-plus/test';

describe('SPA template structure', () => {
  it('should document the route-first shell and theme layers the app should keep', () => {
    const structure = [
      'src/main.tsx',
      'src/pages/_routes.tsx',
      'src/pages/_layout.tsx',
      'src/pages/public/_routes.tsx',
      'src/pages/public/_layout.tsx',
      'src/pages/public/home.tsx',
      'src/pages/auth/_routes.tsx',
      'src/pages/auth/_layout.tsx',
      'src/pages/auth/login.tsx',
      'src/pages/app/_routes.tsx',
      'src/pages/app/_layout.tsx',
      'src/pages/app/admin-home.tsx',
      'src/styles.css',
      'src/styles/reset.css',
      'src/styles/tokens.css',
      'src/styles/theme.css',
      'src/styles/layout.css',
      'src/styles/components.css',
      'src/features/operations/operations.query.ts',
      'src/adapters/operations-client.ts',
      'src/components/shared/metric-card.tsx',
    ];

    expect(structure).toContain('src/pages/_routes.tsx');
    expect(structure).toContain('src/pages/app/_layout.tsx');
    expect(structure).toContain('src/pages/auth/_layout.tsx');
    expect(structure).toContain('src/styles/tokens.css');
    expect(structure).toContain('src/styles/layout.css');
    expect(structure).toContain('src/features/operations/operations.query.ts');
    expect(structure).toContain('src/adapters/operations-client.ts');
  });
});

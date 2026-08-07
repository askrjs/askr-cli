import { describe, expect, it } from 'vite-plus/test';
import { staticConfig } from '../ssg.config';

describe('SSG config', () => {
  it('should keep the sample route tree explicit', () => {
    expect(
      staticConfig.registry.manifest.records.map((route) => route.path).sort()
    ).toEqual(['/', '/content', '/preview', '/workflow'].sort());
    expect(staticConfig.registry.routes).toHaveLength(4);
    expect(staticConfig.siteUrl).toBe('https://example.com');
    expect(staticConfig.sitemap.routes['/preview']).toBe(false);
    expect(staticConfig.styleRegistrationValidation).toBe('error');
  });
});

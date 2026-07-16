import { describe, expect, it } from 'vite-plus/test';
import { staticConfig } from '../ssg.config';

describe('SSG config', () => {
  it('keeps the sample route tree explicit', () => {
    expect(staticConfig.registry.manifest.records.map((route) => route.path).sort()).toEqual(
      ['/', '/content', '/preview', '/workflow'].sort()
    );
    expect(staticConfig.registry.routes).toHaveLength(4);
  });
});

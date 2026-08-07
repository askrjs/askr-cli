import { describe, expect, it } from 'vite-plus/test';
import { renderToString } from '@askrjs/askr/ssr';
import Counter from '../../src/components/counter';

describe('Counter', () => {
  it('should render its initial state during SSR', () => {
    const html = renderToString(() => <Counter />);

    expect(html).toContain('counter-value');
    expect(html).toContain('>0<');
    expect(html).toContain('>even<');
  });
});

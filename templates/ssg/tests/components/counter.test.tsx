import { describe, it, expect } from 'vite-plus/test';
import { renderToString } from '@askrjs/askr/ssr';
import Counter from '../../src/components/counter';

describe('Counter', () => {
  it('renders the initial hydration check view', () => {
    const html = renderToString(() => <Counter />);

    expect(html).toContain('Hydration check');
    expect(html).toContain('This counter should still feel live after static generation.');
    expect(html).toContain('0');
    expect(html).toContain('even');
    expect(html).toContain('- Decrement');
    expect(html).toContain('+ Increment');
  });
});

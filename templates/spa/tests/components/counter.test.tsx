import { describe, expect, it } from 'vite-plus/test';
import Counter from '../../src/components/counter';

describe('Counter', () => {
  it('exports a counter component', () => {
    expect(Counter).toBeDefined();
    expect(typeof Counter).toBe('function');
  });
});

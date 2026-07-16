import { describe, expect, it } from 'vitest';
import { createMessageAction } from '../../src/actions/create-message';

describe('create message action', () => {
  it('should reject an empty message given declared input validation', () => {
    expect(createMessageAction.input.safeParse({ value: '' }).success).toBe(false);
  });

  it('should accept a message given valid input', () => {
    expect(createMessageAction.input.safeParse({ value: 'hello' }).success).toBe(true);
  });
});


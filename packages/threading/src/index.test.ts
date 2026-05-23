import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeSubject, normalizeMessageId } from './index.js';

describe('normalizeSubject', () => {
  it('strips Re: prefix', () => {
    assert.equal(normalizeSubject('Re: Invoice question'), 'invoice question');
  });

  it('strips Fwd: prefix', () => {
    assert.equal(normalizeSubject('Fwd: Hello'), 'hello');
  });
});

describe('normalizeMessageId', () => {
  it('returns bracket variants', () => {
    const ids = normalizeMessageId('<abc@example.com>');
    assert.ok(ids.includes('<abc@example.com>'));
    assert.ok(ids.includes('abc@example.com'));
  });
});

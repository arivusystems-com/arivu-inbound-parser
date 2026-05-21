import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRoutingAddress, buildRoutingAddress } from './index.js';

describe('parseRoutingAddress', () => {
  it('parses plus-address routing', () => {
    const result = parseRoutingAddress('support+t_123_m_45@reply.arivusystems.com');
    assert.deepEqual(result, {
      localPart: 'support',
      tenantId: 't_123',
      mailboxId: 'm_45',
      domain: 'reply.arivusystems.com',
      raw: 'support+t_123_m_45@reply.arivusystems.com',
    });
  });

  it('returns null for invalid addresses', () => {
    assert.equal(parseRoutingAddress('support@example.com'), null);
    assert.equal(parseRoutingAddress(''), null);
  });
});

describe('buildRoutingAddress', () => {
  it('builds routing address', () => {
    assert.equal(
      buildRoutingAddress('support', 't_123', 'm_45', 'reply.arivusystems.com'),
      'support+t_123_m_45@reply.arivusystems.com',
    );
  });
});

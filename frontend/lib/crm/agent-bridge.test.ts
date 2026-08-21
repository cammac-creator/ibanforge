import { describe, expect, it } from 'vitest';
import { agentFamily, clientsForBot, matchesForClient } from './agent-bridge';

/**
 * Fixtures are invented on purpose — this repository is public. Never put a
 * real customer address, company or call count in here.
 */
const ACME = {
  id: 'acme@example.com',
  email: 'acme@example.com',
  company: 'Société Alpha',
  userAgents: [
    { ua: 'python-requests/2.32.1', count: 4_200 },
    { ua: 'curl/8.4.0', count: 12 },
  ],
};

describe('agentFamily', () => {
  it('keeps the product name and drops the version', () => {
    expect(agentFamily('python-requests/2.32.1')).toBe('python-requests');
    expect(agentFamily('python-requests/2.31.0')).toBe('python-requests');
  });

  it('cuts at the first space as well as the first slash', () => {
    expect(agentFamily('Mozilla/5.0 (compatible; SomeBot/1.0)')).toBe('mozilla');
    expect(agentFamily('SomeBot 1.0')).toBe('somebot');
  });

  it('folds case so the same tool does not split in two', () => {
    expect(agentFamily('IBANforge-MCP/1.4.3')).toBe(agentFamily('ibanforge-mcp/1.0.0'));
  });

  it('returns null rather than an empty family, so noise never pairs with noise', () => {
    // Two malformed agents must NOT be declared the same tool.
    expect(agentFamily('')).toBeNull();
    expect(agentFamily('  ')).toBeNull();
    expect(agentFamily('/1.0')).toBeNull();
    expect(agentFamily('x/1.0')).toBeNull();
  });
});

describe('matchesForClient', () => {
  it('reports an identical agent string as an exact crossing', () => {
    const m = matchesForClient(
      [{ ua: 'python-requests/2.32.1', count: 4_200 }],
      [{ id: 'python-requests/2.32.1', requests: 900 }],
    );
    expect(m).toEqual([
      { ua: 'python-requests/2.32.1', botId: 'python-requests/2.32.1', kind: 'exact', clientCalls: 4_200, botCalls: 900 },
    ]);
  });

  it('reports a version difference as a family crossing, not an exact one', () => {
    const m = matchesForClient(
      [{ ua: 'python-requests/2.32.1', count: 4_200 }],
      [{ id: 'python-requests/2.31.0', requests: 900 }],
    );
    expect(m).toHaveLength(1);
    expect(m[0].kind).toBe('family');
    expect(m[0].botId).toBe('python-requests/2.31.0');
  });

  it('does not report the same pair twice when both strengths apply', () => {
    const m = matchesForClient(
      [{ ua: 'curl/8.4.0', count: 12 }],
      [{ id: 'curl/8.4.0', requests: 3 }],
    );
    expect(m).toHaveLength(1);
    expect(m[0].kind).toBe('exact');
  });

  it('stays silent when nothing crosses', () => {
    expect(matchesForClient(ACME.userAgents, [{ id: 'SomeCrawler/2.0', requests: 500 }])).toEqual([]);
  });

  it('never crosses two unreadable agent strings', () => {
    expect(matchesForClient([{ ua: '', count: 5 }], [{ id: '', requests: 5 }])).toEqual([]);
  });
});

describe('clientsForBot', () => {
  it('finds the customer behind an identical agent string', () => {
    const c = clientsForBot('curl/8.4.0', [ACME]);
    expect(c).toEqual([{ clientId: 'acme@example.com', label: 'Société Alpha', kind: 'exact', clientCalls: 12 }]);
  });

  it('falls back to the address when no company is known', () => {
    const c = clientsForBot('curl/8.4.0', [{ ...ACME, company: null }]);
    expect(c[0].label).toBe('acme@example.com');
  });

  it('ranks an exact crossing above a busier family one', () => {
    const noisy = {
      id: 'ops@alpha.example.net',
      email: 'ops@alpha.example.net',
      company: null,
      userAgents: [{ ua: 'python-requests/2.20.0', count: 99_000 }],
    };
    const c = clientsForBot('python-requests/2.32.1', [noisy, ACME]);
    expect(c.map((x) => x.clientId)).toEqual(['acme@example.com', 'ops@alpha.example.net']);
    expect(c[0].kind).toBe('exact');
    expect(c[1].kind).toBe('family');
  });

  it('keeps one row per customer even when several of their agents cross', () => {
    const many = {
      id: 'ops@alpha.example.net',
      email: 'ops@alpha.example.net',
      company: null,
      userAgents: [
        { ua: 'python-requests/2.31.0', count: 10 },
        { ua: 'python-requests/2.32.1', count: 20 },
      ],
    };
    const c = clientsForBot('python-requests/2.32.1', [many]);
    expect(c).toHaveLength(1);
    // The exact crossing is the one reported, not the first one encountered.
    expect(c[0].kind).toBe('exact');
    expect(c[0].clientCalls).toBe(20);
  });

  it('returns nothing rather than guessing when the bot agent is unreadable', () => {
    expect(clientsForBot('', [ACME])).toEqual([]);
  });
});

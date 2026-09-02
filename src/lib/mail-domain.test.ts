import { describe, it, expect, beforeEach, vi } from 'vitest';

const resolveMx = vi.fn();
const resolve4 = vi.fn();
const resolve6 = vi.fn();
vi.mock('node:dns', () => ({
  promises: {
    resolveMx: (...a: unknown[]) => resolveMx(...a),
    resolve4: (...a: unknown[]) => resolve4(...a),
    resolve6: (...a: unknown[]) => resolve6(...a),
  },
}));

import { domainAcceptsMail, domainOf, resetMailDomainCache } from './mail-domain.js';

const notFound = () => Object.assign(new Error('nope'), { code: 'ENOTFOUND' });

beforeEach(() => {
  resetMailDomainCache();
  resolveMx.mockReset();
  resolve4.mockReset();
  resolve6.mockReset();
});

describe('domainAcceptsMail', () => {
  it('says yes on an MX record without touching A records', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mx.alpha.example.net', priority: 10 }]);
    expect(await domainAcceptsMail('alpha.example.net')).toBe(true);
    expect(resolve4).not.toHaveBeenCalled();
  });

  it('falls back to an A record when there is no MX', async () => {
    resolveMx.mockRejectedValue(notFound());
    resolve4.mockResolvedValue(['192.0.2.1']);
    expect(await domainAcceptsMail('alpha.example.net')).toBe(true);
  });

  it('says no when neither MX nor A nor AAAA exists', async () => {
    resolveMx.mockRejectedValue(notFound());
    resolve4.mockRejectedValue(notFound());
    resolve6.mockRejectedValue(notFound());
    expect(await domainAcceptsMail('nothing.example.net')).toBe(false);
  });

  it('refuses reserved and documentation domains without a lookup', async () => {
    for (const d of ['acme.invalid', 'corp.internal', 'example.com', 'nodot'])
      expect(await domainAcceptsMail(d)).toBe(false);
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it('fails open on a resolver failure that is not a definite absence', async () => {
    resolveMx.mockRejectedValue(Object.assign(new Error('down'), { code: 'ECONNREFUSED' }));
    expect(await domainAcceptsMail('alpha.example.net')).toBe(true);
  });

  it('remembers a verdict for the hour', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mx', priority: 1 }]);
    await domainAcceptsMail('alpha.example.net');
    await domainAcceptsMail('ALPHA.example.net');
    expect(resolveMx).toHaveBeenCalledTimes(1);
  });

  it('extracts the domain of an address', () => {
    expect(domainOf(' Someone@Alpha.Example.NET ')).toBe('alpha.example.net');
  });
});

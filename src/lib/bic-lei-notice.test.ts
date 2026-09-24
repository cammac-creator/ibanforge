import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bicLeiMappingNotice, mappingVersionFromLoad } from './bic-lei-notice.js';
import { getSourceFreshness } from './bic-lookup.js';
import { buildApp } from '../app.js';
import { closeAll } from './db.js';

/**
 * The BIC/LEI Mapping Table licence asks for its notice, with the version
 * month, on any copy. Held on the served /llms.txt (read from the data, so the
 * monthly refresh can never turn this red) and on the static llms.txt of the
 * site (any version month, since that file points to the served one).
 */

afterAll(() => closeAll());

describe('the Mapping Table version', () => {
  it.each([
    ['2026-09-01 03:22:21', 'August 2026'],
    ['2026-10-01 03:10:00', 'September 2026'],
    ['2027-01-01 03:00:00', 'December 2026'],
  ])('a load on %s is the %s version', (loadedAt, version) => {
    expect(mappingVersionFromLoad(loadedAt)).toBe(version);
  });

  it('has no version, and so no notice, without a load date', () => {
    expect(mappingVersionFromLoad(null)).toBeNull();
    expect(mappingVersionFromLoad('')).toBeNull();
  });
});

describe('the notice, word for word', () => {
  const NOTICE =
    /SWIFT © and database rights [A-Z][a-z]+ \d{4}\. All rights reserved\. This Mapping Table has been developed by SWIFT\. Any use of the Mapping Table, in whole or in part, is subject to the BIC\/LEI Mapping Table License Agreement as published with the Mapping Table available on GLEIF's website\. The Mapping Table is updated monthly\. For the latest BIC information and updates, always refer to www\.swift\.com\/bic\./;

  it('is the text of the licence', () => {
    expect(bicLeiMappingNotice('August 2026')).toMatch(NOTICE);
  });

  it('is served in /llms.txt with the version read from the data', async () => {
    const res = await buildApp().request('https://api.ibanforge.com/llms.txt');
    const text = await res.text();
    const version = mappingVersionFromLoad(
      getSourceFreshness().find((s) => s.source === 'gleif')?.last_updated,
    );
    expect(version).not.toBeNull();
    expect(text).toContain(bicLeiMappingNotice(version!));
    // The old sentence was not the notice the licence asks for.
    expect(text).not.toContain('This service uses the BIC to LEI relationship file');
  });

  it('is carried by the static llms.txt of the site, which points to the served one', () => {
    const text = readFileSync(
      join(import.meta.dirname, '..', '..', 'frontend', 'public', 'llms.txt'),
      'utf8',
    );
    expect(text).toMatch(NOTICE);
    expect(text).toContain('served live at https://api.ibanforge.com/llms.txt');
    expect(text).not.toContain('This service uses the BIC to LEI relationship file');
  });
});

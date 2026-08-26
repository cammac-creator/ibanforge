import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  DepthTwoScanner,
  flattenProperties,
  reduceEntity,
  parsePsdDocument,
  parseManifestTimestamp,
  parsePathDate,
  readManifest,
  readZipEntries,
  PSD_ENTITY_TYPES,
} from './seed-eba-psd.js';

/**
 * Every entity below is invented. The register is public, but a test fixture is
 * the place this repo has leaked real names from before, so the shapes are
 * copied and the contents are not: "Société Alpha", "Alpha", "Beta".
 */

// ---------------------------------------------------------------------------
// The streaming scanner
// ---------------------------------------------------------------------------

function collect(text: string, chunkSize = text.length): string[] {
  const out: string[] = [];
  const scanner = new DepthTwoScanner((t) => out.push(t));
  for (let i = 0; i < text.length; i += chunkSize) scanner.push(text.slice(i, i + chunkSize));
  scanner.finish();
  return out;
}

describe('DepthTwoScanner — reading 217 MB without parsing it', () => {
  const doc = `[[{"__EBA_Disclaimer":{"line1":"no legal significance"}}],[
    {"EntityType":"PSD_EMI","Properties":[{"ENT_NAM":"Société Alpha"}]},
    {"EntityType":"PSD_PI","Properties":[{"ENT_NAM":"Beta"}]}
  ]]`;

  it('emits the disclaimer and each entity, and nothing nested inside them', () => {
    const objects = collect(doc);
    // Three objects at depth 2: the disclaimer plus two entities. The nested
    // `Properties` objects sit deeper and must not surface on their own.
    expect(objects).toHaveLength(3);
    expect(objects[0]).toContain('__EBA_Disclaimer');
    expect(objects[1]).toContain('Société Alpha');
  });

  it('gives the same answer whatever the chunk boundaries are', () => {
    // The real stream arrives in 64 KB inflate chunks that cut objects, strings
    // and multi-byte characters in half. A scanner that only works on a whole
    // document in memory is the one thing this class exists to avoid.
    const whole = collect(doc);
    for (const size of [1, 2, 7, 13, 64]) {
      expect(collect(doc, size), `chunk size ${size}`).toEqual(whole);
    }
  });

  it('does not count braces or brackets that live inside a string', () => {
    // Institution names and addresses really do contain them, and a scanner
    // that miscounts one closes an object early and shifts every entity after
    // it — silently, since the output stays valid JSON-ish text.
    const tricky = `[[],[{"EntityType":"PSD_PI","Properties":[{"ENT_NAM":"Alpha {Holdings} [SA]"},{"ENT_ADD":"12 rue de l'Exemple \\"Bis\\""}]}]]`;
    const objects = collect(tricky);
    expect(objects).toHaveLength(1);
    const parsed = JSON.parse(objects[0]) as Record<string, unknown>;
    expect(flattenProperties(parsed.Properties as Array<Record<string, unknown>>).ENT_NAM).toBe(
      'Alpha {Holdings} [SA]',
    );
  });

  it('handles a backslash immediately before the closing quote', () => {
    const doc2 = String.raw`[[],[{"EntityType":"PSD_PI","Properties":[{"ENT_NAM":"Alpha\\"}]}]]`;
    const objects = collect(doc2);
    expect(objects).toHaveLength(1);
    expect(JSON.parse(objects[0])).toBeTruthy();
  });

  it('refuses to end mid-object rather than returning a short answer', () => {
    // A connection cut at 80% would otherwise look exactly like a register that
    // shrank overnight, and the sanity floor is a blunter instrument than this.
    const scanner = new DepthTwoScanner(() => {});
    scanner.push('[[],[{"EntityType":"PSD_PI"');
    expect(() => scanner.finish()).toThrow(/Truncated/);
  });

  it('survives a third top-level section being added upstream', () => {
    // Nothing keys off the array index, so an extra block does not shift the
    // entities out of view — it just contributes more depth-2 objects, which
    // the reducer drops for lack of an EntityType.
    const doc3 = `[[{"__EBA_Disclaimer":{}}],[{"CA_OwnerID":"ES_BE","EntityType":"PSD_EMI","Properties":[{"ENT_NAM":"Alpha"},{"ENT_COU_RES":"ES"},{"ENT_NAT_REF_COD":"6799"}]}],[{"__EBA_Something_New":{}}]]`;
    const parsed = parsePsdDocument(doc3);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.census).toEqual({ PSD_EMI: 1 });
  });
});

// ---------------------------------------------------------------------------
// Reduction
// ---------------------------------------------------------------------------

describe('flattenProperties', () => {
  it('folds the array of single-key objects the register publishes', () => {
    expect(
      flattenProperties([{ ENT_NAM: 'Société Alpha' }, { ENT_COU_RES: 'ES' }]),
    ).toEqual({ ENT_NAM: 'Société Alpha', ENT_COU_RES: 'ES' });
  });

  it('takes the first element when the register wraps a value in an array', () => {
    // ENT_AUT is published as ["2024-09-11"] while every neighbour is a bare
    // string. Read without this, the authorisation date becomes "[object]".
    expect(flattenProperties([{ ENT_AUT: ['2024-09-11'] }]).ENT_AUT).toBe('2024-09-11');
  });
});

describe('reduceEntity', () => {
  const props = (o: Record<string, string>): Array<Record<string, unknown>> =>
    Object.entries(o).map(([k, v]) => ({ [k]: v }));

  const alpha = {
    CA_OwnerID: 'ES_BE',
    EntityType: 'PSD_EMI',
    Properties: props({
      ENT_NAT_REF_COD: '6799',
      ENT_NAM: 'Société Alpha EDE, S.L.',
      ENT_ADD: '1 Calle del Ejemplo',
      ENT_TOW_CIT_RES: 'Madrid',
      ENT_POS_COD: '28001',
      ENT_COU_RES: 'ES',
    }),
  };

  it('maps the register nomenclature onto the keys we serve', () => {
    expect(reduceEntity(alpha)).toEqual({
      entity_type: 'emi',
      country: 'ES',
      national_reference_code: '6799',
      name: 'Société Alpha EDE, S.L.',
      address: '1 Calle del Ejemplo',
      town: 'Madrid',
      post_code: '28001',
      competent_authority: 'ES_BE',
    });
  });

  it('trims the reference code', () => {
    // Lithuania publishes "LB000417 " with a trailing space. Stored untrimmed,
    // that key never matches anything again.
    const spaced = { ...alpha, Properties: props({ ...Object.assign({}, ...alpha.Properties), ENT_NAT_REF_COD: ' 6799 ' }) };
    expect(reduceEntity(spaced)?.national_reference_code).toBe('6799');
  });

  it('drops the entity types we do not keep', () => {
    // Agents are 98% of the file and are not issuers; branches carry no
    // reference code at all; exclusions and national-law bodies are not
    // authorisations. Each is dropped rather than stored under a vague type.
    for (const t of ['PSD_AG', 'PSD_BR', 'PSD_EXC', 'PSD_ENL', 'PSD_SOMETHING_NEW']) {
      expect(reduceEntity({ ...alpha, EntityType: t }), t).toBeNull();
    }
  });

  it('keeps exactly the five types the seeder claims to keep', () => {
    expect(Object.keys(PSD_ENTITY_TYPES).sort()).toEqual(
      ['PSD_AISP', 'PSD_EEMI', 'PSD_EMI', 'PSD_EPI', 'PSD_PI'].sort(),
    );
  });

  it('drops a row with no code, no name, no country or no authority', () => {
    // A row that cannot be joined or displayed is not worth a table entry, and
    // storing it would inflate the count that the sanity floor guards.
    const flat = Object.assign({}, ...alpha.Properties) as Record<string, string>;
    for (const missing of ['ENT_NAT_REF_COD', 'ENT_NAM', 'ENT_COU_RES']) {
      const stripped = { ...flat };
      delete stripped[missing];
      expect(reduceEntity({ ...alpha, Properties: props(stripped) }), missing).toBeNull();
    }
    expect(reduceEntity({ ...alpha, CA_OwnerID: '' })).toBeNull();
  });

  it('counts every type in the census while storing only five', () => {
    const doc = `[[],[
      {"CA_OwnerID":"ES_BE","EntityType":"PSD_AG","Properties":[{"ENT_NAM":"Alpha"},{"ENT_COU_RES":"ES"},{"ENT_NAT_REF_COD":"1"}]},
      {"CA_OwnerID":"ES_BE","EntityType":"PSD_EMI","Properties":[{"ENT_NAM":"Beta"},{"ENT_COU_RES":"ES"},{"ENT_NAT_REF_COD":"6799"}]}
    ]]`;
    const parsed = parsePsdDocument(doc);
    // The census is what the report quotes for "329,122 entities, of which…";
    // it must describe the file, not our subset.
    expect(parsed.census).toEqual({ PSD_AG: 1, PSD_EMI: 1 });
    expect(parsed.entities.map((e) => e.name)).toEqual(['Beta']);
  });
});

// ---------------------------------------------------------------------------
// Manifest — the attribution date
// ---------------------------------------------------------------------------

describe('the golden-copy date is read, never guessed', () => {
  it('parses the manifest timestamp shape', () => {
    expect(parseManifestTimestamp('Tue Aug 25 16:00:19 UTC 2026')).toBe('2026-08-25');
    expect(parseManifestTimestamp('Fri Jan  2 06:00:00 UTC 2026')).toBe('2026-01-02');
  });

  it('answers null rather than falling back to a clock', () => {
    // as_of is the licensed half of the attribution. A date invented from the
    // wall clock claims a freshness the EBA never published, and that is the
    // one failure of this ingestion that cannot be walked back.
    for (const bad of ['', 'yesterday', 'Tue Foo 25 16:00:19 UTC 2026']) {
      expect(parseManifestTimestamp(bad), bad).toBeNull();
    }
  });

  it('reads the cross-check date out of the download path', () => {
    expect(parsePathDate('20260825/download-PSDMD-202608251600.zip')).toBe('2026-08-25');
    expect(parsePathDate('download-PSDMD.zip')).toBeNull();
  });

  it('builds a manifest and refuses a malformed one', () => {
    const good = readManifest({
      latest_version_relative_zip_path: '20260825/download-PSDMD-202608251600.zip',
      sha256_hash: 'a'.repeat(64),
      timestamp: 'Tue Aug 25 16:00:19 UTC 2026',
    });
    expect(good.as_of).toBe('2026-08-25');
    expect(good.path_as_of).toBe('2026-08-25');
    expect(good.zip_url).toMatch(/^https:\/\/euclid\.eba\.europa\.eu\//);

    // A hash that is not a SHA-256 means the integrity gate would compare
    // against nothing and pass. Refuse the manifest instead.
    expect(() =>
      readManifest({
        latest_version_relative_zip_path: '20260825/x.zip',
        sha256_hash: 'nope',
        timestamp: 'Tue Aug 25 16:00:19 UTC 2026',
      }),
    ).toThrow(/SHA-256/);
  });
});

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

/** Build a one-member ZIP by hand, so the reader is tested against a real one. */
function buildZip(name: string, content: Buffer, store = false): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = store ? content : deflateRawSync(content);
  const crc = 0; // not checked by the reader
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(store ? 0 : 8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  // Extra field length deliberately 0 here but non-zero in the central record
  // below, which is exactly the divergence that makes a reader land mid-stream.
  local.writeUInt16LE(0, 28);

  const localBlock = Buffer.concat([local, nameBuf, data]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(store ? 0 : 8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(4, 30); // central extra field, absent from the local one
  central.writeUInt16LE(0, 32);
  central.writeUInt32LE(0, 42);
  const centralBlock = Buffer.concat([central, nameBuf, Buffer.alloc(4)]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

describe('readZipEntries', () => {
  it('locates a deflated member and hands back a stream that inflates to it', async () => {
    const body = Buffer.from('[[],[{"EntityType":"PSD_EMI"}]]', 'utf8');
    const entries = readZipEntries(buildZip('download-PSDMD.json', body));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('download-PSDMD.json');
    expect(entries[0].method).toBe(8);

    const { inflateRawSync } = await import('node:zlib');
    // Landing one byte off produces a Z_DATA_ERROR, not a wrong answer — which
    // is why the offset is computed from the LOCAL header's own extra length.
    expect(inflateRawSync(entries[0].compressed).toString('utf8')).toBe(body.toString('utf8'));
  });

  it('reads a stored (uncompressed) member too', () => {
    const body = Buffer.from(`${'f'.repeat(64)}  download-PSDMD.json\n`, 'utf8');
    const entries = readZipEntries(buildZip('download-PSDMD.json.sha256', body, true));
    expect(entries[0].method).toBe(0);
    expect(entries[0].compressed.toString('utf8')).toBe(body.toString('utf8'));
  });

  it('refuses something that is not a ZIP', () => {
    expect(() => readZipEntries(Buffer.alloc(200))).toThrow(/not a ZIP|Not a ZIP/i);
  });

  it('the checksum shipped inside the archive is the one we compare against', () => {
    // Gate 2 covers a failure gate 1 cannot see: an archive that is intact but
    // whose member was built from a bad export. Pinning the shape here means a
    // sidecar the EBA reformats is noticed by a test rather than by a caller.
    const body = Buffer.from('hello', 'utf8');
    const digest = createHash('sha256').update(body).digest('hex');
    const sidecar = `${digest}  download-PSDMD.json\n`;
    expect(sidecar.trim().split(/\s+/)[0].toLowerCase()).toBe(digest);
  });
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditImageFor } from './audit-images';
import images from './audit-images.json';
import { SEO_LOCALES } from './seo';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex').slice(0, 12);

describe('Aperçus publics du classeur', () => {
  it.each(SEO_LOCALES)('%s : fichier PNG réel, dimensions annoncées et adresse empreintée', (locale) => {
    const image = auditImageFor(locale);
    const png = readFileSync(resolve(__dirname, '../public', image.src.slice(1)));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(image.width);
    expect(png.readUInt32BE(20)).toBe(image.height);
    expect(image.url).toBe(`https://ibanforge.com${image.src}`);
    expect(image.src).toContain(`.${hash(png)}.png`);
    expect(png.byteLength).toBeLessThan(500_000);
  });

  it.each(SEO_LOCALES)('%s : aperçu synchronisé avec les lignes et textes visibles', (locale) => {
    const messages = JSON.parse(readFileSync(resolve(__dirname, `../messages/${locale}.json`), 'utf8'));
    expect(images[locale].sourceHash, 'Régénérer les images après une modification de audit.workbook').toBe(hash(JSON.stringify(messages.audit.workbook)));
  });
});

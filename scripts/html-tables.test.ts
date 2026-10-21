import { describe, expect, it } from 'vitest';
import { cellLines, cellText, decodeEntities, parseHtmlTables } from './html-tables.js';

describe('decodeEntities', () => {
  it('lit les entités nommées, décimales et hexadécimales, et laisse intactes celles qu’il ne connaît pas', () => {
    expect(decodeEntities('A&amp;B &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x41; &nbsp;|')).toBe(
      'A&B <c> "d" \'e\' A  |',
    );
    expect(decodeEntities('&inconnue; &#0; &#x110000;')).toBe('&inconnue; &#0; &#x110000;');
  });
});

describe('cellLines', () => {
  it('sépare les paragraphes et les sauts de ligne, retire les balises et les espaces de remplissage', () => {
    expect(cellLines('<p>96</p>\n<p>17</p>')).toEqual(['96', '17']);
    expect(cellLines('a<br>b<br />&nbsp;<br/>c')).toEqual(['a', 'b', 'c']);
    expect(cellLines('<a href="/x"><span data-teams="true">Lightspark AS</span></a>')).toEqual([
      'Lightspark AS',
    ]);
    expect(cellLines('&nbsp;\n\n  UHISEE21  \n')).toEqual(['UHISEE21']);
    expect(cellLines('&nbsp;')).toEqual([]);
  });

  it('ne laisse jamais une balise derrière une balise imbriquée ni un chevron isolé', () => {
    for (const nasty of ['<<script>script>x', '<scr<b>ipt>x', 'a<script', 'a>b<', '<<<b>b>b>x']) {
      const lines = cellLines(nasty);
      expect(lines.join(' '), nasty).not.toMatch(/[<>]/);
    }
    expect(cellLines('a<script>b')).toEqual(['ab']);
  });

  it('joint les lignes d’une cellule en un texte quand on le demande', () => {
    expect(cellText(['Prva banka', 'Crne Gore'])).toBe('Prva banka Crne Gore');
    expect(cellText(undefined)).toBe('');
  });
});

describe('parseHtmlTables', () => {
  const html = `<table><thead><tr><th>Bank</th><th>Code</th></tr></thead>
    <tbody><tr><td>Alpha</td><td><p>01</p><p>02</p></td></tr>
    <tr><th>Section</th><th>&nbsp;</th></tr>
    <tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table>
    <p>entre deux</p>
    <TABLE class="x"><tr><td>Beta</td><td>03</td></tr></TABLE>`;

  it('rend chaque tableau, ses lignes d’en-tête reconnues, les lignes de texte de chaque cellule', () => {
    const tables = parseHtmlTables(html);
    expect(tables).toHaveLength(2);
    expect(tables[0]!.rows.map((r) => r.header)).toEqual([true, false, true, false]);
    expect(tables[0]!.rows[1]!.cells).toEqual([['Alpha'], ['01', '02']]);
    expect(tables[0]!.rows[3]!.cells).toEqual([[], []]);
    expect(tables[1]!.rows[0]!.cells).toEqual([['Beta'], ['03']]);
  });

  it('refuse un tableau imbriqué : la page a changé de forme', () => {
    expect(() =>
      parseHtmlTables('<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>'),
    ).toThrow(/imbriqué/);
  });
});

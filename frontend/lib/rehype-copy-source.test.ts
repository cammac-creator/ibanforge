import { compile } from '@mdx-js/mdx';
import type { Element, Root } from 'hast';
import { describe, expect, it } from 'vitest';
import { mdxOptions } from './mdx';

async function codeBlocks(markdown: string): Promise<Element[]> {
  const blocks: Element[] = [];
  await compile(markdown, {
    ...mdxOptions.mdxOptions,
    rehypePlugins: [
      ...mdxOptions.mdxOptions.rehypePlugins,
      () => (tree: Root) => {
        function visit(node: Root | Element) {
          if (node.type === 'element' && node.tagName === 'pre') blocks.push(node);
          for (const child of node.children) {
            if (child.type === 'element') visit(child);
          }
        }
        visit(tree);
      },
    ],
  });
  return blocks;
}

describe('Le texte copié traverse la vraie coloration MDX', () => {
  it.each([
    ['python', 'if True:\n\tprint("bonjour")\n\n\nprint("fin")\n'],
    ['bash', 'curl https://api.example.net \\\n  -H "X-API-Key: $API_KEY"\n'],
    ['json', '{\n  "valid": null,\n  "value": "é & < >"\n}\n'],
    ['text', '  début  \n\nfin\n'],
    ['', 'sans langage\n'],
    ['langue-inconnue', 'texte conservé\n'],
  ])('conserve les octets du bloc %s', async (language, source) => {
    const blocks = await codeBlocks(`\`\`\`${language}\n${source}\`\`\``);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].properties['data-ibf-copy-source']).toBe(source);
  });

  it('ne confond pas les blocs et conserve les propriétés de coloration', async () => {
    const blocks = await codeBlocks('```js title="exemple.js"\nconst a = 1\n```\n\n```python\na = 2\n```');
    expect(blocks.map((block) => block.properties['data-ibf-copy-source'])).toEqual(['const a = 1\n', 'a = 2\n']);
    expect(blocks[0].properties['data-language']).toBe('js');
    expect(blocks[1].properties['data-language']).toBe('python');
    expect(JSON.stringify(blocks[0].children)).toContain('data-line');
    expect(JSON.stringify(blocks[0].children)).toContain('color:');
  });

  it('n’ajoute rien au code dans une phrase', async () => {
    expect(await codeBlocks('Lire `valid: null` sans conclure.')).toEqual([]);
  });
});

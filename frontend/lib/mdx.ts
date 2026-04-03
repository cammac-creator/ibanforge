import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

function docsDir(locale: string): string {
  return path.join(process.cwd(), 'content', locale, 'docs');
}

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  order: number;
}

export function getAllDocs(locale: string = 'en'): DocMeta[] {
  const dir = docsDir(locale);
  if (!fs.existsSync(dir)) return getAllDocs('en');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mdx'));
  return files
    .map((file) => {
      const slug = file.replace('.mdx', '');
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const { data } = matter(raw);
      return {
        slug,
        title: data.title || slug,
        description: data.description || '',
        order: data.order ?? 99,
      };
    })
    .sort((a, b) => a.order - b.order);
}

export function getDoc(slug: string, locale: string = 'en'): { meta: DocMeta; content: string } {
  const dir = docsDir(locale);
  const file = path.join(dir, `${slug}.mdx`);

  if (!fs.existsSync(file) && locale !== 'en') {
    return getDoc(slug, 'en');
  }

  const raw = fs.readFileSync(file, 'utf-8');
  const { data, content } = matter(raw);
  return {
    meta: {
      slug,
      title: data.title || slug,
      description: data.description || '',
      order: data.order ?? 99,
    },
    content,
  };
}

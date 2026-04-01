import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const DOCS_DIR = path.join(process.cwd(), 'content/docs');

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  order: number;
}

export function getAllDocs(): DocMeta[] {
  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.mdx'));
  return files
    .map((file) => {
      const slug = file.replace('.mdx', '');
      const raw = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8');
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

export function getDoc(slug: string): { meta: DocMeta; content: string } {
  const file = path.join(DOCS_DIR, `${slug}.mdx`);
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

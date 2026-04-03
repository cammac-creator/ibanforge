import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

function blogDir(locale: string): string {
  return path.join(process.cwd(), 'content', locale, 'blog');
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  readingTime: string;
}

export function getAllPosts(locale: string = 'en'): BlogPost[] {
  const dir = blogDir(locale);
  if (!fs.existsSync(dir)) return locale !== 'en' ? getAllPosts('en') : [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mdx'));
  return files
    .map((file) => {
      const slug = file.replace('.mdx', '');
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const { data, content } = matter(raw);
      const words = content.split(/\s+/).length;
      const readingTime = `${Math.ceil(words / 200)} min read`;
      return { slug, title: data.title, description: data.description || '', date: data.date, readingTime };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getPost(slug: string, locale: string = 'en'): { meta: BlogPost; content: string } {
  const dir = blogDir(locale);
  const file = path.join(dir, `${slug}.mdx`);

  if (!fs.existsSync(file) && locale !== 'en') {
    return getPost(slug, 'en');
  }

  const raw = fs.readFileSync(file, 'utf-8');
  const { data, content } = matter(raw);
  const words = content.split(/\s+/).length;
  return {
    meta: {
      slug,
      title: data.title,
      description: data.description || '',
      date: data.date,
      readingTime: `${Math.ceil(words / 200)} min read`,
    },
    content,
  };
}

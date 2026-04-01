import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const BLOG_DIR = path.join(process.cwd(), 'content/blog');

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  readingTime: string;
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith('.mdx'));
  return files
    .map((file) => {
      const slug = file.replace('.mdx', '');
      const raw = fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8');
      const { data, content } = matter(raw);
      const words = content.split(/\s+/).length;
      const readingTime = `${Math.ceil(words / 200)} min read`;
      return {
        slug,
        title: data.title,
        description: data.description || '',
        date: data.date,
        readingTime,
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getPost(slug: string): { meta: BlogPost; content: string } {
  const file = path.join(BLOG_DIR, `${slug}.mdx`);
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

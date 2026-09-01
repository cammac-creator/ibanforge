import fs from 'fs';
import path from 'path';
import { createElement, type ComponentProps } from 'react';
import { notFound } from 'next/navigation';
import { SLUG_PATTERN } from './content-slug';
import matter from 'gray-matter';
import remarkGfm from 'remark-gfm';
import rehypePrettyCode, { type Options as RehypePrettyCodeOptions } from 'rehype-pretty-code';
import type { PluggableList } from 'unified';

/**
 * Shared MDX pipeline for docs + blog (next-mdx-remote/rsc `options` prop).
 * - remark-gfm: renders GFM tables, strikethrough, task lists, autolinks
 *   (docs tables were previously showing as raw `| … |` pipes).
 * - rehype-pretty-code (shiki): syntax highlighting for fenced code blocks.
 *   `keepBackground: false` lets the site's `prose-pre` card background show
 *   through; shiki only colors the tokens. `github-dark` is a sober, muted
 *   theme close to the IBANforge --syn-* palette. See globals.css for the
 *   prose-code reset that keeps shiki blocks from inheriting inline-code styles.
 */
const rehypePrettyCodeOptions: RehypePrettyCodeOptions = {
  theme: 'github-dark',
  keepBackground: false,
};

const remarkPlugins: PluggableList = [remarkGfm];
const rehypePlugins: PluggableList = [[rehypePrettyCode, rehypePrettyCodeOptions]];

export const mdxOptions = {
  mdxOptions: { remarkPlugins, rehypePlugins },
};

/**
 * MDX component overrides. GFM tables can be wider than a phone; wrap each in a
 * horizontally scrollable container so they never get clipped by the page's
 * `overflow-x: clip`. Prose table styling still applies (the table stays inside
 * `.prose`). Written with createElement to keep this a plain .ts module.
 */
export const mdxComponents = {
  table: (props: ComponentProps<'table'>) =>
    createElement(
      'div',
      { className: 'overflow-x-auto' },
      createElement('table', props)
    ),
};

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
  // FRT-09 (2026-09-01): shape allowlist before the slug reaches a path.
  if (!SLUG_PATTERN.test(slug)) notFound();
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

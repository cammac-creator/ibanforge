import fs from 'fs';
import path from 'path';
import { createElement, type ComponentProps } from 'react';
import { notFound } from 'next/navigation';
import { TryApi } from '@/components/try-api';
import { CopySnippetButton } from '@/components/copy-snippet-button';
import { rehypeAttachCopySource, rehypeCaptureCopySource } from './rehype-copy-source';
import { SLUG_PATTERN } from './content-slug';
import { localizeContentHref } from './content-links';
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
const rehypePlugins: PluggableList = [
  rehypeCaptureCopySource,
  [rehypePrettyCode, rehypePrettyCodeOptions],
  rehypeAttachCopySource,
];

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
  pre: (props: ComponentProps<'pre'> & { 'data-ibf-copy-source'?: string }) => {
    const { 'data-ibf-copy-source': source, ...preProps } = props;
    const pre = createElement('pre', preProps);
    if (typeof source !== 'string' || source.length === 0) return pre;
    // Les jetons colorés restent côté serveur ; seul le texte brut va au bouton.
    return createElement('div', { className: 'min-w-0' },
      createElement(CopySnippetButton, { code: source }), pre);
  },
  // `<TryApi>` : le bouton d'essai avec l'API, à placer dans un document après
  // le résultat expliqué (pages pilotes du contrat de mesure, 15.09.2026). Le
  // garde de lib/changelog-mdx.test.ts lit cette table : toute balise
  // capitalisée d'un document doit y figurer, sinon le rendu jette.
  TryApi,
  table: (props: ComponentProps<'table'>) =>
    createElement(
      'div',
      { className: 'overflow-x-auto' },
      createElement('table', props)
    ),
};

// La langue de la page est passée explicitement : aucun état partagé entre
// les rendus et aucun remplacement dans les exemples de code du document.
export function mdxComponentsForLocale(locale: string) {
  return {
    ...mdxComponents,
    a: (props: ComponentProps<'a'>) => createElement('a', {
      ...props,
      href: props.download === undefined ? localizeContentHref(props.href, locale) : props.href,
    }),
  };
}

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

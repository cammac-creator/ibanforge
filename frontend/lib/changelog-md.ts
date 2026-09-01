/**
 * Preparing CHANGELOG.md for the page that renders it.
 *
 * The file is the repository's own changelog, fetched at request time, and it
 * opens with `# Changelog`. The page prints its own translated `h1` above the
 * rendered markdown, so the served document carried TWO `h1` elements in every
 * locale (WEB-19, audit 2026-09-01). `prose-h1:hidden` hid the second from
 * sighted readers, which is precisely why it went unnoticed for months: it
 * stayed in the outline a screen reader and a crawler walk.
 *
 * Fixed at the source rather than in CSS. The rule stays in the page as a guard
 * for any other stray `h1` a future release note might introduce.
 */

/**
 * Drop the document's leading top-level heading, if it has one.
 *
 * Only the FIRST heading and only when it is level 1: `## [1.4.4]` and every
 * version heading below it must survive untouched.
 */
export function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^\s*#[ \t]+[^\n]*\r?\n+/, '');
}

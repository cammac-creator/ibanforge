import type { Element, Root } from 'hast';

declare module 'hast' {
  interface ElementData {
    ibanforgeCopySource?: string;
  }
}

function visit(node: Root | Element, callback: (element: Element) => void): void {
  if (node.type === 'element') callback(node);
  for (const child of node.children) {
    if (child.type === 'element') visit(child, callback);
  }
}

/** Garder le texte avant que la coloration ne transforme les lignes vides. */
export function rehypeCaptureCopySource() {
  return (tree: Root) => {
    visit(tree, (element) => {
      if (element.tagName !== 'pre' || element.children.length !== 1) return;
      const code = element.children[0];
      if (code.type !== 'element' || code.tagName !== 'code') return;
      if (!code.children.every((child) => child.type === 'text')) return;
      element.data = {
        ...element.data,
        ibanforgeCopySource: code.children.map((child) => child.value).join(''),
      };
    });
  };
}

/** La coloration remplace le pre par une figure : rattacher le texte au nouveau pre. */
export function rehypeAttachCopySource() {
  return (tree: Root) => {
    visit(tree, (element) => {
      const source = element.data?.ibanforgeCopySource;
      if (typeof source !== 'string') return;
      const pre = element.tagName === 'pre' ? element : element.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'pre'
      );
      if (pre) pre.properties['data-ibf-copy-source'] = source;
      delete element.data?.ibanforgeCopySource;
    });
  };
}

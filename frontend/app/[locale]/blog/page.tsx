import Link from "next/link";
import { getAllPosts } from "@/lib/blog";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Updates, guides, and changelog from the IBANforge team.",
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16">
      <div className="mb-12">
        <h1 className="text-4xl font-heading font-bold tracking-tight text-foreground mb-3">
          Blog
        </h1>
        <p className="text-lg text-muted-foreground">
          Updates, guides, and changelog
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts yet.</p>
      ) : (
        <div className="space-y-10">
          {posts.map((post) => (
            <article
              key={post.slug}
              className="border-b border-border pb-10 last:border-0"
            >
              <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
                <time dateTime={post.date}>
                  {new Date(post.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </time>
                <span>·</span>
                <span>{post.readingTime}</span>
              </div>
              <h2 className="text-2xl font-heading font-semibold tracking-tight text-foreground mb-2">
                <Link
                  href={`/blog/${post.slug}`}
                  className="hover:text-primary transition-colors"
                >
                  {post.title}
                </Link>
              </h2>
              {post.description && (
                <p className="text-muted-foreground leading-relaxed mb-4">
                  {post.description}
                </p>
              )}
              <Link
                href={`/blog/${post.slug}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                Read more →
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

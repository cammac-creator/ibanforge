import { getAllDocs } from "@/lib/mdx";
import { DocsSidebar } from "@/components/docs/sidebar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const docs = getAllDocs();

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <DocsSidebar docs={docs} />
      <div className="flex-1 min-w-0">
        <article className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
          <div className="prose prose-invert prose-amber max-w-none prose-headings:font-heading prose-headings:tracking-tight prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-lg prose-p:text-muted-foreground prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:text-primary prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-card prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-strong:text-foreground prose-table:text-sm prose-th:text-left prose-th:text-muted-foreground prose-th:font-semibold prose-th:border-b prose-th:border-border prose-th:pb-2 prose-td:border-b prose-td:border-border prose-td:py-2 prose-li:text-muted-foreground">
            {children}
          </div>
        </article>
      </div>
    </div>
  );
}

"use client"

import { CodeBlock } from "@/components/code-block"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Snippet } from "./page-data"

/**
 * The first call in curl, JavaScript and Python, one tab each.
 *
 * Every panel stays in the HTML (`keepMounted`): a reader without JavaScript
 * and a crawler both get the three snippets, only the visible one changes. The
 * strings come from the server; nothing here formats a date or a number.
 */
export function FirstCallSnippets({ snippets, label }: { snippets: Snippet[]; label: string }) {
  const first = snippets[0]?.key
  return (
    <Tabs defaultValue={first} className="w-full">
      <TabsList aria-label={label} className="w-full sm:w-fit">
        {snippets.map((s) => (
          <TabsTrigger key={s.key} value={s.key} className="flex-1 px-3 sm:flex-none">
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {snippets.map((s) => (
        <TabsContent key={s.key} value={s.key} keepMounted>
          <CodeBlock code={s.code} language={s.label} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

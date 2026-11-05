"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Copy } from "lucide-react"

export function CopySnippetButton({ code }: { code: string }) {
  const t = useTranslations("common")
  const [feedback, setFeedback] = useState<{ code: string; result: "copied" | "failed" } | null>(null)
  const result = feedback?.code === code ? feedback.result : null

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setFeedback({ code, result: "copied" })
    } catch {
      setFeedback({ code, result: "failed" })
    }
  }

  return (
    <div className="not-prose flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
      <span role="status" className={result === "failed" ? "w-full text-muted-foreground" : "text-muted-foreground"}>
        {result === "copied" ? t("copied") : result === "failed" ? t("copyFailed") : ""}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={t("copyCode")}
        className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Copy aria-hidden="true" className="size-4" />
        {t("copy")}
      </button>
    </div>
  )
}

"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

interface CodeBlockProps {
  code: string
  language: string
  className?: string
}

export function CodeBlock({ code, language, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available — silently ignore
    }
  }

  return (
    <div
      className={cn(
        "relative group rounded-xl border border-border bg-muted/40 overflow-hidden",
        className
      )}
    >
      {/* Language badge + Copy button */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/60">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {language}
        </span>
        <button
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            copied && "text-primary"
          )}
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <pre
        className={cn(
          "overflow-x-auto p-4 text-sm leading-relaxed",
          "font-mono text-foreground"
        )}
        style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}

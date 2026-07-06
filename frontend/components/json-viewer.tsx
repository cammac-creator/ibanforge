"use client"

import { cn } from "@/lib/utils"

interface JsonViewerProps {
  data: unknown
  className?: string
}

/**
 * Syntax-highlighted JSON, colored with the design-system --syn-* tokens
 * (key = amber, string = lime, number = sky, bool = purple, null = zinc).
 * Presentational only — the copy button + collapse live in the caller.
 */
export function JsonViewer({ data, className }: JsonViewerProps) {
  const raw = JSON.stringify(data, null, 2)

  const lines = raw.split("\n").map((line, i) => {
    const keyMatch = line.match(/^(\s*)("(?:[^"\\]|\\.)*")(\s*:)(.*)$/)
    if (keyMatch) {
      const [, indent, key, colon, rest] = keyMatch
      return (
        <span key={i}>
          {indent}
          <span style={{ color: "var(--syn-key)" }}>{key}</span>
          <span style={{ color: "var(--syn-punct)" }}>{colon}</span>
          {colorizeValue(rest)}
          {"\n"}
        </span>
      )
    }
    return (
      <span key={i} style={{ color: "var(--syn-punct)" }}>
        {line}
        {"\n"}
      </span>
    )
  })

  return (
    <pre
      className={cn(
        "font-mono text-[0.8125rem] leading-relaxed overflow-x-auto",
        className
      )}
      style={{ color: "var(--syn-punct)" }}
    >
      {lines}
    </pre>
  )
}

function colorizeValue(value: string): React.ReactNode {
  const trimmed = value.trimStart()
  const leading = value.slice(0, value.length - trimmed.length)
  const comma = trimmed.endsWith(",")
  const body = comma ? trimmed.slice(0, -1) : trimmed

  let color = "var(--syn-punct)"
  if (body.startsWith('"')) color = "var(--syn-string)"
  else if (/^-?\d/.test(body)) color = "var(--syn-number)"
  else if (body === "true" || body === "false") color = "var(--syn-bool)"
  else if (body === "null") color = "var(--syn-null)"
  else if (body === "{" || body === "[" || body === "}" || body === "]") color = "var(--syn-punct)"

  return (
    <>
      {leading}
      <span style={{ color }}>{body}</span>
      {comma && <span style={{ color: "var(--syn-punct)" }}>,</span>}
    </>
  )
}

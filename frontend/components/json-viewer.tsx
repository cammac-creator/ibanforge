"use client"

import { cn } from "@/lib/utils"

interface JsonViewerProps {
  data: unknown
  className?: string
}

export function JsonViewer({ data, className }: JsonViewerProps) {
  const raw = JSON.stringify(data, null, 2)

  // Simple line-by-line colorizer
  const lines = raw.split("\n").map((line, i) => {
    // Detect patterns for coloring
    // Key: "key": anything
    const keyMatch = line.match(/^(\s*)("(?:[^"\\]|\\.)*")(\s*:)(.*)$/)
    if (keyMatch) {
      const [, indent, key, colon, rest] = keyMatch
      const coloredRest = colorizeValue(rest)
      return (
        <span key={i}>
          {indent}
          <span className="text-amber-400">{key}</span>
          <span className="text-zinc-500">{colon}</span>
          {coloredRest}
          {"\n"}
        </span>
      )
    }

    // Plain value line (array element or opening/closing bracket)
    return (
      <span key={i} className="text-zinc-400">
        {line}
        {"\n"}
      </span>
    )
  })

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-900 overflow-auto",
        className
      )}
    >
      <pre className="font-mono text-sm leading-relaxed p-4 text-zinc-300">
        {lines}
      </pre>
    </div>
  )
}

function colorizeValue(value: string): React.ReactNode {
  const trimmed = value.trimStart()
  const leading = value.slice(0, value.length - trimmed.length)

  // String value
  if (trimmed.startsWith('"')) {
    const trailingComma = trimmed.endsWith(",") ? "," : ""
    const strPart = trailingComma ? trimmed.slice(0, -1) : trimmed
    return (
      <>
        {leading}
        <span className="text-emerald-400">{strPart}</span>
        {trailingComma && <span className="text-zinc-500">{trailingComma}</span>}
      </>
    )
  }

  // Number value
  if (/^-?\d/.test(trimmed)) {
    const trailingComma = trimmed.endsWith(",") ? "," : ""
    const numPart = trailingComma ? trimmed.slice(0, -1) : trimmed
    return (
      <>
        {leading}
        <span className="text-sky-400">{numPart}</span>
        {trailingComma && <span className="text-zinc-500">{trailingComma}</span>}
      </>
    )
  }

  // Boolean value
  if (trimmed === "true" || trimmed === "true," || trimmed === "false" || trimmed === "false,") {
    const trailingComma = trimmed.endsWith(",") ? "," : ""
    const boolPart = trailingComma ? trimmed.slice(0, -1) : trimmed
    return (
      <>
        {leading}
        <span className="text-zinc-400">{boolPart}</span>
        {trailingComma && <span className="text-zinc-500">{trailingComma}</span>}
      </>
    )
  }

  // Null value
  if (trimmed === "null" || trimmed === "null,") {
    const trailingComma = trimmed.endsWith(",") ? "," : ""
    const nullPart = trailingComma ? trimmed.slice(0, -1) : trimmed
    return (
      <>
        {leading}
        <span className="text-zinc-500">{nullPart}</span>
        {trailingComma && <span className="text-zinc-500">{trailingComma}</span>}
      </>
    )
  }

  // Fallback: plain
  return <span className="text-zinc-400">{value}</span>
}

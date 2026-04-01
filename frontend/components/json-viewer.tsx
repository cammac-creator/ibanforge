"use client"

import { cn } from "@/lib/utils"

interface JsonViewerProps {
  data: unknown
  className?: string
}

function colorizeJson(json: string): React.ReactNode[] {
  // Tokenize JSON string into colored segments
  const tokens: React.ReactNode[] = []
  const keyPattern = /"([^"\\]|\\.)*"\s*:/g
  const stringPattern = /:\s*"([^"\\]|\\.)*"/g
  const numberPattern = /:\s*-?\d+(\.\d+)?([eE][+-]?\d+)?/g
  const nullPattern = /:\s*null/g
  const boolPattern = /:\s*(true|false)/g

  // Segment index tracking
  let lastIndex = 0
  const segments: { start: number; end: number; type: string; text: string }[] =
    []

  // Find all keys
  let m: RegExpExecArray | null
  const keyRe = /"([^"\\]|\\.)*"\s*:/g
  while ((m = keyRe.exec(json)) !== null) {
    segments.push({ start: m.index, end: m.index + m[0].length, type: "key", text: m[0] })
  }

  // Find string values (": "...")
  const strRe = /:\s*"([^"\\]|\\.)*"/g
  while ((m = strRe.exec(json)) !== null) {
    // Only if not already a key-colon area — check if this is a value
    segments.push({ start: m.index, end: m.index + m[0].length, type: "string-value", text: m[0] })
  }

  // Find number values
  const numRe = /:\s*-?\d+(\.\d+)?([eE][+-]?\d+)?/g
  while ((m = numRe.exec(json)) !== null) {
    segments.push({ start: m.index, end: m.index + m[0].length, type: "number", text: m[0] })
  }

  // Find null values
  const nullRe = /:\s*null/g
  while ((m = nullRe.exec(json)) !== null) {
    segments.push({ start: m.index, end: m.index + m[0].length, type: "null", text: m[0] })
  }

  // Find boolean values
  const boolRe = /:\s*(true|false)/g
  while ((m = boolRe.exec(json)) !== null) {
    segments.push({ start: m.index, end: m.index + m[0].length, type: "boolean", text: m[0] })
  }

  return tokens
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

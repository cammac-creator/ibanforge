"use client"

/**
 * The rail of the pipeline — the twelve stations in walking order, each with
 * the state the response proved, beside the village (a column on a large
 * screen, a strip under the narration elsewhere). Parchment, not table: the
 * same paper as the hover card, so the eye reads rail and village as one
 * system. Every row is a button: hover lights the building, click pins its
 * card; the keyboard reaches what the mouse reaches.
 */

import type { Rail, RailRow, RailState } from "@/lib/village/rail"

export interface RailStrings {
  title: string
  step: (n: number, total: number) => string
  names: Record<string, string>
  groups: Record<string, string>
  states: Record<RailState, string>
  traffic: string | null
}

interface Props {
  rail: Rail
  strings: RailStrings
  hoverId: string | null
  onHover: (id: string | null) => void
  onPick: (id: string) => void
  /** the canvas id a rail station lights (registry → the visited house) */
  stationOf: (row: RailRow) => string
}

const MARK: Record<RailState, string> = { idle: "", skipped: "—", current: "▶", done: "✓", warn: "⚠", fail: "✗" }
const COLOR: Record<RailState, string> = {
  idle: "#9A8B74", skipped: "#B8AA92", current: "#B45309", done: "#15803D", warn: "#B45309", fail: "#B91C1C",
}

// Two layouts from one markup: the column shows above 1280 px on a screen
// tall enough for twelve rows, the strip everywhere else. The variant is
// written out in full on every class — Tailwind only generates what it can
// read as a literal, a prefix glued at runtime produced nothing.

export function RailPanel({ rail, strings, hoverId, onHover, onPick, stationOf }: Props) {
  const total = rail.counter?.total ?? 0
  const segments = rail.rows.filter((r) => r.stepIndex !== null)
  return (
    <nav
      aria-label={strings.title}
      className="flex min-w-0 flex-row items-stretch gap-1 overflow-x-auto rounded-lg border p-2 xl:[@media(min-height:860px)]:flex-col xl:[@media(min-height:860px)]:gap-0 xl:[@media(min-height:860px)]:overflow-visible xl:[@media(min-height:860px)]:p-3"
      style={{ background: "#F3E7C8", borderColor: "#7A5322", color: "#3A2A12", boxShadow: "2px 2px 0 rgba(10,8,4,0.25)" }}
    >
      <div className="flex shrink-0 flex-col justify-center pr-3 xl:[@media(min-height:860px)]:pr-0 xl:[@media(min-height:860px)]:pb-2 xl:[@media(min-height:860px)]:mb-1 xl:[@media(min-height:860px)]:border-b" style={{ borderColor: "rgba(122,83,34,.35)" }}>
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em]" style={{ color: "#7A5322" }}>{strings.title}</span>
        {rail.counter ? (
          <>
            <span className="font-mono text-[11px] tabular-nums" style={{ color: "#3A2A12" }}>{strings.step(rail.counter.current, rail.counter.total)}</span>
            <span className="mt-1 flex gap-[2px]" aria-hidden>
              {segments.map((r) => (
                <span
                  key={`${r.station}-${r.key}`}
                  className="h-[3px] flex-1 rounded-sm"
                  style={{ background: r.state === "idle" ? "rgba(122,83,34,.25)" : COLOR[r.state], opacity: r.state === "current" ? 0.6 : 1 }}
                />
              ))}
            </span>
          </>
        ) : (
          <span className="text-[11px]" style={{ color: "#9A8B74" }}>{strings.step(0, 12)}</span>
        )}
      </div>
      {rail.rows.map((row, i) => {
        const showGroup = i === 0 || rail.rows[i - 1].group !== row.group
        const id = stationOf(row)
        const hot = hoverId === id
        const name = strings.names[row.sub ? row.key : row.station] ?? row.key
        return (
          <div key={`${row.station}-${row.key}`} className="flex shrink-0 flex-row xl:[@media(min-height:860px)]:flex-col">
            {showGroup && (
              <span
                className="hidden xl:[@media(min-height:860px)]:block pt-2 pb-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: "#9A8B74" }}
              >
                {strings.groups[row.group]}
              </span>
            )}
            <button
              type="button"
              onMouseEnter={() => onHover(id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(id)}
              onBlur={() => onHover(null)}
              onClick={() => onPick(id)}
              title={strings.states[row.state]}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] leading-tight whitespace-nowrap transition-colors ${row.sub ? "xl:[@media(min-height:860px)]:ml-4" : ""}`}
              style={{
                background: hot ? "rgba(253,230,138,.55)" : row.state === "current" ? "rgba(253,230,138,.35)" : "transparent",
                borderLeft: row.state === "current" ? "3px solid #B45309" : "3px solid transparent",
                opacity: row.state === "idle" ? 0.6 : row.state === "skipped" ? 0.45 : 1,
                textDecoration: row.state === "skipped" ? "line-through" : "none",
                outlineColor: "#B45309",
              }}
            >
              <span className="w-3.5 text-center font-mono text-[11px]" style={{ color: COLOR[row.state] }}>{MARK[row.state] || "·"}</span>
              <span className="w-4 text-right font-mono text-[10px] tabular-nums" style={{ color: "#9A8B74" }}>{row.sub ? "" : i + 1 - rail.rows.slice(0, i).filter((r) => r.sub).length}</span>
              <span className="font-semibold">{name}</span>
              {row.result && (
                <span className="ml-auto max-w-[110px] truncate pl-2 font-mono text-[10.5px]" style={{ color: "#6B5327" }}>{row.result}</span>
              )}
            </button>
          </div>
        )
      })}
      {strings.traffic && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-3 text-[10.5px] xl:[@media(min-height:860px)]:ml-0 xl:[@media(min-height:860px)]:mt-2 xl:[@media(min-height:860px)]:border-t xl:[@media(min-height:860px)]:pl-0 xl:[@media(min-height:860px)]:pt-2" style={{ color: "#6B5327", borderColor: "rgba(122,83,34,.35)" }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#15803D" }} aria-hidden />
          <span>{strings.traffic}</span>
        </div>
      )}
      <span className="sr-only">{total}</span>
    </nav>
  )
}

"use client"

import { useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { JsonViewer } from "@/components/json-viewer"

type TabType = "iban" | "bic"

export default function PlaygroundPage() {
  const [activeTab, setActiveTab] = useState<TabType>("iban")
  const [ibanValue, setIbanValue] = useState("")
  const [bicValue, setBicValue] = useState("")
  const [result, setResult] = useState<unknown>(null)
  const [responseMs, setResponseMs] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(type: TabType, value: string) {
    if (!value.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    setResponseMs(null)

    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, value: value.trim() }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data?.error ?? "Unexpected error from the API.")
        return
      }

      const ms = typeof data._playground_ms === "number" ? data._playground_ms : null
      setResponseMs(ms)
      setResult(data)
    } catch {
      setError("Could not reach the API. Please check your connection or try again later.")
    } finally {
      setLoading(false)
    }
  }

  function handleTabChange(value: unknown) {
    setActiveTab(value as TabType)
    setResult(null)
    setResponseMs(null)
    setError(null)
  }

  return (
    <div className="flex flex-col items-center px-4 py-16 max-w-3xl mx-auto w-full gap-10">
      {/* Header */}
      <div className="text-center flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight font-mono">
          Play<span className="text-amber-500">ground</span>
        </h1>
        <p className="text-muted-foreground text-base">
          Test the API for free — no payment, no signup
        </p>
      </div>

      {/* Tabs */}
      <div className="w-full flex flex-col gap-6">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="w-full"
        >
          <TabsList className="mb-4">
            <TabsTrigger value="iban">Validate IBAN</TabsTrigger>
            <TabsTrigger value="bic">Lookup BIC</TabsTrigger>
          </TabsList>

          {/* IBAN Tab */}
          <TabsContent value="iban">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                handleSubmit("iban", ibanValue)
              }}
            >
              <Input
                className="flex-1 h-10 font-mono"
                placeholder="CH93 0076 2011 6238 5295 7"
                value={ibanValue}
                onChange={(e) => setIbanValue(e.target.value)}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="submit"
                disabled={loading || !ibanValue.trim()}
                className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold min-w-24"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Validate"
                )}
              </Button>
            </form>
          </TabsContent>

          {/* BIC Tab */}
          <TabsContent value="bic">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                handleSubmit("bic", bicValue)
              }}
            >
              <Input
                className="flex-1 h-10 font-mono"
                placeholder="UBSWCHZH80A"
                value={bicValue}
                onChange={(e) => setBicValue(e.target.value)}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="submit"
                disabled={loading || !bicValue.trim()}
                className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold min-w-24"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Lookup"
                )}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Result area */}
        {result !== null && !error && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground font-medium">Response</span>
              {responseMs !== null && (
                <Badge
                  variant="outline"
                  className="font-mono text-xs text-amber-500 border-amber-500/40 bg-amber-500/5"
                >
                  {responseMs}ms
                </Badge>
              )}
            </div>
            <JsonViewer data={result} />
          </div>
        )}
      </div>

      {/* Docs link */}
      <p className="text-sm text-muted-foreground">
        Want to use this in your code?{" "}
        <Link
          href="/docs"
          className="text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
        >
          See the docs →
        </Link>
      </p>
    </div>
  )
}

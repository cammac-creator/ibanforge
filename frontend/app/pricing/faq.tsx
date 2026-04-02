"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const FAQS = [
  {
    question: "What is x402?",
    answer:
      "x402 is an open micropayment protocol that uses HTTP status code 402 (Payment Required). When you call a paid endpoint, the server responds with a 402 containing payment details. Your client automatically sends a signed USDC payment on Base, and the server re-processes your request — all within a single HTTP round-trip.",
  },
  {
    question: "How do I pay?",
    answer:
      "Payments are made in USDC on the Base network. Your HTTP client (or SDK) handles it automatically by attaching payment headers to each request. No wallet UI, no manual confirmation — just fractions of a cent deducted per call. Check the docs for integration examples.",
  },
  {
    question: "Is there a free tier?",
    answer:
      "Yes. The /v1/demo endpoint returns pre-computed example validations at no cost, perfect for testing your integration. The /playground on this site lets you try live calls for free too. No signup or payment method required to get started.",
  },
  {
    question: "What about high volume?",
    answer:
      "The per-call pricing scales linearly with no rate limits. For very high volumes (millions of calls/month), open an issue on our GitHub repository (github.com/cammac-creator/ibanforge) — we can discuss custom pricing or a bulk arrangement that makes more sense for your use case.",
  },
]

function FaqItem({
  question,
  answer,
  isOpen,
  onToggle,
}: {
  question: string
  answer: string
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-medium text-foreground hover:text-amber-500 transition-colors"
        aria-expanded={isOpen}
      >
        <span>{question}</span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground shrink-0 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          isOpen ? "max-h-64 pb-4" : "max-h-0"
        )}
      >
        <p className="text-sm text-muted-foreground leading-relaxed">{answer}</p>
      </div>
    </div>
  )
}

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  function handleToggle(index: number) {
    setOpenIndex(openIndex === index ? null : index)
  }

  return (
    <div className="rounded-xl border border-border bg-zinc-900/50 px-6 divide-y-0">
      {FAQS.map((faq, i) => (
        <FaqItem
          key={faq.question}
          question={faq.question}
          answer={faq.answer}
          isOpen={openIndex === i}
          onToggle={() => handleToggle(i)}
        />
      ))}
    </div>
  )
}

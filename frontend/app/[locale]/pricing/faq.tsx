"use client"

import { useId, useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const FAQ_COUNT = 4

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
  const answerId = useId()
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-medium text-foreground hover:text-amber-500 transition-colors"
        aria-expanded={isOpen}
        aria-controls={answerId}
      >
        <span>{question}</span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground shrink-0 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>
      <div id={answerId} hidden={!isOpen} className="pb-4">
        <p className="text-sm text-muted-foreground leading-relaxed">{answer}</p>
      </div>
    </div>
  )
}

export function Faq() {
  const t = useTranslations("pricing")
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  function handleToggle(index: number) {
    setOpenIndex(openIndex === index ? null : index)
  }

  const faqs = Array.from({ length: FAQ_COUNT }, (_, i) => ({
    question: t(`faq.${i}.question`),
    answer: t(`faq.${i}.answer`),
  }))

  return (
    <div
      className="rounded-xl border border-border px-6 divide-y-0"
      style={{ background: "var(--ink-1)" }}
    >
      {faqs.map((faq, i) => (
        <FaqItem
          key={i}
          question={faq.question}
          answer={faq.answer}
          isOpen={openIndex === i}
          onToggle={() => handleToggle(i)}
        />
      ))}
    </div>
  )
}

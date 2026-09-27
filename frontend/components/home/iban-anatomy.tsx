import type { CSSProperties } from "react"
import { Reveal } from "@/components/reveal"

/**
 * An IBAN cut into the four parts IBANforge reads, each with what is checked
 * in it. A functional diagram (the brand illustrations stay the rendered
 * images): server-rendered text, lit part by part by CSS once Reveal marks it
 * in view; still under prefers-reduced-motion.
 */
export interface AnatomyPart {
  code: string
  label: string
  what: string
}

export function IbanAnatomy({ parts, caption }: { parts: AnatomyPart[]; caption: string }) {
  return (
    <Reveal className="anatomy">
      <figure>
        <ol className="anatomy-parts">
          {parts.map((part, i) => (
            <li key={part.label} className="anatomy-part" style={{ "--i": i } as CSSProperties}>
              <code className="anatomy-code">{part.code}</code>
              <span className="anatomy-line" aria-hidden="true" />
              <span className="anatomy-label">{part.label}</span>
              <span className="anatomy-what">{part.what}</span>
            </li>
          ))}
        </ol>
        <figcaption>{caption}</figcaption>
      </figure>
    </Reveal>
  )
}

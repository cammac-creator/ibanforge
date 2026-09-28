import { Fragment, type CSSProperties } from "react"
import { coverLines, finLines } from "./revue-cover-fit"

/**
 * The home title, one line per row, each line filling its column: the width of
 * the line at 1em is measured once (revue-cover-fit.ts) and the CSS divides the
 * column by it. Plain text in one h1, lines separated by real spaces.
 */
export function CoverTitle({ locale, id }: { locale: string; id: string }) {
  return (
    <h1 id={id} className="rv-h1 rv-bebas">
      {coverLines(locale).map((line, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="rv-ligne" style={{ "--em": line.em } as CSSProperties}>
            {line.text}
          </span>
        </Fragment>
      ))}
    </h1>
  )
}

/**
 * A title set word by word, each word in its own mask, so it can rise from an
 * invisible line (revue.css). The text stays one heading for readers and
 * robots: the words are separated by real spaces. Words joined by a no-break
 * space in the messages rise together in one mask and never part at a line
 * end; the mask keeps real spaces between them, so that the group may break
 * after all when the font never came (`.rv-souple`, revue-motion.tsx).
 */
export function MaskedWords({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="rv-mot">
            <span>{word.replace(/\u00a0/g, " ")}</span>
          </span>
        </Fragment>
      ))}
    </>
  )
}

/**
 * The head every chapter shares: a hairline, the hollow numeral, the kicker,
 * the title, the standfirst. Each part arrives on its own (revue-motion.tsx).
 */
export function ChapterHead({
  num,
  kicker,
  title,
  lead,
  id,
  large = false,
}: {
  num: string
  kicker?: string
  title: string
  lead?: string
  id: string
  large?: boolean
}) {
  return (
    <>
      <i className="rv-filet" data-rv="filet" aria-hidden="true" />
      <header className={large ? "rv-tete rv-tete--large" : "rv-tete"}>
        <p className="rv-tete__rang">
          <span className="rv-num" aria-hidden="true" data-rv="num">
            {num}
          </span>
          {kicker && (
            <span className="rv-kicker" data-rv="texte">
              <KeepHyphenated text={kicker} />
            </span>
          )}
        </p>
        <h2 className="rv-h2 rv-bebas" id={id} data-rv="titre" style={{ "--rv-d": ".08s" } as CSSProperties}>
          <MaskedWords text={title} />
        </h2>
        {lead && (
          <p className="rv-chapeau" data-rv="texte" style={{ "--rv-d": ".3s" } as CSSProperties}>
            {lead}
          </p>
        )}
      </header>
    </>
  )
}

/** A hyphenated word ("mod-97") never parts at its hyphen: « MOD- / 97 » read as two words. */
export function KeepHyphenated({ text }: { text: string }) {
  const parts = text.split(/(\S+-\S+)/)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rv-nw">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/**
 * The title of the ending, its line breaks from the measured table
 * (revue-cover-fit.ts, FIN_LINES): the breaks of the phone (`rv-br-t`) and of
 * the computer (`rv-br-o`) sit between the same words, each shown on its own
 * layout. The words rise one by one like a chapter title.
 */
export function FinTitle({ locale, text, id }: { locale: string; text: string; id: string }) {
  const { narrow, wide, em } = finLines(locale)
  const words = text.split(" ")
  // After which word each layout breaks, counted from the lines of the table.
  const breaks = (lines: readonly string[]) => {
    const out = new Set<number>()
    let count = 0
    for (const line of lines.slice(0, -1)) {
      count += line.split(" ").length
      out.add(count - 1)
    }
    return out
  }
  const phone = breaks(narrow)
  const computer = breaks(wide)
  return (
    <h2
      className="rv-fin__titre rv-bebas"
      id={id}
      data-rv="titre"
      style={{ "--rv-d": ".1s", "--em-t": em.narrow, "--em-o": em.wide } as CSSProperties}
    >
      {words.map((word, i) => (
        <Fragment key={i}>
          {i > 0 && (phone.has(i - 1) || computer.has(i - 1) ? null : " ")}
          {phone.has(i - 1) && <br className="rv-br-t" />}
          {computer.has(i - 1) && <br className="rv-br-o" />}
          {i > 0 && (phone.has(i - 1) || computer.has(i - 1)) && " "}
          <span className="rv-mot">
            <span>{word}</span>
          </span>
        </Fragment>
      ))}
    </h2>
  )
}

/**
 * A sentence of the messages with its API paths set as code ("POST
 * /v1/iban/validate"): the words stay the messages' own, word for word, which
 * the FAQ's structured data repeats.
 */
export function ApiText({ text }: { text: string }) {
  const parts = text.split(/((?:GET|POST) \/v1\/[\w/.{}-]+)/)
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>))}
    </>
  )
}

/**
 * A figure set in Bebas Neue: its no-break spaces become fixed spacers, since
 * the face has no narrow space ("29 $", "4 $", "12 480,00 €").
 */
export function BebasFigure({ text }: { text: string }) {
  const parts = text.split(/([\u00a0\u202f])/)
  return (
    <>
      {parts.map((part, i) =>
        part === "\u00a0" ? (
          <span key={i} className="rv-fine rv-fine--devise" />
        ) : part === "\u202f" ? (
          <span key={i} className="rv-fine" />
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/** "dès 4 $" → the words before the amount, set small, and the amount. */
export function splitFrom(price: string): { from: string | null; amount: string } {
  const m = /^(\D+?)\s+(\S*\d.*)$/.exec(price)
  return m ? { from: m[1], amount: m[2] } : { from: null, amount: price }
}

/** "SDK Java 17+ · Maven Central" → the name, and its mention set apart. */
export function splitMention(item: string): { name: string; mention: string | null } {
  const at = item.indexOf(" · ")
  return at < 0 ? { name: item, mention: null } : { name: item.slice(0, at), mention: item.slice(at + 3) }
}

/** "01 · Un IBAN" → the number and the name of a way. */
export function splitNumbered(item: string): { num: string; name: string } {
  const m = /^(\d+)\s·\s(.+)$/.exec(item)
  return m ? { num: m[1], name: m[2] } : { num: "", name: item }
}


import { Fragment, type CSSProperties } from "react"
import { coverLines } from "./revue-cover-fit"

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
 * A chapter title set word by word, each word in its own mask, so it can rise
 * from an invisible line (revue.css). The text stays one heading for readers
 * and robots: the words are separated by real spaces.
 */
export function MaskedWords({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="rv-mot">
            <span>{word}</span>
          </span>
        </Fragment>
      ))}
    </>
  )
}

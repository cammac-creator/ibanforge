"use client"

import Link from "next/link"
import { useEffect, useRef, type CSSProperties } from "react"
import type { WaysHandle } from "./revue-scenes-engine"
import { afterLoadIdle } from "./revue-idle"

/*
 * Chapter 04 of the home: three ways to use IBANforge in one scene with three
 * switches, like the three examples of the film. The scene tells, once, one
 * IBAN (« Commerzbank. » in the API), a whole file (the counter rolls to the
 * ceiling of the smaller audit, the flagged lines are struck), your tools (the
 * same answer in the API, a spreadsheet and an agent), then rests on the last.
 *
 * Its still frame is the file (`data-voie="1"`): what the page shows without
 * the script, under reduced motion, and before the engine arrives. The motion
 * (revue-scenes-engine.ts) loads when the scene comes near, never under
 * reduced motion. The switches always work: without the engine they show the
 * still frame of their way.
 *
 * Everything is rendered on the server, in the page's language; the component
 * holds no state, so React never renders it again under the engine.
 */

export type VoiesLink = { label: string; href: string; evt: string }

export type VoiesCopy = {
  /** The name of the group of switches. */
  group: string
  ways: { num: string; name: string; audience: string; text: string; link: VoiesLink }[]
  verdictOk: string
  frames: { api: string; apiTag: string; sheet: string; sheetTag: string; agent: string; agentTag: string }
  sheetNote: string
  mcpNote: string
  formula: string
  unit: string
  flagged: string
  figure: string
  caption: string
  /** Why each of the two flagged lines stops: a code no bank holds, a typo. */
  reasons: [string, string]
  counter: { total: number; sep: "," | "fine"; em: number }
  bankEm: number
}

/* The column of the file, read line by line: countries of the registers and of
   the national keys, IBANs masked; two lines are flagged. The lengths are the
   IBAN lengths of each country. */
const COLUMN: [string, number, boolean?][] = [
  ["DE", 22], ["FR", 27], ["CH", 21], ["AT", 20], ["IT", 27], ["BE", 16], ["ES", 24], ["DE", 22], ["LI", 21],
  ["DE", 22, true], ["FR", 27], ["SK", 24], ["CZ", 24], ["DE", 22], ["BG", 22], ["CH", 21], ["MC", 27], ["IT", 27],
  ["SM", 27], ["DE", 22], ["ES", 24], ["DE", 22, true], ["FR", 27], ["AT", 20], ["BE", 16], ["CH", 21], ["DE", 22],
  ["IT", 27], ["FR", 27], ["ES", 24],
]

/** "DE•• •••• •••• •••• •••• ••": the country, then every character masked, by fours. */
function masked(country: string, length: number): string {
  const rest = "•".repeat(length - 4)
  return `${country}•• ${rest.replace(/(.{4})(?=.)/g, "$1 ")}`
}

/** The counter as React renders it: the total, grouped the way the language groups it. */
function Counter({ total, sep }: { total: number; sep: "," | "fine" }) {
  const thousands = Math.floor(total / 1000)
  const rest = String(total % 1000).padStart(3, "0")
  return (
    <span className="rv-f__fixe">
      {thousands}
      {sep === "," ? "," : <span className="rv-fine" />}
      {rest}
    </span>
  )
}

export function RevueVoies({ copy }: { copy: VoiesCopy }) {
  const scene = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const { total, sep } = copy.counter

  useEffect(() => {
    const el = scene.current
    const box = list.current
    if (!el || !box) return
    const buttons = Array.from(box.querySelectorAll<HTMLButtonElement>(".rv-voie__b"))
    const reduce = matchMedia("(prefers-reduced-motion: reduce)")
    let disposed = false
    let near = false
    let loading = false
    let ways: WaysHandle | null = null

    // Without the engine a switch shows the still frame of its way.
    const still = (n: number) => {
      el.setAttribute("data-voie", String(n))
      buttons.forEach((b, i) => {
        if (i === n) b.setAttribute("aria-current", "true")
        else b.removeAttribute("aria-current")
      })
    }

    const start = () => {
      if (ways || loading || disposed || reduce.matches || !near) return
      loading = true
      afterLoadIdle()
        .then(() => import("./revue-scenes-engine"))
        .then((engine) => {
          loading = false
          if (disposed || ways || reduce.matches) return
          ways = engine.createWays(el, { buttons, total, sep })
        })
        .catch(() => {
          loading = false
        })
    }

    // The scene gets ready while it is still off screen: on its approach, or as
    // soon as the browser is idle. A jump to #try from the cover lands it on
    // screen at once, and a scene the engine finds already shown keeps its
    // still frame for good: nothing on screen is hidden after the fact.
    const ready = () => {
      near = true
      start()
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        io.disconnect()
        ready()
      },
      { rootMargin: "1500px 0px" },
    )
    io.observe(el)
    void afterLoadIdle(3000).then(() => {
      if (!disposed) ready()
    })

    const onReduce = () => {
      if (reduce.matches) {
        ways?.destroy()
        ways = null
      } else start()
    }
    reduce.addEventListener("change", onReduce)

    const onClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>(".rv-voie__b")
      const n = button ? buttons.indexOf(button) : -1
      if (n < 0) return
      if (ways) ways.select(n)
      else still(n)
    }
    box.addEventListener("click", onClick)

    return () => {
      disposed = true
      io.disconnect()
      reduce.removeEventListener("change", onReduce)
      box.removeEventListener("click", onClick)
      ways?.destroy()
      ways = null
    }
  }, [total, sep])

  const [reasonCode, reasonTypo] = copy.reasons

  return (
    <>
      <figure className="rv-fig rv-voies">
        <div className="rv-scene4" id="rv-scene4" data-voie="1" ref={scene}>
          {/* Ways 01 and 03: the same answer in an API, a spreadsheet and an agent. */}
          <div className="rv-plan4 rv-plan4--outils rv-o">
            <div className="rv-o__haut">
              <p className="rv-o__sur">
                <span className="rv-o__si">
                  <span className="rv-o__pt" aria-hidden="true" />
                  {copy.verdictOk}
                </span>
              </p>
              <p className="rv-o__geant" style={{ "--em": copy.bankEm } as CSSProperties}>
                Commerzbank.
              </p>
              <p className="rv-o__leg">DE89 3704 0044 0532 0130 00 · BIC&#160;COBADEFFXXX</p>
            </div>
            <div className="rv-o__cadres">
              <div className="rv-o__cadre rv-o__cadre--api">
                <p className="rv-kicker rv-o__tete">
                  <span>{copy.frames.api}</span>
                  <span>{copy.frames.apiTag}</span>
                </p>
                <pre className="rv-o__code">
                  <span className="rv-o__verbe">POST</span> /v1/iban/validate
                  {"\n"}
                  {'{"iban":"'}
                  <span className="rv-o__arg">DE89370400440532013000</span>
                  {'"}'}
                </pre>
              </div>
              <div className="rv-o__cadre rv-o__cadre--tableur">
                <p className="rv-kicker rv-o__tete">
                  <span>{copy.frames.sheet}</span>
                  <span>{copy.frames.sheetTag}</span>
                </p>
                <div className="rv-o__feuille">
                  <div className="rv-o__fx">
                    <span className="rv-o__ref">B2</span>
                    <span className="rv-o__fxl" aria-hidden="true">
                      fx
                    </span>
                    <span className="rv-o__arg">{copy.formula}</span>
                  </div>
                  <div className="rv-o__grille" aria-hidden="true">
                    <span className="rv-o__c rv-o__c--t" />
                    <span className="rv-o__c rv-o__c--t">A</span>
                    <span className="rv-o__c rv-o__c--t">B</span>
                    <span className="rv-o__c rv-o__c--t">2</span>
                    <span className="rv-o__c">DE89370400440532013000</span>
                    <span className="rv-o__c rv-o__c--actif">{copy.formula}</span>
                  </div>
                </div>
                <p className="rv-o__note">{copy.sheetNote}</p>
              </div>
              <div className="rv-o__cadre rv-o__cadre--agent">
                <p className="rv-kicker rv-o__tete">
                  <span>{copy.frames.agent}</span>
                  <span>{copy.frames.agentTag}</span>
                </p>
                <pre className="rv-o__code">
                  <span className="rv-o__invite">$</span> npx -y <span className="rv-o__arg">ibanforge-mcp</span>
                </pre>
                <p className="rv-o__note">{copy.mcpNote}</p>
              </div>
            </div>
          </div>

          {/* Way 02: the file, its counter, the column read line by line, the flagged lines. */}
          <div className="rv-plan4 rv-plan4--fichier rv-f">
            <div className="rv-f__corps">
              <div className="rv-f__compte">
                <p
                  className={sep === "," ? "rv-f__nombre rv-f__nombre--virgule" : "rv-f__nombre"}
                  style={{ "--em": copy.counter.em } as CSSProperties}
                >
                  <Counter total={total} sep={sep} />
                  <span className="rv-f__roule" aria-hidden="true" />
                </p>
                <p className="rv-f__unite">{copy.unit}</p>
              </div>
              <div className="rv-f__scene">
                <div className="rv-f__fenetre" aria-hidden="true">
                  <ol className="rv-f__liste">
                    {COLUMN.map(([country, length, flagged], i) => (
                      <li key={i} className={flagged ? "rv-f__signalee" : undefined}>
                        {flagged ? (
                          <span className="rv-f__ib">
                            {masked(country, length)}
                            <i className="rv-f__barre" />
                          </span>
                        ) : (
                          masked(country, length)
                        )}
                      </li>
                    ))}
                  </ol>
                  <i className="rv-f__lecteur" />
                </div>
                <div className="rv-f__arretees">
                  <p className="rv-f__sur">
                    <span className="rv-f__pt" aria-hidden="true" />
                    {copy.flagged}
                  </p>
                  <p className="rv-f__arr">
                    <span className="rv-f__arr-iban">
                      DE65{" "}
                      <span className="rv-f__code">
                        1234 5678
                        <i className="rv-f__barre" aria-hidden="true" />
                      </span>{" "}
                      0532 0130 00
                    </span>
                    <span className="rv-f__raison">{reasonCode}</span>
                  </p>
                  <p className="rv-f__arr">
                    <span className="rv-f__arr-iban">
                      DE89 3704 0044 0532 0130 01
                      <i className="rv-f__barre" aria-hidden="true" />
                    </span>
                    <span className="rv-f__raison">{reasonTypo}</span>
                  </p>
                </div>
              </div>
            </div>
            <p className="rv-figcap">
              <span className="rv-figcap__num">{copy.figure}</span>
              <span>{copy.caption}</span>
            </p>
          </div>
        </div>
      </figure>

      <div className="rv-voies__liste" role="group" aria-label={copy.group} ref={list}>
        {copy.ways.map((way, i) => (
          <div className="rv-voie" key={way.num} data-rv="texte" style={i ? ({ "--rv-d": `${i / 10}s` } as CSSProperties) : undefined}>
            <button className="rv-voie__b" type="button" aria-controls="rv-scene4" aria-current={i === 1 ? "true" : undefined}>
              <span className="rv-voie__num" aria-hidden="true">
                {way.num}
              </span>
              <span className="rv-voie__nom">{way.name}</span>
              <span className="rv-voie__pub">{way.audience}</span>
              <i className="rv-voie__barre" aria-hidden="true" />
            </button>
            <p className="rv-corps">
              {way.text}{" "}
              <Link className="rv-lien rv-nw" href={way.link.href} data-evt={way.link.evt}>
                {way.link.label}
                <span className="rv-fl" aria-hidden="true">
                  ↗
                </span>
              </Link>
            </p>
          </div>
        ))}
      </div>
    </>
  )
}

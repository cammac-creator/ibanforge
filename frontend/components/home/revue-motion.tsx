"use client"

import { useEffect } from "react"

/**
 * The arrival of the chapters of « La revue » and of its ending: the hairline
 * draws itself, the hollow numeral comes into focus, the title rises word by
 * word, the standfirst and the figure come into focus; the figures of chapter
 * 05 rise and settle, the red line of the ending crosses out the code no bank
 * holds. Once each. The cover never moves (it is the first paint).
 *
 * Two gestures on one curve, in CSS (revue.css): the rise from a mask and the
 * pull into focus. Nothing is hidden without this script, nor under reduced
 * motion; what is already on screen when it runs is left as it is, since
 * hiding it would flash.
 */
export function RevueMotion() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return
    const chapters = Array.from(document.querySelectorAll<HTMLElement>(".rv-chap, .rv-fin"))
    const blocks = chapters.flatMap((chapter) => Array.from(chapter.querySelectorAll<HTMLElement>("[data-rv]")))
    for (const title of blocks) {
      if (title.dataset.rv !== "titre") continue
      title.querySelectorAll<HTMLElement>(".rv-mot > span").forEach((word, i) => word.style.setProperty("--rv-i", String(i)))
    }
    const fold = window.innerHeight
    for (const block of blocks) {
      if (block.getBoundingClientRect().top < fold) block.classList.add("rv-vu")
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add("rv-vu")
          io.unobserve(entry.target)
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    )
    for (const block of blocks) if (!block.classList.contains("rv-vu")) io.observe(block)
    for (const chapter of chapters) chapter.classList.add("rv-anim")
    return () => {
      io.disconnect()
      for (const chapter of chapters) chapter.classList.remove("rv-anim")
    }
  }, [])
  return null
}

/**
 * The fitted lines keep to one line while their font loads: a line that
 * wrapped, then closed up when Bebas arrived, moved the whole first screen.
 * Once every load has settled, a line or a group that still runs past its
 * column means the font never came (the fallback faces are wider): only then
 * does it give way (`.rv-souple`). The lines of the cover and of the ending
 * wrap, the word groups of a title break, the counter of chapter 04 shrinks, a
 * link keeps its arrow no more, a path of the API breaks. Read from the layout
 * itself: WebKit does not report a blocked font as failed.
 */
export function CoverTitleGuard() {
  useEffect(() => {
    const fonts = document.fonts
    if (!fonts?.ready) return
    let cancelled = false
    void fonts.ready.then(() => {
      if (cancelled) return
      const title = document.querySelector<HTMLElement>(".rv-h1")
      const lines = title ? Array.from(title.querySelectorAll<HTMLElement>(".rv-ligne")) : []
      if (title && lines.some((line) => line.scrollWidth > line.clientWidth + 1)) title.classList.add("rv-h1--souple")
      const past = (el: Element, box: Element) => el.getBoundingClientRect().right > box.getBoundingClientRect().right + 1
      for (const box of document.querySelectorAll<HTMLElement>(".rv-h2, .rv-fin__titre")) {
        if (Array.from(box.querySelectorAll(".rv-mot")).some((word) => past(word, box))) box.classList.add("rv-souple")
      }
      for (const figure of document.querySelectorAll<HTMLElement>(".rv-f__nombre")) {
        if (figure.scrollWidth > figure.clientWidth + 1) figure.classList.add("rv-souple")
      }
      // A paragraph wider than itself: its unbreakable pieces (and the
      // punctuation that clings to them) give way.
      for (const box of document.querySelectorAll<HTMLElement>(".rv-page p, .rv-page li, .rv-page dd")) {
        if (box.scrollWidth <= box.clientWidth + 1) continue
        box.querySelectorAll<HTMLElement>(".rv-nw, code").forEach((piece) => piece.classList.add("rv-souple"))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
  return null
}

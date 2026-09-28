"use client"

import { useEffect } from "react"

/**
 * The arrival of the chapter openers of « La revue »: the hairline draws
 * itself, the hollow numeral comes into focus, the title rises word by word,
 * the standfirst follows. The cover never moves (it is the first paint).
 *
 * Nothing is hidden without this script, nor under reduced motion; what is
 * already on screen when it runs is left as it is, since hiding it would flash.
 */
export function RevueMotion() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return
    const chapters = Array.from(document.querySelectorAll<HTMLElement>(".rv-chap"))
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
 * The cover title keeps each line on one line while its font loads (a line
 * that wrapped, then closed up when Bebas arrived, moved the whole first
 * screen). Once every load has settled, a line that still runs past its
 * column means the font never came: only then may the lines wrap.
 */
export function CoverTitleGuard() {
  useEffect(() => {
    const title = document.querySelector<HTMLElement>(".rv-h1")
    const fonts = document.fonts
    if (!title || !fonts?.ready) return
    let cancelled = false
    void fonts.ready.then(() => {
      if (cancelled) return
      const lines = Array.from(title.querySelectorAll<HTMLElement>(".rv-ligne"))
      if (lines.some((line) => line.scrollWidth > line.clientWidth + 1)) title.classList.add("rv-h1--souple")
    })
    return () => {
      cancelled = true
    }
  }, [])
  return null
}


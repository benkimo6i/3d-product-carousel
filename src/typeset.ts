import type { CopyBlock, CopyDoc, ProductCopy } from './types'

const NBSP = ' '

/** Joins the words of a phrase with no-break spaces, so it never splits across lines. */
const bind = (phrase: string) => phrase.replace(/ /g, NBSP)

/** Joins a paragraph's last two words, so its last line never holds a single word. */
const noOrphan = (text: string) => text.replace(/ (\S+)$/, `${NBSP}$1`)

/** Matches any product name ("MacBook Pro 14\"", or plain "MacBook Pro"), longest first. */
function namePattern(products: ProductCopy[]): RegExp {
  const names = new Set<string>()
  for (const { name } of products) {
    names.add(name)
    // Copy also says "MacBook Pro" without the size.
    names.add(name.replace(/ \d+"$/, ''))
  }
  const multiWord = [...names].filter((n) => n.includes(' ')).sort((a, b) => b.length - a.length)
  return new RegExp(multiWord.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
}

/**
 * Runs once when the copy loads: product names never break across lines, and paragraphs never
 * end on a lone word. Also derives each carousel tagline from the subline.
 */
export function typesetCopy(doc: CopyDoc): CopyDoc {
  const pattern = namePattern(Object.values(doc.products))
  const names = (text: string) => text.replace(pattern, bind)
  const para = (text: string) => noOrphan(names(text))
  const block = (b: CopyBlock): CopyBlock => ({ title: names(b.title), body: para(b.body) })

  const products: Record<string, ProductCopy> = {}
  for (const [key, c] of Object.entries(doc.products)) {
    // "MacBook Pro 14". Serious performance, compact size. From $X,XXX*" → the middle sentence.
    const tagline = c.subline.replace(/^[^.]*\.\s*/, '').replace(/\s*From .*$/, '')
    products[key] = {
      ...c,
      name: names(c.name),
      headline: names(c.headline),
      subline: para(c.subline),
      tagline: para(tagline),
      left: c.left.map(block),
      right: c.right.map(block),
      cta: { ...block(c.cta), actions: c.cta.actions },
      footnote: para(c.footnote),
    }
  }
  return { ...doc, products }
}

import { Script } from "scripting"

const CHEERIO_BUNDLE = "/assets/vendor/cheerio.js"

let _cheerio: any = null
function getCheerio(): any {
  if (!_cheerio) {
    const source = FileManager.readAsStringSync(Script.directory + CHEERIO_BUNDLE)
    _cheerio = (new Function(source + "\nreturn createCheerio")() as () => any)()
  }
  return _cheerio
}

interface Doc {
  $: any
  nodes: Map<number, any>
  keys: WeakMap<object, number>
}

const docs = new Map<number, Doc>()
let nextDocKey = 0
let nextNodeKey = 1

const MAX_LIVE_DOCS = 16

function isTag(node: any): boolean {
  return !!node && (node.type === "tag" || node.type === "script" || node.type === "style")
}

function isDocument(node: any): boolean {
  return !!node && (node.type === "root" || node.type === "document")
}

export function parseDocument(html: string): number {
  const $ = getCheerio().load(html ?? "")
  const key = nextDocKey++
  const doc: Doc = { $, nodes: new Map(), keys: new WeakMap() }
  const root = $.root()[0]
  doc.nodes.set(0, root)
  if (root && typeof root === "object") doc.keys.set(root, 0)
  docs.set(key, doc)
  evictOverLimit()
  return key
}

function touch(docKey: number, d: Doc) {
  docs.delete(docKey)
  docs.set(docKey, d)
}

function evictOverLimit() {
  while (docs.size > MAX_LIVE_DOCS) {
    const oldest = docs.keys().next()
    if (oldest.done) return
    docs.delete(oldest.value)
  }
}

export function liveDocumentCount(): number {
  return docs.size
}

function doc(key: number): Doc {
  const d = docs.get(key)
  if (!d) throw new Error(`HtmlDocument: 已釋放的文件 (key=${key})`)
  touch(key, d)
  return d
}

function nodeOf(docKey: number, nodeKey: number): any {
  const d = doc(docKey)
  const node = d.nodes.get(nodeKey)
  if (!node) throw new Error(`HtmlDocument: 找不到節點 (key=${nodeKey})`)
  return node
}

function register(docKey: number, node: any): number | null {
  if (!node) return null
  const d = doc(docKey)
  const known = d.keys.get(node)
  if (known !== undefined) return known
  const key = nextNodeKey++
  d.nodes.set(key, node)
  d.keys.set(node, key)
  return key
}

function firstMatch($: any, root: any, query: string): any {
  const result = isDocument(root) ? $(query) : $(root).find(query)
  return result.get(0) ?? null
}

function allMatches($: any, root: any, query: string): any[] {
  const result = isDocument(root) ? $(query) : $(root).find(query)
  return result.get() ?? []
}

export function querySelector(docKey: number, query: string): number | null {
  const d = doc(docKey)
  return register(docKey, firstMatch(d.$, d.nodes.get(0), query))
}

export function querySelectorAll(docKey: number, query: string): number[] {
  const d = doc(docKey)
  return allMatches(d.$, d.nodes.get(0), query)
    .map(node => register(docKey, node))
    .filter((k): k is number => k != null)
}

export function getElementById(docKey: number, id: string): number | null {
  const d = doc(docKey)
  return register(docKey, firstMatch(d.$, d.nodes.get(0), `#${cssEscape(id)}`))
}

export function domQuerySelector(docKey: number, nodeKey: number, query: string): number | null {
  const d = doc(docKey)
  return register(docKey, firstMatch(d.$, nodeOf(docKey, nodeKey), query))
}

export function domQuerySelectorAll(docKey: number, nodeKey: number, query: string): number[] {
  const d = doc(docKey)
  return allMatches(d.$, nodeOf(docKey, nodeKey), query)
    .map(node => register(docKey, node))
    .filter((k): k is number => k != null)
}

export function getText(docKey: number, nodeKey: number): string {
  const d = doc(docKey)
  return d.$(nodeOf(docKey, nodeKey)).text()
}

export function getAttributes(docKey: number, nodeKey: number): Record<string, string> {
  const node = nodeOf(docKey, nodeKey)
  return { ...(node.attribs ?? {}) }
}

export function getInnerHTML(docKey: number, nodeKey: number): string {
  const d = doc(docKey)
  return d.$(nodeOf(docKey, nodeKey)).html() ?? ""
}

export function getChildren(docKey: number, nodeKey: number): number[] {
  const node = nodeOf(docKey, nodeKey)
  return (node.children ?? [])
    .filter(isTag)
    .map((child: any) => register(docKey, child))
    .filter((k: number | null): k is number => k != null)
}

export function getNodes(docKey: number, nodeKey: number): number[] {
  const node = nodeOf(docKey, nodeKey)
  return (node.children ?? [])
    .map((child: any) => register(docKey, child))
    .filter((k: number | null): k is number => k != null)
}

export function getParent(docKey: number, nodeKey: number): number | null {
  const parent = nodeOf(docKey, nodeKey).parent
  if (!parent || isDocument(parent)) return null
  return register(docKey, parent)
}

export function getClassNames(docKey: number, nodeKey: number): string[] {
  const cls = nodeOf(docKey, nodeKey).attribs?.class
  if (typeof cls !== "string") return []
  return cls.split(/\s+/).filter(Boolean)
}

export function getId(docKey: number, nodeKey: number): string | null {
  return nodeOf(docKey, nodeKey).attribs?.id ?? null
}

export function getLocalName(docKey: number, nodeKey: number): string {
  return nodeOf(docKey, nodeKey).name ?? ""
}

function sibling(docKey: number, nodeKey: number, step: -1 | 1): number | null {
  const node = nodeOf(docKey, nodeKey)
  const parent = node.parent
  if (!parent) return null
  const tags = (parent.children ?? []).filter(isTag)
  const idx = tags.indexOf(node)
  if (idx < 0) return null
  const target = tags[idx + step]
  return target ? register(docKey, target) : null
}

export function getPreviousSibling(docKey: number, nodeKey: number): number | null {
  return sibling(docKey, nodeKey, -1)
}

export function getNextSibling(docKey: number, nodeKey: number): number | null {
  return sibling(docKey, nodeKey, 1)
}

export function nodeText(docKey: number, nodeKey: number): string {
  const d = doc(docKey)
  const node = nodeOf(docKey, nodeKey)
  if (node.type === "text") return node.data ?? ""
  return d.$(node).text()
}

export function nodeType(docKey: number, nodeKey: number): string {
  const type = nodeOf(docKey, nodeKey).type
  if (type === "text") return "text"
  if (type === "comment") return "comment"
  if (type === "root" || type === "document") return "document"
  if (isTag({ type })) return "element"
  return "unknown"
}

export function nodeToElement(docKey: number, nodeKey: number): number | null {
  const node = nodeOf(docKey, nodeKey)
  return isTag(node) ? nodeKey : null
}

export function disposeDocument(docKey: number) {
  docs.delete(docKey)
}

function cssEscape(value: string): string {
  return String(value).replace(/([^\w-])/g, "\\$1")
}

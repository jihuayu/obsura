import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import obscura from '../index.js'

const { fetch } = obscura

const url =
  process.argv[2] ??
  pathToFileURL(join(process.cwd(), 'test', 'fixtures', 'static.html')).href

const page = await fetch(url, {
  waitUntil: 'load',
  includeText: true,
  includeLinks: true,
  includeMarkdown: true,
  eval: 'document.title',
})

console.log({
  url: page.url,
  finalUrl: page.finalUrl,
  status: page.status,
  title: page.title,
  text: page.text,
  links: page.links,
  markdownPreview: page.markdown?.slice(0, 240),
  eval: page.eval,
  htmlPreview: page.html.slice(0, 120),
  totalMs: page.timing.totalMs,
})

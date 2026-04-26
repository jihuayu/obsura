import obscura from '../index.js'

const { scrape } = obscura

const url = process.argv[2] ?? 'https://example.com'

const page = await scrape(url, {
  waitUntil: 'load',
  includeLinks: true,
  includeHtml: true,
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

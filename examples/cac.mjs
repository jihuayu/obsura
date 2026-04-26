import obscura from '../index.js'

const { scrape } = obscura

const page = await scrape('https://example.com', {
  waitUntil: 'domcontentloaded',
})

console.log(page.markdown)

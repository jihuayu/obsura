import puppeteer from 'puppeteer-core'
import obscura from '../index.js'

const { createPuppeteerTransport } = obscura

const transport = createPuppeteerTransport()
const browser = await puppeteer.connect({
  transport,
  defaultViewport: null,
})

try {
  const page = await browser.newPage()
  const url = process.argv[2] ?? 'https://example.com'

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  console.log(await page.title())

  const cdp = await page.createCDPSession()
  const { markdown } = await cdp.send('LP.getMarkdown')
  console.log(markdown.slice(0, 240))
} finally {
  await browser.close()
}

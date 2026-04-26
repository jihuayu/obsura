import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
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
  const url =
    process.argv[2] ??
    pathToFileURL(join(process.cwd(), 'test', 'fixtures', 'static.html')).href

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  console.log(await page.title())

  const cdp = await page.createCDPSession()
  const { markdown } = await cdp.send('LP.getMarkdown')
  console.log(markdown.slice(0, 240))
} finally {
  await browser.close()
}

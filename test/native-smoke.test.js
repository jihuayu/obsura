'use strict'

const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { join } = require('node:path')
const test = require('node:test')
const puppeteer = require('puppeteer-core')

const { createPuppeteerTransport, scrape } = require('..')

const fixtureUrl = pathToFileURL(join(__dirname, 'fixtures', 'static.html')).href

test('native scrape wrapper returns default extracted content', async () => {
  const result = await scrape(fixtureUrl)

  assert.equal(typeof result, 'object')
  assert.equal(result.url, fixtureUrl)
  assert.equal(result.html, undefined)
  assert.match(result.text, /Hello from Obscura Node/)
  assert.match(result.markdown, /Fixture Heading/)
})

test('native scrape returns optional html, links, scoped markdown, selector, and eval', async () => {
  const result = await scrape(fixtureUrl, {
    selector: 'main',
    contentSelector: 'main',
    includeHtml: true,
    includeLinks: true,
    eval: 'document.title',
  })

  assert.equal(typeof result.html, 'string')
  assert.match(result.html, /<!DOCTYPE html>/)
  assert.deepEqual(result.links, [{ url: 'file:///docs', text: 'Docs' }])
  assert.match(result.markdown, /Fixture Heading/)
  assert.doesNotMatch(result.markdown, /Obscura Node Fixture/)
  assert.equal(result.eval, 'Obscura Node Fixture')
})

test('native puppeteer transport can connect and close', async () => {
  const transport = createPuppeteerTransport()
  const browser = await puppeteer.connect({
    transport,
    defaultViewport: null,
  })

  await browser.close()
  await transport.close()
  await transport.closed
})

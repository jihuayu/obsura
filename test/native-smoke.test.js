'use strict'

const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { join } = require('node:path')
const test = require('node:test')
const puppeteer = require('puppeteer-core')

const { createPuppeteerTransport, fetch } = require('..')

const fixtureUrl = pathToFileURL(join(__dirname, 'fixtures', 'static.html')).href

test('native fetch wrapper returns a parsed object', async () => {
  const result = await fetch(fixtureUrl)

  assert.equal(typeof result, 'object')
  assert.equal(result.url, fixtureUrl)
  assert.equal(typeof result.html, 'string')
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

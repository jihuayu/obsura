# node-obscura

A lightweight, embeddable headless browser for AI agents and web scraping, built with [Obscura](https://github.com/h4ckf0r0day/obscura).

`node-obscura` packages Obscura as a Node.js library with a lightweight scrape API and a Puppeteer-compatible transport, so agents and scraping tools can run browser workflows without managing a separate browser process.

## Install

```bash
npm install node-obscura
```

## Usage

### Direct Scrape

```js
const { scrape } = require('node-obscura')

async function main() {
  const page = await scrape('https://example.com', {
    waitUntil: 'networkidle0',
    includeLinks: true,
    eval: 'document.title',
  })

  console.log(page.title)
  console.log(page.text)
  console.log(page.markdown)
  console.log(page.links)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
```

`scrape()` is the small path for simple pages: it opens one URL, waits for the page or a selector, and returns extracted text and Markdown by default. Enable `includeHtml` or `includeLinks` when you need those heavier fields. For multi-step interactions, forms, CDP control, or full browser automation, use the Puppeteer transport instead.

### With Puppeteer

`node-obscura` can provide a Puppeteer transport backed by Obscura's CDP session. Install `puppeteer-core` alongside this package:

```bash
npm install node-obscura puppeteer-core
```

```js
import puppeteer from 'puppeteer-core'
import obscura from 'node-obscura'

const { createPuppeteerTransport } = obscura

const transport = createPuppeteerTransport({
  stealth: true,
})

const browser = await puppeteer.connect({
  transport,
  defaultViewport: null,
})

try {
  const page = await browser.newPage()
  await page.goto('https://example.com', {
    waitUntil: 'domcontentloaded',
  })

  console.log(await page.title())

  const cdp = await page.createCDPSession()
  const { markdown } = await cdp.send('LP.getMarkdown')
  console.log(markdown)
} finally {
  await browser.close()
}
```

## Build From Source

This repository does not vendor Obscura upstream source code. During setup it downloads the pinned upstream commit into `vendor/obscura`, applies the compatibility patches in `patches/`, and builds the local native addon.

Pinned upstream commit:

```text
99e75f1e62930f864302db9c4d18e91e7ee3f0bd
```

### Requirements

- Node.js 18+
- npm
- git
- Rust/Cargo

The first install builds the native addon from source.

For local development:

```bash
npm install
npm test
```

## Patch Workflow

Only upstream Obscura compatibility changes belong in `patches/`. The local N-API crate in `crates/node-obscura` is first-class project source and should be committed directly, not generated as a patch.

To update upstream patches:

```bash
npm run setup
# edit upstream files under vendor/obscura
npm run patch:generate -- my-change
git add patches/my-change.patch patches/series
```

Use `npm run patch:status` to check whether `vendor/obscura` has source changes waiting to be turned into a patch.

Do not commit `vendor/obscura/`, `target/`, generated `.node` files, or `napi-generated.d.ts`.

## Source Metadata

The upstream repository and pinned commit are stored in `obscura-source.json`.

## Credits

Credit for the browser engine and core implementation belongs to the upstream [Obscura](https://github.com/h4ckf0r0day/obscura) project. This package provides Node.js bindings, packaging, and compatibility patches around a pinned upstream commit.

# node-obscura

A lightweight, embeddable headless browser for AI agents and web scraping, built with [Obscura](https://github.com/h4ckf0r0day/obscura).

`node-obscura` packages Obscura as a Node.js library with a simple fetch API and a Puppeteer-compatible transport, so agents and scraping tools can run browser workflows without managing a separate browser process.

Credit for the browser engine and core implementation belongs to the upstream [Obscura](https://github.com/h4ckf0r0day/obscura) project. This package provides Node.js bindings, packaging, and compatibility patches around a pinned upstream commit.

Pinned upstream commit:

```text
99e75f1e62930f864302db9c4d18e91e7ee3f0bd
```

## Install

```bash
npm install node-obscura
```

## Usage

### Direct Fetch

```js
const { fetch } = require('node-obscura')

async function main() {
  const page = await fetch('https://example.com', {
    waitUntil: 'networkidle0',
    includeText: true,
    includeLinks: true,
    includeMarkdown: true,
    eval: 'document.title',
  })

  console.log(page.title)
  console.log(page.text)
  console.log(page.links)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
```

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

`node-obscura` is built on top of [Obscura](https://github.com/h4ckf0r0day/obscura). Please credit the upstream project when using or redistributing this package.

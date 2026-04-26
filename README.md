# node-obscura

Node.js native bindings for [Obscura](https://github.com/h4ckf0r0day/obscura), built from this repository's `crates/node-obscura` N-API crate.

This repository does not vendor Obscura upstream source code. During setup it downloads a pinned upstream commit into `vendor/obscura`, applies the compatibility patches in `patches/`, and builds the local native addon.

Pinned upstream commit:

```text
99e75f1e62930f864302db9c4d18e91e7ee3f0bd
```

## Requirements

- Node.js 18+
- npm
- git
- Rust/Cargo

The first install builds the native addon from source.

## Install

```bash
npm install node-obscura
```

For local development:

```bash
npm install
npm test
```

## JavaScript API

```js
const { fetch, createPuppeteerTransport } = require('node-obscura');

const page = await fetch('https://example.com', {
  waitUntil: 'networkidle0',
  includeText: true,
  includeLinks: true,
  eval: 'document.title',
});

console.log(page.title);
console.log(page.text);

const transport = createPuppeteerTransport({ stealth: true });
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

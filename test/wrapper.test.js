'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { createExports } = require('../lib/create-exports')

function createMockBinding() {
  const sessions = []

  class NativeCdpSession {
    constructor(options, callback) {
      this.options = options
      this.callback = callback
      this.sent = []
      this.closeCount = 0
      sessions.push(this)
    }

    send(message) {
      this.sent.push(message)
    }

    close() {
      this.closeCount += 1
    }

    emit(message) {
      this.callback(message)
    }
  }

  return {
    binding: {
      scrape: async () => JSON.stringify({ ok: true }),
      NativeCdpSession,
    },
    sessions,
  }
}

test('exports public wrapper API', () => {
  const { binding } = createMockBinding()
  const api = createExports(binding)

  assert.equal(typeof api.scrape, 'function')
  assert.equal(api.fetch, undefined)
  assert.equal(typeof api.createPuppeteerTransport, 'function')

  const transport = api.createPuppeteerTransport()
  assert.equal(typeof transport.send, 'function')
  assert.equal(typeof transport.close, 'function')
  assert.equal(transport.closed instanceof Promise, true)
  assert.equal(transport.onmessage, undefined)
  assert.equal(transport.onclose, undefined)
  assert.equal(transport.onerror, undefined)
})

test('scrape parses native JSON result', async () => {
  const calls = []
  const api = createExports({
    scrape: async (url, options) => {
      calls.push({ url, options })
      return JSON.stringify({ url, nested: { ok: true } })
    },
    NativeCdpSession: class {},
  })

  const result = await api.scrape('file:///tmp/page.html', { includeText: true })

  assert.deepEqual(calls, [
    {
      url: 'file:///tmp/page.html',
      options: { includeText: true },
    },
  ])
  assert.deepEqual(result, {
    url: 'file:///tmp/page.html',
    nested: { ok: true },
  })
})

test('scrape rejects native errors and invalid native JSON', async () => {
  const nativeError = new Error('native failed')
  const apiWithNativeError = createExports({
    scrape: async () => {
      throw nativeError
    },
    NativeCdpSession: class {},
  })

  await assert.rejects(() => apiWithNativeError.scrape('https://example.com'), nativeError)

  const apiWithBadJson = createExports({
    scrape: async () => '{bad json',
    NativeCdpSession: class {},
  })

  await assert.rejects(() => apiWithBadJson.scrape('https://example.com'), SyntaxError)
})

test('transport forwards messages to native session and emits onmessage', () => {
  const { binding, sessions } = createMockBinding()
  const api = createExports(binding)
  const received = []
  const transport = api.createPuppeteerTransport({ stealth: true })
  transport.onmessage = message => received.push(message)

  transport.send('{"id":1,"method":"Browser.getVersion"}')
  sessions[0].emit('{"id":1,"result":{}}')

  assert.deepEqual(sessions[0].options, { stealth: true })
  assert.deepEqual(sessions[0].sent, ['{"id":1,"method":"Browser.getVersion"}'])
  assert.deepEqual(received, ['{"id":1,"result":{}}'])
})

test('transport close is idempotent, awaitable, and blocks future sends', async () => {
  const { binding, sessions } = createMockBinding()
  const api = createExports(binding)
  let closeCount = 0
  const transport = api.createPuppeteerTransport()
  transport.onclose = () => {
    closeCount += 1
  }

  const closed = transport.closed
  await transport.close()
  await transport.close()
  await closed

  assert.equal(closeCount, 1)
  assert.equal(sessions[0].closeCount, 1)
  assert.throws(
    () => transport.send('{"id":1,"method":"Browser.getVersion"}'),
    /transport is closed/
  )
})

test('transport close sentinel emits onclose once', () => {
  const { binding, sessions } = createMockBinding()
  const api = createExports(binding)
  let closeCount = 0
  const transport = api.createPuppeteerTransport()
  transport.onclose = () => {
    closeCount += 1
  }

  sessions[0].emit('__OBSCURA_CDP_TRANSPORT_CLOSED__')
  sessions[0].emit('__OBSCURA_CDP_TRANSPORT_CLOSED__')

  assert.equal(closeCount, 1)
  assert.throws(
    () => transport.send('{"id":1,"method":"Browser.getVersion"}'),
    /transport is closed/
  )
})

test('transport closes after matching Browser.close response', async () => {
  const { binding, sessions } = createMockBinding()
  const api = createExports(binding)
  let closeCount = 0
  const transport = api.createPuppeteerTransport()
  transport.onclose = () => {
    closeCount += 1
  }

  transport.send('{"id":42,"method":"Browser.close"}')
  sessions[0].emit('{"id":41,"result":{}}')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closeCount, 0)

  sessions[0].emit('{"id":42,"result":{}}')
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(closeCount, 1)
  assert.equal(sessions[0].closeCount, 1)
})

test('transport emits native session errors through onerror', () => {
  const { binding, sessions } = createMockBinding()
  const api = createExports(binding)
  const errors = []
  const transport = api.createPuppeteerTransport()
  transport.onerror = error => errors.push(error)

  sessions[0].emit('{"error":"native session failed"}')
  sessions[0].emit('{bad json')

  assert.equal(errors.length, 2)
  assert.equal(errors[0].message, 'native session failed')
  assert.match(errors[1].message, /Invalid CDP message/)
})

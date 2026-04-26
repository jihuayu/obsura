'use strict'

const CLOSE_SENTINEL = '__OBSCURA_CDP_TRANSPORT_CLOSED__'

function createExports(nativeBinding) {
  async function scrape(url, options) {
    return JSON.parse(await nativeBinding.scrape(url, options))
  }

  class ObscuraPuppeteerTransport {
    constructor(options) {
      this.onmessage = undefined
      this.onclose = undefined
      this.onerror = undefined
      this._closed = false
      this._closeEmitted = false
      this._browserCloseId = undefined
      this.closed = new Promise(resolve => {
        this._resolveClosed = resolve
      })
      this._native = new nativeBinding.NativeCdpSession(options ?? {}, message => {
        if (message === CLOSE_SENTINEL) {
          this._emitClose()
          return
        }

        if (this._closed) {
          return
        }

        let parsed
        try {
          parsed = JSON.parse(message)
        } catch {
          this._emitError(new Error(`Invalid CDP message from native session: ${message}`))
          return
        }

        if (parsed && typeof parsed.error === 'string' && parsed.id === undefined) {
          this._emitError(new Error(parsed.error))
          return
        }

        if (this.onmessage) {
          this.onmessage(message)
        }

        if (
          this._browserCloseId !== undefined &&
          parsed &&
          parsed.id === this._browserCloseId
        ) {
          this._browserCloseId = undefined
          setImmediate(() => {
            void this.close()
          })
        }
      })
    }

    send(message) {
      if (this._closed) {
        throw new Error('Obscura Puppeteer transport is closed')
      }

      try {
        const parsed = JSON.parse(message)
        if (parsed && parsed.method === 'Browser.close') {
          this._browserCloseId = parsed.id
        }
      } catch {
        // Let native CDP validation return the actual protocol error.
      }

      this._native.send(message)
    }

    async close() {
      if (this._closed) {
        return this.closed
      }

      this._closed = true

      try {
        this._native.close()
      } catch (error) {
        this._emitError(error)
      }

      this._emitClose()
      return this.closed
    }

    _emitClose() {
      if (this._closeEmitted) {
        return
      }
      this._closed = true
      this._closeEmitted = true
      if (this.onclose) {
        this.onclose()
      }
      this._resolveClosed()
    }

    _emitError(error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error ?? 'Unknown transport error'))
      if (this.onerror) {
        this.onerror(normalized)
      }
    }
  }

  return {
    scrape,
    createPuppeteerTransport(options) {
      return new ObscuraPuppeteerTransport(options)
    },
  }
}

module.exports = { createExports }

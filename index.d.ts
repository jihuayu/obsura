export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle0'

export interface FetchOptions {
  waitUntil?: WaitUntil
  selector?: string
  timeoutMs?: number
  userAgent?: string
  proxy?: string
  stealth?: boolean
  eval?: string
  includeText?: boolean
  includeLinks?: boolean
  includeMarkdown?: boolean
  contentSelector?: string
}

export interface FetchLink {
  url: string
  text: string
}

export interface FetchResult {
  url: string
  finalUrl: string
  status?: number
  title: string
  html: string
  text?: string
  links?: FetchLink[]
  markdown?: string
  eval?: unknown
  timing: {
    totalMs: number
  }
}

export function fetch(url: string, options?: FetchOptions): Promise<FetchResult>

export interface PuppeteerTransportOptions {
  proxy?: string
  stealth?: boolean
  userAgent?: string
}

export interface ObscuraPuppeteerTransport {
  onmessage?: (message: string) => void
  onclose?: () => void
  onerror?: (error: Error) => void
  readonly closed: Promise<void>
  send(message: string): void
  close(): Promise<void>
}

export function createPuppeteerTransport(
  options?: PuppeteerTransportOptions
): ObscuraPuppeteerTransport

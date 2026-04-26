export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle0'

export interface ScrapeOptions {
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
  includeHtml?: boolean
  contentSelector?: string
}

export interface ScrapeLink {
  url: string
  text: string
}

export interface ScrapeResult {
  url: string
  finalUrl: string
  status?: number
  title: string
  html?: string
  text?: string
  links?: ScrapeLink[]
  markdown?: string
  eval?: unknown
  timing: {
    totalMs: number
  }
}

export function scrape(url: string, options?: ScrapeOptions): Promise<ScrapeResult>

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

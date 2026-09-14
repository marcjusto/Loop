import { LUNA_PER_NIM } from '../../shared/types.js'

export { LUNA_PER_NIM }

/**
 * NIM amounts, rendered the way a person reads them.
 *
 * Under 1 NIM we show up to five decimals because that is the real precision;
 * above it we round to two, because nobody splitting a dinner cares about the
 * third decimal of a thousand-NIM bill.
 */
export function formatNim(luna: number, options: { sign?: boolean } = {}): string {
  const nim = Math.abs(luna) / LUNA_PER_NIM
  const decimals = nim === 0 ? 0 : nim < 1 ? 5 : nim < 1000 ? 2 : 0
  const body = nim.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
  if (!options.sign) return body
  if (luna > 0) return `+${body}`
  if (luna < 0) return `−${body}`
  return body
}

/** Parse what somebody typed into an integer luna amount. Null if it is not a number. */
export function parseNimInput(input: string): number | null {
  const cleaned = input.replace(/[\s,]/g, '').replace(',', '.')
  if (!cleaned) return null
  if (!/^\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  // Round to whole luna — the smallest unit that exists.
  const luna = Math.round(value * LUNA_PER_NIM)
  if (luna <= 0) return null
  return luna
}

export function lunaToFiat(luna: number, rate: number): number {
  return (luna / LUNA_PER_NIM) * rate
}

export function fiatToLuna(amount: number, rate: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || rate <= 0) return null
  const luna = Math.round((amount / rate) * LUNA_PER_NIM)
  return luna > 0 ? luna : null
}

export function formatFiat(amount: number, currency: string): string {
  try {
    return amount.toLocaleString(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    })
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`
  }
}

/** `NQ12 3456 …` — the first two and last two groups, which is how people recognise one. */
export function shortAddress(address: string): string {
  const clean = address.replace(/\s/g, '')
  if (clean.length < 12) return clean
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`
}

export function prettyAddress(address: string): string {
  return address
    .replace(/\s/g, '')
    .replace(/.{4}/g, '$& ')
    .trim()
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return 'just now'
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`
  if (diff < day) return `${Math.floor(diff / hour)}h ago`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Eight colours from the Nimiq palette, picked deterministically per person. */
export const AVATAR_COLORS = [
  '#0582CA',
  '#21BCA5',
  '#FC8702',
  '#D94432',
  '#5F4B8B',
  '#FA7268',
  '#E9B213',
  '#88B04B',
] as const

export function avatarColor(seed: number): string {
  return AVATAR_COLORS[Math.abs(seed) % AVATAR_COLORS.length]
}

export function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  // Names like "NQ…AB3F" should show the distinctive tail, not "N".
  if (/^NQ…/.test(trimmed)) return trimmed.slice(-2)
  const words = trimmed.split(/\s+/).filter(Boolean)
  // One name, one letter. "AL" for Alice reads like a stock ticker.
  if (words.length === 1) return [...words[0]][0].toUpperCase()
  return ([...words[0]][0] + [...words[words.length - 1]][0]).toUpperCase()
}

/** "you", or their name. Used everywhere, so it lives here. */
export function nameFor(
  address: string,
  members: Array<{ address: string; displayName: string }>,
  selfAddress?: string,
): string {
  if (selfAddress && address === selfAddress) return 'you'
  const member = members.find((m) => m.address === address)
  return member?.displayName ?? shortAddress(address)
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`)
}

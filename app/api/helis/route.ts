import { NextResponse } from 'next/server'

// adsb.lol doesn't send CORS headers, so the browser can't call it directly -
// this proxy fetches server-side instead. Any upstream failure just returns
// empty lists so the heli layer degrades quietly.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const lat = parseFloat(searchParams.get('lat') || '')
  const lng = parseFloat(searchParams.get('lng') || '')

  const timeout = AbortSignal.timeout(9000)
  const headers = { 'User-Agent': 'gps-map-nav-app (github.com/j4791851-design/mapproject)' }

  const [point, mil] = await Promise.all([
    isNaN(lat) || isNaN(lng)
      ? null
      : fetch(`https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lng.toFixed(4)}/250`, {
          headers, signal: timeout, cache: 'no-store',
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch('https://api.adsb.lol/v2/mil', { headers, signal: timeout, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ])

  return NextResponse.json({ point: point?.ac ?? [], mil: mil?.ac ?? [] })
}

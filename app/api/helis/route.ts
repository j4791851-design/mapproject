import { NextResponse } from 'next/server'

const distKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180
  const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// adsb.lol doesn't send CORS headers, so the browser can't call it directly -
// this proxy fetches server-side instead. The /mil feed is GLOBAL (huge), so we
// trim it to aircraft within 1000km before it reaches the phone. Any upstream
// failure returns empty lists so the heli layer degrades quietly.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const lat = parseFloat(searchParams.get('lat') || '')
  const lng = parseFloat(searchParams.get('lng') || '')
  const haveLoc = !isNaN(lat) && !isNaN(lng)

  const timeout = AbortSignal.timeout(9000)
  const headers = { 'User-Agent': 'gps-map-nav-app (github.com/j4791851-design/mapproject)' }

  const [point, mil] = await Promise.all([
    haveLoc
      ? fetch(`https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lng.toFixed(4)}/150`, {
          headers, signal: timeout, cache: 'no-store',
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      : null,
    fetch('https://api.adsb.lol/v2/mil', { headers, signal: timeout, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ])

  const milNear = haveLoc
    ? (mil?.ac ?? []).filter((a: any) => a.lat != null && a.lon != null && distKm(lat, lng, a.lat, a.lon) <= 1000)
    : []

  return NextResponse.json({ point: point?.ac ?? [], mil: milNear })
}

import { NextResponse } from 'next/server'

// Unofficial Waze Live Map feed proxy. If Waze changes/blocks this endpoint,
// we return an empty list so only the Waze layer disappears - nothing else breaks.

export async function GET(request: Request) {
  const empty = () => NextResponse.json({ alerts: [] })
  try {
    const { searchParams } = new URL(request.url)
    const lat = parseFloat(searchParams.get('lat') || '')
    const lng = parseFloat(searchParams.get('lng') || '')
    if (!isFinite(lat) || !isFinite(lng)) return empty()

    // ~0.6 degree pad covers the GTA from the user's position
    const pad = 0.6
    const url =
      `https://www.waze.com/live-map/api/georss` +
      `?top=${lat + pad}&bottom=${lat - pad}&left=${lng - pad}&right=${lng + pad}` +
      `&env=na&types=alerts`

    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Referer: 'https://www.waze.com/live-map',
      },
    })
    if (!res.ok) return empty()

    const data = await res.json()
    const alerts = (data?.alerts || [])
      .filter((a: any) => a?.location && (a.type === 'POLICE' || String(a.subtype || '').includes('POLICE')))
      .map((a: any) => ({
        id: a.id || `${a.location.x},${a.location.y}`,
        lng: a.location.x,
        lat: a.location.y,
        type: a.subtype || a.type || 'POLICE',
        street: a.street || '',
        city: a.city || '',
        ts: a.pubMillis || 0,
        thumbs: a.nThumbsUp ?? 0,
        reliability: a.reliability ?? null,
      }))
      .filter((a: any) => isFinite(a.lng) && isFinite(a.lat))

    return NextResponse.json({ alerts }, { headers: { 'Cache-Control': 'public, s-maxage=60' } })
  } catch {
    return empty()
  }
}

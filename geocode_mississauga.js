const fs = require('fs')

const lines = fs.readFileSync('mississauga_cams.txt', 'utf8').split('\n')
  .map((l) => l.trim())
  .filter((l) => l.includes('@'))

// Mississauga bounding box (viewbox: left,top,right,bottom)
const inBox = ([lng, lat]) => lng > -79.83 && lng < -79.53 && lat > 43.49 && lat < 43.75

const geocode = async (q, bounded = true) => {
  const vb = bounded ? '&bounded=1&viewbox=-79.83,43.75,-79.53,43.49' : ''
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1${vb}`
  const r = await fetch(url, { headers: { 'User-Agent': 'gps-map-personal-project/1.0' } })
  if (!r.ok) return null
  const d = await r.json()
  return d[0] ? { lng: parseFloat(d[0].lon), lat: parseFloat(d[0].lat) } : null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const results = []
  const failed = []
  for (const raw of lines) {
    const name = raw.replace(/\s+/g, ' ')
    // "X @ Y" -> "X & Y" for Nominatim intersection geocoding
    const cleaned = name.replace(/\s*@\s*/, ' & ').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()
    // take only first two streets when extras like "/ Foo" exist
    const core = cleaned.split('/')[0].replace(/\s*-\s*(South|North|East|West) Terminal.*$/i, '').trim()

    let f = await geocode(`${core}, Mississauga, Ontario`)
    if (!f || !inBox([f.lng, f.lat])) {
      await sleep(1100)
      f = await geocode(`${core}, Mississauga`, false)
    }
    if (f && inBox([f.lng, f.lat])) {
      results.push([f.lng, f.lat, name])
      console.log(`OK  ${name} -> ${f.lng},${f.lat}`)
    } else {
      failed.push(name)
      console.log(`MISS ${name}`)
    }
    await sleep(1100)
  }

  console.log(`\n${results.length} geocoded, ${failed.length} failed`)
  if (failed.length) console.log('FAILED:', failed.join(' | '))

  const src = fs.readFileSync('app/components/cameras.ts', 'utf8')
  const insert = results.map(([lng, lat, name]) => `[${lng},${lat},"${name.replace(/"/g, "'")} (Mississauga)"]`).join(',')
  const out = src.replace(/\]\s*;?\s*$/, `,${insert}]`)
  fs.writeFileSync('app/components/cameras.ts', out)
  console.log('cameras.ts updated')
})()

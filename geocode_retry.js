const fs = require('fs')
const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

const src = fs.readFileSync('app/components/cameras.ts', 'utf8')
const existing = eval(src.slice(src.indexOf('= [') + 2))
const haveNames = new Set(existing.map((c) => c[2]))

const lines = fs.readFileSync('mississauga_cams.txt', 'utf8').split('\n')
  .map((l) => l.trim())
  .filter((l) => l.includes('@'))

const inBox = ([lng, lat]) => lng > -79.83 && lng < -79.53 && lat > 43.49 && lat < 43.75
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const nomi = async (q) => {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`, {
    headers: { 'User-Agent': 'gps-map-personal-project/1.0' },
  })
  if (!r.ok) return null
  const d = await r.json()
  return d[0] ? [parseFloat(d[0].lon), parseFloat(d[0].lat)] : null
}

const mapbox = async (q) => {
  const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${TOKEN}&limit=1&country=ca&bbox=-79.83,43.49,-79.53,43.75`)
  if (!r.ok) return null
  const d = await r.json()
  return d.features?.[0]?.center ?? null
}

;(async () => {
  const toRetry = lines.filter((l) => !haveNames.has(l.replace(/\s+/g, ' ')))
  console.log(`${toRetry.length} to retry`)

  const results = []
  const stillFailed = []

  for (const raw of toRetry) {
    const name = raw.replace(/\s+/g, ' ')
    // split into the two street names
    const parts = name.split('@').map((s) => s.trim())
    const a = parts[0]
    const b = (parts[1] || '').split('/')[0].replace(/\(.*?\)/g, '').replace(/\s*-\s*(South|North|East|West) Terminal.*$/i, '').trim()
    const bFull = parts[1] || ''

    const tries = [
      () => nomi(`${b} at ${a}, Mississauga, Ontario`),
      () => nomi(`${a} at ${b}, Mississauga, Ontario`),
      () => nomi(`${b}, Mississauga`),
      () => mapbox(`${a} and ${b}, Mississauga, Ontario`),
      () => mapbox(`${a} at ${b}, Mississauga`),
      () => mapbox(`${b} and ${a}, Mississauga`),
    ]

    let found = null
    for (const t of tries) {
      const r = await t()
      if (r && inBox(r)) { found = r; break }
      await sleep(1100)
    }
    if (found) {
      results.push([found[0], found[1], name])
      console.log(`OK  ${name} -> ${found}`)
    } else {
      stillFailed.push(name)
      console.log(`MISS ${name}`)
    }
    await sleep(1100)
  }

  console.log(`\n${results.length} more geocoded, ${stillFailed.length} still failed`)
  if (results.length) {
    const insert = results.map(([lng, lat, name]) => `[${lng},${lat},"${name.replace(/"/g, "'")} (Mississauga)"]`).join(',')
    fs.writeFileSync('app/components/cameras.ts', src.replace(/\]\s*;?\s*$/, `,${insert}]`))
    console.log('cameras.ts updated')
  }
  if (stillFailed.length) fs.writeFileSync('miss_failed.txt', stillFailed.join('\n'))
})()

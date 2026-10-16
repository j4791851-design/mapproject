const fs = require('fs')

// Mississauga + surroundings bbox (S,W,N,E)
const BBOX = '43.48,-79.85,43.78,-79.51'
const inBox = ([lng, lat]) => lng > -79.85 && lng < -79.51 && lat > 43.48 && lat < 43.78

async function fetchOverpass() {
  if (fs.existsSync('mississauga_ways.json')) return JSON.parse(fs.readFileSync('mississauga_ways.json', 'utf8'))
  const q = `[out:json][timeout:120];way["highway"]["name"](${BBOX});(._;>;);out;`
  console.log('fetching overpass...')
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'gps-map-personal/1.0' },
    body: 'data=' + encodeURIComponent(q),
  })
  if (!r.ok) throw new Error('overpass ' + r.status)
  const d = await r.json()
  fs.writeFileSync('mississauga_ways.json', JSON.stringify(d))
  return d
}

const ABBR = {
  rd: 'road', st: 'street', ave: 'avenue', av: 'avenue', blvd: 'boulevard', dr: 'drive',
  pkwy: 'parkway', pky: 'parkway', cres: 'crescent', ct: 'court', cir: 'circle',
  hwy: 'highway', n: 'north', s: 'south', e: 'east', w: 'west', twn: 'towne',
  sq: 'square', trl: 'trail', pl: 'place', ln: 'lane', terr: 'terrace',
}
const ALIAS = {
  'queen elizabeth way': ['queen elizabeth way'],
  'highway 403': ['highway 403'],
  'sherwood twn boulevard': ['sherwoodtowne boulevard'],
  'sherwood twn blvd': ['sherwoodtowne boulevard'],
  'eastgatepkwy': ['eastgate parkway'],
  'the collegeway': ['the collegeway', 'the collegeway south'],
  'credit woodlands': ['the credit woodlands'],
  'matheson boulevard e': ['matheson boulevard east', 'matheson boulevard'],
  'matheson blvd': ['matheson boulevard east', 'matheson boulevard', 'matheson boulevard west'],
  'harkiss road': ['harkiss road', 'harkness road'],
  'bloor road': ['bloor street', 'bloor street east'],
  'cawthra south term': ['cawthra road'],
  'eglinton road': ['eglinton avenue east', 'eglinton avenue west', 'eglinton avenue'],
  'its pole west of vega': ['vega boulevard', 'vega'],
  'station road': ['station road', 'station gate road'],
  'eglinton avenue w': ['eglinton avenue west'],
  'rathburn road east': ['rathburn road east', 'rathburn road west'],
}

function sideAlts(s) {
  // strip trailing descriptors that aren't street names
  s = s.replace(/-\s*(south|north|east|west)\s*terminal.*$/i, '').trim()
  if (/^qew\b/i.test(s)) s = 'Queen Elizabeth Way'
  if (/^highway 403\b/i.test(s)) s = 'Highway 403'
  return s.split('/').flatMap((x) => {
    x = x.trim()
    if (/^(go station|west go access|condo|transit terminal|iceland arena|white oak ford|private access)/i.test(x)) return []
    return variants(x)
  })
}

function normalize(s) {
  let t = s.replace(/([a-z])(Pkwy|Blvd|Ave|Rd|Dr|St)\b/g, '$1 $2') // EastgatePkwy -> Eastgate Pkwy
  t = t.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[.,']/g, ' ')
  const toks = t.split(/\s+/).filter(Boolean).map((tok) => ABBR[tok] || tok)
  return toks.join(' ').replace(/\s+/g, ' ').trim()
}

function variants(s) {
  const n = normalize(s)
  const out = [n]
  if (ALIAS[n]) out.push(...ALIAS[n])
  return out
}

;(async () => {
  const data = await fetchOverpass()
  const nodes = {}
  const nodeNames = {} // nodeId -> Set(normalized names)
  for (const el of data.elements) {
    if (el.type === 'node') nodes[el.id] = [el.lon, el.lat]
  }
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.tags?.name || !el.nodes) continue
    const n = normalize(el.tags.name)
    for (const id of el.nodes) {
      if (!nodeNames[id]) nodeNames[id] = new Set()
      nodeNames[id].add(n)
    }
  }

  // name match: exact, or query is prefix of way name (handles "Britannia Road" vs "Britannia Road East")
  const match = (nameSet, queries) =>
    queries.some((q) => [...nameSet].some((w) => w === q || w.startsWith(q + ' ') || q.startsWith(w + ' ')))

  const lines = fs.readFileSync('mississauga_cams.txt', 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l.includes('@'))

  const resolved = []
  const unresolved = []

  for (const raw of lines) {
    const name = raw.replace(/\s+/g, ' ')
    const [aRaw, bRaw = ''] = name.split('@')
    // each side can have slash-separated alternative names
    const aAlts = sideAlts(aRaw)
    const bAlts = sideAlts(bRaw)

    const aNodes = new Set(), bNodes = new Set()
    for (const [id, set] of Object.entries(nodeNames)) {
      if (match(set, aAlts)) aNodes.add(id)
      if (match(set, bAlts)) bNodes.add(id)
    }

    // shared nodes = exact intersections
    const shared = [...aNodes].filter((id) => bNodes.has(id) && inBox(nodes[id]))
    if (shared.length) {
      resolved.push([name, nodes[shared[0]]])
      continue
    }
    // fallback: nearest pair within 120m (grade-separated / ramp junctions)
    let best = null, bestD = Infinity
    const av = [...aNodes].filter((id) => inBox(nodes[id]))
    const bv = [...bNodes].filter((id) => inBox(nodes[id]))
    for (const id of av) {
      for (const jd of bv) {
        const dx = (nodes[id][0] - nodes[jd][0]) * Math.cos(nodes[id][1] * Math.PI / 180) * 111320
        const dy = (nodes[id][1] - nodes[jd][1]) * 111320
        const d = Math.hypot(dx, dy)
        if (d < bestD) { bestD = d; best = nodes[jd] }
      }
    }
    if (best && bestD < 120) {
      resolved.push([name, best])
      continue
    }
    unresolved.push(name)
  }

  // POI-based fallback for non-street sides: geocode a known place, snap to nearest node of the named street
  const SPECIAL = {
    'Hillcrest @ West GO Access': { q: 'Cooksville GO Station, Mississauga', snap: 'hillcrest avenue' },
    'Southdown Rd @ GO Station/Condo': { q: 'Clarkson GO Station', snap: 'southdown road' },
    'Mavis Road @ White Oak Ford Access': { q: 'Whiteoak Ford Lincoln, Mississauga', snap: 'mavis road' },
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  for (const name of [...unresolved]) {
    const spec = SPECIAL[name]
    if (!spec) continue
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(spec.q)}&format=json&limit=1`, {
      headers: { 'User-Agent': 'gps-map-personal/1.0' },
    })
    const d = await r.json()
    if (d[0]) {
      const pt = [parseFloat(d[0].lon), parseFloat(d[0].lat)]
      let best = null, bestD = Infinity
      for (const [id, set] of Object.entries(nodeNames)) {
        if (!match(set, [spec.snap])) continue
        const n = nodes[id]
        const dx = (n[0] - pt[0]) * 111320 * Math.cos(n[1] * Math.PI / 180)
        const dy = (n[1] - pt[1]) * 111320
        const dd = Math.hypot(dx, dy)
        if (dd < bestD) { bestD = dd; best = n }
      }
      if (best && bestD < 400) {
        resolved.push([name, best])
        unresolved.splice(unresolved.indexOf(name), 1)
        console.log(`POI ${name} -> ${best} (${bestD.toFixed(0)}m snap)`)
      }
    }
    await sleep(1100)
  }

  console.log(`\nresolved ${resolved.length}, unresolved ${unresolved.length}`)
  for (const u of unresolved) console.log('UNRESOLVED: ' + u)
  fs.writeFileSync('mississauga_resolved.json', JSON.stringify(resolved))
  fs.writeFileSync('mississauga_unresolved.txt', unresolved.join('\n'))
})()

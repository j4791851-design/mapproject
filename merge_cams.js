const fs = require('fs')

const src = fs.readFileSync('app/components/cameras.ts', 'utf8')
const toronto = src.slice(0, src.indexOf('= [') + 3)
// strip any existing (Mississauga) entries
const arr = eval(src.slice(src.indexOf('= [') + 2).replace(/;?\s*$/, ''))
const kept = arr.filter((c) => !c[2].endsWith('(Mississauga)'))
console.log('kept toronto/base:', kept.length)

const resolved = JSON.parse(fs.readFileSync('mississauga_resolved.json', 'utf8'))
const seen = new Set()
const out = []
for (const [name, [lng, lat]] of resolved) {
  const key = `${lng.toFixed(4)},${lat.toFixed(4)}`
  if (seen.has(key)) continue
  seen.add(key)
  out.push(`[${lng},${lat},"${name.replace(/"/g, "'")} (Mississauga)"]`)
}
console.log('mississauga:', out.length)

fs.writeFileSync('app/components/cameras.ts', `${toronto}${kept.map((c) => JSON.stringify(c)).join(',')},${out.join(',')}]`)
console.log('written')

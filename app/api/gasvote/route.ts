import { NextResponse } from 'next/server'
import { sql, ensureDb } from '../../lib/db'
import { sessionFromRequest } from '../../lib/auth'

let tableReady = false
async function ensureTable() {
  if (!sql) throw new Error('db not configured')
  if (tableReady) return
  await ensureDb()
  await sql`
    CREATE TABLE IF NOT EXISTS gas_votes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      station_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('pump', 'prepay')),
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, station_key)
    )
  `
  tableReady = true
}

// Aggregated votes: each station's label = whichever kind has more votes
export async function GET() {
  try {
    if (!sql) return NextResponse.json({ votes: {} })
    await ensureTable()
    const rows = await sql`
      SELECT station_key, kind, count(*) AS n
      FROM gas_votes GROUP BY station_key, kind
    `
    const acc: Record<string, { pump: number; prepay: number }> = {}
    for (const r of rows) {
      const a = (acc[r.station_key] ??= { pump: 0, prepay: 0 })
      a[r.kind as 'pump' | 'prepay'] = Number(r.n)
    }
    const votes: Record<string, string> = {}
    for (const [k, v] of Object.entries(acc)) {
      if (v.pump !== v.prepay) votes[k] = v.pump > v.prepay ? 'pump' : 'prepay'
    }
    return NextResponse.json({ votes })
  } catch {
    return NextResponse.json({ votes: {} })
  }
}

export async function POST(req: Request) {
  try {
    const userId = sessionFromRequest(req)
    if (!userId) return NextResponse.json({ error: 'not logged in' }, { status: 401 })
    if (!sql) return NextResponse.json({ error: 'db not configured' }, { status: 500 })
    const { key, kind } = await req.json()
    if (typeof key !== 'string' || !/^-?\d+\.\d+,-?\d+\.\d+$/.test(key)) {
      return NextResponse.json({ error: 'bad key' }, { status: 400 })
    }
    if (kind !== 'pump' && kind !== 'prepay') {
      return NextResponse.json({ error: 'bad kind' }, { status: 400 })
    }
    await ensureTable()
    await sql`
      INSERT INTO gas_votes (user_id, station_key, kind) VALUES (${userId}, ${key}, ${kind})
      ON CONFLICT (user_id, station_key) DO UPDATE SET kind = ${kind}, created_at = now()
    `
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

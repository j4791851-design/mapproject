import { sql, ensureDb } from '@/app/lib/db'
import { sessionFromRequest } from '@/app/lib/auth'

// List the signed-in user's saved routes
export async function GET(req: Request) {
  const userId = sessionFromRequest(req)
  if (!userId) return Response.json({ routes: [] }, { status: 401 })
  try {
    await ensureDb()
    const rows = await sql!`
      SELECT id, name, dest_name, dest_lng, dest_lat, waypoints,
             avoid_tolls, avoid_highways, avoid_cams, created_at
      FROM saved_routes
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `
    return Response.json({ routes: rows })
  } catch (e) {
    console.error('routes GET error:', e)
    return Response.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

// Save a route for the signed-in user
export async function POST(req: Request) {
  const userId = sessionFromRequest(req)
  if (!userId) return Response.json({ error: 'Not signed in' }, { status: 401 })
  try {
    const { name, destName, destLng, destLat, waypoints, avoidTolls, avoidHighways, avoidCams } =
      await req.json()
    if (destLng == null || destLat == null) {
      return Response.json({ error: 'Missing destination' }, { status: 400 })
    }
    await ensureDb()
    const rows = await sql!`
      INSERT INTO saved_routes
        (user_id, name, dest_name, dest_lng, dest_lat, waypoints, avoid_tolls, avoid_highways, avoid_cams)
      VALUES
        (${userId}, ${name || destName || 'Saved route'}, ${destName || ''}, ${destLng}, ${destLat},
         ${JSON.stringify(waypoints || [])}::jsonb, ${!!avoidTolls}, ${!!avoidHighways}, ${!!avoidCams})
      RETURNING id
    `
    return Response.json({ ok: true, id: rows[0].id })
  } catch (e) {
    console.error('routes POST error:', e)
    return Response.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

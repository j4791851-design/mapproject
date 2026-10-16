import { sql, ensureDb } from '@/app/lib/db'
import { sessionFromRequest } from '@/app/lib/auth'

export async function GET(req: Request) {
  const userId = sessionFromRequest(req)
  if (!userId) return Response.json({ user: null }, { status: 401 })

  try {
    await ensureDb()
    const rows = await sql!`SELECT username FROM users WHERE id = ${userId}`
    if (!rows.length) return Response.json({ user: null }, { status: 401 })
    return Response.json({ user: { username: rows[0].username } })
  } catch (e) {
    console.error('me error:', e)
    return Response.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

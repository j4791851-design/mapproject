import { sql, ensureDb } from '@/app/lib/db'
import { sessionFromRequest } from '@/app/lib/auth'

// Delete a saved route (only if it belongs to the signed-in user)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = sessionFromRequest(req)
  if (!userId) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  try {
    await ensureDb()
    await sql!`DELETE FROM saved_routes WHERE id = ${Number(id)} AND user_id = ${userId}`
    return Response.json({ ok: true })
  } catch (e) {
    console.error('routes DELETE error:', e)
    return Response.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

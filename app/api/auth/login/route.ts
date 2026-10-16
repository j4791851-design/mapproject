import { sql, ensureDb } from '@/app/lib/db'
import { verifyPassword, signSession, sessionCookie } from '@/app/lib/auth'

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json()
    if (!username || !password) {
      return Response.json({ error: 'Enter your username and password' }, { status: 400 })
    }

    await ensureDb()
    const rows = await sql!`
      SELECT id, username, pass_hash FROM users WHERE username = ${username.toLowerCase()}
    `

    if (!rows.length || !verifyPassword(password, rows[0].pass_hash)) {
      return Response.json({ error: 'Wrong username or password' }, { status: 401 })
    }

    const res = Response.json({ ok: true, username: rows[0].username })
    res.headers.append('Set-Cookie', sessionCookie(signSession(rows[0].id)))
    return res
  } catch (e) {
    console.error('login error:', e)
    return Response.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

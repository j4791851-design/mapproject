import { sql, ensureDb } from '@/app/lib/db'
import { hashPassword, signSession, sessionCookie } from '@/app/lib/auth'

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json()

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) {
      return Response.json(
        { error: 'Username must be 3-20 characters: letters, numbers, underscore' },
        { status: 400 }
      )
    }
    if (!password || password.length < 6) {
      return Response.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    await ensureDb()
    const rows = await sql!`
      INSERT INTO users (username, pass_hash)
      VALUES (${username.toLowerCase()}, ${hashPassword(password)})
      RETURNING id, username
    `

    const res = Response.json({ ok: true, username: rows[0].username })
    res.headers.append('Set-Cookie', sessionCookie(signSession(rows[0].id)))
    return res
  } catch (e: any) {
    if (e.code === '23505') {
      return Response.json({ error: 'That username is taken' }, { status: 409 })
    }
    console.error('register error:', e)
    return Response.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

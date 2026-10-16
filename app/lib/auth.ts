import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto'

const SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me'

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

// Stateless session: "userId.hmac" - no session table needed
export function signSession(userId: number) {
  const sig = createHmac('sha256', SECRET).update(String(userId)).digest('hex')
  return `${userId}.${sig}`
}

export function verifySession(token: string | undefined): number | null {
  if (!token) return null
  const [id, sig] = token.split('.')
  if (!id || !sig) return null
  const expected = createHmac('sha256', SECRET).update(String(id)).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? Number(id) : null
  } catch {
    return null
  }
}

export function sessionCookie(token: string, maxAge = 60 * 60 * 24 * 30) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export function clearSessionCookie() {
  return 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
}

export function sessionFromRequest(req: Request) {
  const cookie = req.headers.get('cookie') || ''
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/)
  return verifySession(match?.[1])
}

import postgres from 'postgres'

// POSTGRES_URL is provided by Vercel Postgres (or any Postgres connection string)
const url = process.env.POSTGRES_URL || ''
// prepare:false required for Supabase transaction pooler (PgBouncer compat)
export const sql = url ? postgres(url, { ssl: 'require', prepare: false }) : null

let initialized = false

// Lazily create the users table on first use
export async function ensureDb() {
  if (!sql) throw new Error('Database not configured - POSTGRES_URL is missing')
  if (initialized) return
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS saved_routes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      dest_name TEXT,
      dest_lng DOUBLE PRECISION NOT NULL,
      dest_lat DOUBLE PRECISION NOT NULL,
      waypoints JSONB DEFAULT '[]',
      avoid_tolls BOOLEAN DEFAULT false,
      avoid_highways BOOLEAN DEFAULT false,
      avoid_cams BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `
  initialized = true
}

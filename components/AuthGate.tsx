'use client'

import { useState, useEffect } from 'react'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'out' | 'in'>('loading')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => setStatus(r.ok ? 'in' : 'out'))
      .catch(() => setStatus('out'))
  }, [])

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (res.ok) setStatus('in')
      else setError(data.error || 'Something went wrong')
    } catch {
      setError('Network error - try again')
    }
    setBusy(false)
  }

  if (status === 'loading') {
    return (
      <div className="w-full h-dvh flex items-center justify-center bg-gray-100">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'out') {
    return (
      <div className="w-full h-dvh flex items-center justify-center bg-gray-100 px-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-sm">
          <h1 className="text-2xl font-bold text-black text-center">GPS Map</h1>
          <p className="text-sm text-gray-500 text-center mt-1 mb-6">
            Sign in or create an account to continue
          </p>

          {/* Login / Register tabs */}
          <div className="flex bg-gray-100 rounded-full p-1 mb-5">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError('') }}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${
                  mode === m ? 'bg-white shadow text-black' : 'text-gray-500'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Register'}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-black mb-3 focus:outline-none focus:border-blue-500"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={mode === 'register' ? 'Password (min 6 characters)' : 'Password'}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-black mb-4 focus:outline-none focus:border-blue-500"
          />

          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50"
          >
            {busy ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

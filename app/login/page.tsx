'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

const OWNER_EMAIL = 'ouchinmustapha82@gmail.com'

export default function LoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const result = await authClient.signIn.email({ email: OWNER_EMAIL, password })
    setBusy(false)
    if (result.error) setError('Unable to authenticate. Check your password and try again.')
    else { router.push('/'); router.refresh() }
  }

  return <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground"><section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"><p className="font-mono text-xs font-medium uppercase tracking-[0.22em] text-primary">Manifest / secure access</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">Welcome back</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Sign in to manage the shared manifest. Your session stays active for 24 hours.</p><form onSubmit={submit} className="mt-6 flex flex-col gap-4"><label className="flex flex-col gap-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Authorized email</span><input readOnly value={OWNER_EMAIL} type="email" className="h-12 rounded-xl border border-input bg-muted px-3 text-sm text-muted-foreground outline-none" /></label><label className="flex flex-col gap-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password</span><input required minLength={8} autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>{error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}<button disabled={busy} className="h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? 'Please wait…' : 'Log in'}</button></form></section></main>
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, Map, Menu, X, Plane, CircleHelp, Clock3 } from 'lucide-react'
import { useState } from 'react'

export default function DashboardShell({ children, userName }: { children: React.ReactNode; userName?: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const links = [{ href: '/', label: 'Bookings', icon: CalendarDays }, { href: '/map', label: 'Manual groups', icon: Map }, { href: '/time-groups', label: 'Pickup times', icon: Clock3 }]
  return <div className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:px-8">
      <div className="flex items-center gap-3"><button type="button" aria-label="Open navigation" onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-muted md:hidden"><Menu className="size-5" /></button><div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Plane className="size-4" /></div><div><p className="text-sm font-semibold tracking-tight">Travel operations</p><p className="hidden text-xs text-muted-foreground sm:block">Pickup manifest workspace</p></div></div>
      <div className="flex items-center gap-3"><div className="hidden items-center gap-2 text-sm md:flex"><CircleHelp className="size-4 text-muted-foreground" />Help</div><div className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">{(userName || 'O').slice(0, 1).toUpperCase()}</div></div>
    </header>
    <div className="flex min-h-[calc(100vh-4rem)]">
      {open && <button aria-label="Close navigation overlay" className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card p-5 transition-transform md:sticky md:top-16 md:z-30 md:h-[calc(100vh-4rem)] md:w-64 md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-8 flex items-center justify-between md:hidden"><span className="font-semibold">Navigation</span><button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-muted"><X className="size-5" /></button></div>
        <div className="mb-8 hidden md:block"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Workspace</p><p className="mt-2 text-sm text-muted-foreground">Manage pickup movements</p></div>
        <nav className="grid gap-2" aria-label="Main navigation">{links.map(({ href, label, icon: Icon }) => { const active = pathname === href; return <Link key={href} href={href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="size-4" />{label}</Link> })}</nav>
        <div className="mt-auto rounded-2xl border border-border bg-background p-4"><p className="text-xs font-semibold">Operations tip</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Use Manual groups to build pickup teams visually on the map.</p></div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  </div>
}

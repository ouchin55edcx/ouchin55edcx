'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import Link from 'next/link'

mapboxgl.accessToken = 'pk.eyJ1Ijoib3VjaGluNTVlZGN4IiwiYSI6ImNtaXJ1MzVrNDA2Y2ozY3NhOXoxcng3NnEifQ.6yBtRfXRlgQ8vlmsYrRS2w'
type Booking = { id: string; pax: number; pickup: string; travel_date?: string }
type Group = { key: string; lng: number; lat: number; pax: number; ids: string[]; count: number }

function coordinates(rawUrl: string) {
  const url = decodeURIComponent(rawUrl.trim())
  const ordered = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (ordered) return { lat: Number(ordered[1]), lng: Number(ordered[2]) }
  const pair = url.match(/(?:@|q=|query=|ll=|place\/)(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i)
  if (pair) {
    const lat = Number(pair[1]); const lng = Number(pair[2])
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
  }
  const fallback = url.match(/(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/)
  if (fallback) {
    const first = Number(fallback[1]); const second = Number(fallback[2])
    if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return { lat: first, lng: second }
  }
  return null
}

export default function MapClient() {
  const mapRef = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/bookings?date=${date}`).then(r => r.json()).then(data => setBookings(data.bookings || [])).finally(() => setLoading(false))
  }, [date])

  const groups = useMemo<Group[]>(() => {
    const grouped = new Map<string, Group>()
    bookings.forEach(booking => {
      const point = coordinates(booking.pickup)
      if (!point) return
      const key = `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`
      const current = grouped.get(key)
      if (current) { current.pax += booking.pax; current.ids.push(booking.id); current.count += 1 }
      else grouped.set(key, { key, ...point, pax: booking.pax, ids: [booking.id], count: 1 })
    })
    return [...grouped.values()]
  }, [bookings])

  useEffect(() => {
    if (!mapRef.current || map.current) return
    map.current = new mapboxgl.Map({ container: mapRef.current, style: 'mapbox://styles/mapbox/dark-v11', center: [2.35, 48.86], zoom: 5 })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
    return () => { map.current?.remove(); map.current = null }
  }, [])

  useEffect(() => {
    if (!map.current) return
    const markers: mapboxgl.Marker[] = []
    groups.forEach(group => {
      const intensity = group.pax >= 20 ? '#ef4444' : group.pax >= 10 ? '#f59e0b' : '#22c55e'
      const el = document.createElement('button'); el.type = 'button'; el.setAttribute('aria-label', `${group.pax} passengers, ${group.count} bookings`)
      el.style.cssText = `width:${Math.min(48, 22 + group.pax)}px;height:${Math.min(48, 22 + group.pax)}px;border-radius:999px;background:${intensity};border:3px solid rgba(255,255,255,.85);box-shadow:0 3px 12px rgba(0,0,0,.35);color:#111;font-weight:800;cursor:pointer`
      el.textContent = String(group.pax)
      const popup = new mapboxgl.Popup({ offset: 22, closeButton: true }).setHTML(`<div style="color:#111;min-width:120px"><strong>${group.pax} pax</strong><br/><span style="font-size:11px">${group.ids.join(', ')}</span></div>`)
      markers.push(new mapboxgl.Marker(el).setLngLat([group.lng, group.lat]).setPopup(popup).addTo(map.current!))
    })
    if (groups.length) map.current.fitBounds(groups.reduce((bounds, group) => bounds.extend([group.lng, group.lat]), new mapboxgl.LngLatBounds()), { padding: 80, maxZoom: 13 })
    return () => markers.forEach(marker => marker.remove())
  }, [groups])

  const pax = bookings.reduce((sum, booking) => sum + booking.pax, 0)
  return <main className="flex min-h-screen bg-background text-foreground"><aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card p-5"><div className="mb-8 text-lg font-bold">Trip operations</div><nav className="grid gap-2" aria-label="Main navigation"><Link href="/" className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">Bookings</Link><Link href="/map" className="rounded-xl bg-primary/15 px-3 py-2 text-sm font-semibold text-primary">Map overview</Link></nav></aside><section className="flex min-w-0 flex-1 flex-col"><header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Location board</p><h1 className="mt-1 text-2xl font-bold">Pickup map</h1></div><input aria-label="Travel date" type="date" value={date} onChange={e => { setLoading(true); setDate(e.target.value) }} className="rounded-xl border border-input bg-background px-3 py-2 text-sm" /></header><div className="grid gap-3 border-b border-border px-6 py-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Bookings</p><strong className="text-xl">{bookings.length}</strong></div><div><p className="text-xs text-muted-foreground">Passengers</p><strong className="text-xl">{pax}</strong></div><div><p className="text-xs text-muted-foreground">Pickup groups</p><strong className="text-xl">{groups.length}</strong></div></div><div className="relative min-h-[520px] flex-1"><div ref={mapRef} className="absolute inset-0" />{!loading && !groups.length && <div className="absolute left-1/2 top-1/2 max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card/95 p-6 text-center shadow-xl"><h2 className="font-semibold">No mapped pickup groups</h2><p className="mt-2 text-sm text-muted-foreground">Bookings without coordinates cannot appear on the map. Add Google Maps pickup URLs from the bookings page.</p></div>}</div><div className="flex flex-wrap gap-4 border-t border-border px-6 py-3 text-xs text-muted-foreground"><span><i className="mr-1 inline-block size-2 rounded-full bg-green-500" />Under 10 pax</span><span><i className="mr-1 inline-block size-2 rounded-full bg-amber-500" />10–19 pax</span><span><i className="mr-1 inline-block size-2 rounded-full bg-red-500" />20+ pax</span><span className="ml-auto">Popup: pax total + booking IDs</span></div></section></main>
}

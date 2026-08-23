import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

async function authorized() { return Boolean((await auth.api.getSession({ headers: await headers() }))?.user) }
async function group(date: string) {
  const result = await db.execute(sql`INSERT INTO travel_groups (travel_date) VALUES (${date}::date) ON CONFLICT (travel_date) DO UPDATE SET travel_date = EXCLUDED.travel_date RETURNING id, travel_date`)
  return result.rows[0] as { id: number; travel_date: string }
}
export async function GET(request: Request) {
  if (!await authorized()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const date = params.get('date') || new Date().toISOString().slice(0, 10)
  const collectionId = params.get('collectionId')
  if (collectionId) {
    const result = await db.execute(sql`SELECT booking_id AS id, traveler, phone, email, pax, pickup FROM collection_bookings WHERE collection_id = ${Number(collectionId)} ORDER BY created_at ASC`)
    return NextResponse.json({ collectionBookings: result.rows })
  }
  const g = await group(date)
  const [global, collections, blacklist] = await Promise.all([
    db.execute(sql`SELECT booking_id AS id, traveler, phone, email, pax, pickup, travel_date FROM bookings WHERE travel_date = ${date}::date ORDER BY created_at ASC`),
    db.execute(sql`SELECT c.id, c.name, c.created_at, COUNT(cb.id)::int AS count FROM booking_collections c LEFT JOIN collection_bookings cb ON cb.collection_id = c.id WHERE c.group_id = ${g.id} GROUP BY c.id ORDER BY c.created_at DESC`),
    db.execute(sql`SELECT booking_id FROM booking_blacklist ORDER BY created_at ASC`),
  ])
  return NextResponse.json({ group: g, bookings: global.rows, collections: collections.rows, blacklist: blacklist.rows.map((r) => r.booking_id) })
}
export async function POST(request: Request) {
  if (!await authorized()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json(); const date = String(body.date).trim(); const booking = { id: String(body.id).trim(), traveler: String(body.traveler).trim(), phone: String(body.phone).trim(), email: String(body.email || '').trim() || null, pax: Number(body.pax), pickup: String(body.pickup).trim() }
  if (!date || !booking.id || !booking.traveler || !booking.phone || (booking.email && !/^\S+@\S+\.\S+$/.test(booking.email)) || !Number.isInteger(booking.pax) || booking.pax < 1 || !booking.pickup) return NextResponse.json({ error: 'Invalid booking' }, { status: 400 })
  const g = await group(date)
  if (body.collectionId) {
    const result = await db.execute(sql`INSERT INTO collection_bookings (collection_id, booking_id, traveler, phone, email, pax, pickup) VALUES (${Number(body.collectionId)}, ${booking.id}, ${booking.traveler}, ${booking.phone}, ${booking.email}, ${booking.pax}, ${booking.pickup}) RETURNING booking_id AS id, traveler, phone, email, pax, pickup`)
    return NextResponse.json(result.rows[0], { status: 201 })
  }
  const result = await db.execute(sql`INSERT INTO bookings (booking_id, traveler, phone, email, pax, pickup, travel_date) VALUES (${booking.id}, ${booking.traveler}, ${booking.phone}, ${booking.email}, ${booking.pax}, ${booking.pickup}, ${date}::date) RETURNING booking_id AS id, traveler, phone, email, pax, pickup, travel_date`)
  return NextResponse.json(result.rows[0], { status: 201 })
}
export async function PUT(request: Request) {
  if (!await authorized()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json(); const date = String(body.date || new Date().toISOString().slice(0, 10)); const g = await group(date)
  if (body.action === 'collection') { const result = await db.execute(sql`INSERT INTO booking_collections (group_id, name) VALUES (${g.id}, ${String(body.name || 'New collection').trim()}) RETURNING id, name, created_at`); return NextResponse.json(result.rows[0], { status: 201 }) }
  if (body.action === 'merge') { await db.execute(sql`INSERT INTO bookings (booking_id, traveler, phone, email, pax, pickup, travel_date) SELECT cb.booking_id, cb.traveler, cb.phone, cb.email, cb.pax, cb.pickup, ${date}::date FROM collection_bookings cb WHERE cb.collection_id = ${Number(body.collectionId)} ON CONFLICT (booking_id) DO NOTHING`); return NextResponse.json({ ok: true }) }
  const id = String(body.id).trim().toLowerCase(); await db.execute(sql`INSERT INTO booking_blacklist (booking_id) VALUES (${id}) ON CONFLICT (booking_id) DO NOTHING`); return NextResponse.json({ id }, { status: 201 })
}
export async function DELETE(request: Request) {
  if (!await authorized()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json(); if (body.collectionId) await db.execute(sql`DELETE FROM collection_bookings WHERE collection_id = ${Number(body.collectionId)}`); else if (body.blacklist) await db.execute(sql`DELETE FROM booking_blacklist WHERE booking_id = ${String(body.id).trim().toLowerCase()}`); else await db.execute(sql`DELETE FROM bookings WHERE booking_id = ${String(body.id).trim()} AND travel_date = ${String(body.date)}::date`)
  return NextResponse.json({ ok: true })
}

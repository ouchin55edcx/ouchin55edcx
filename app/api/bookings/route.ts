import { NextResponse } from 'next/server'
import { db, bookingTable, blacklistTable } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user ? session : null
}

export async function GET() {
  if (!await requireSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const bookings = await db.execute(sql.raw(`SELECT booking_id AS id, traveler, phone, pax, pickup FROM ${bookingTable} ORDER BY created_at ASC`))
  const blacklist = await db.execute(sql.raw(`SELECT booking_id FROM ${blacklistTable} ORDER BY created_at ASC`))
  return NextResponse.json({ bookings: bookings.rows, blacklist: blacklist.rows.map((row) => row.booking_id) })
}

export async function POST(request: Request) {
  if (!await requireSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const booking = { id: String(body.id).trim(), traveler: String(body.traveler).trim(), phone: String(body.phone).trim(), pax: Number(body.pax), pickup: String(body.pickup).trim() }
  if (!booking.id || !booking.traveler || !booking.phone || !Number.isInteger(booking.pax) || booking.pax < 1 || !booking.pickup) return NextResponse.json({ error: 'Invalid booking' }, { status: 400 })
  const result = await db.execute(sql`INSERT INTO bookings (booking_id, traveler, phone, pax, pickup) VALUES (${booking.id}, ${booking.traveler}, ${booking.phone}, ${booking.pax}, ${booking.pickup}) RETURNING booking_id AS id, traveler, phone, pax, pickup`)
  return NextResponse.json(result.rows[0], { status: 201 })
}

export async function DELETE(request: Request) {
  if (!await requireSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, blacklist } = await request.json()
  if (blacklist) await db.execute(sql`DELETE FROM booking_blacklist WHERE booking_id = ${String(id).trim().toLowerCase()}`)
  else await db.execute(sql`DELETE FROM bookings WHERE booking_id = ${String(id).trim()}`)
  return NextResponse.json({ ok: true })
}

export async function PUT(request: Request) {
  if (!await requireSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await request.json()
  const normalized = String(id).trim().toLowerCase()
  if (!normalized) return NextResponse.json({ error: 'Missing ID' }, { status: 400 })
  await db.execute(sql`INSERT INTO booking_blacklist (booking_id) VALUES (${normalized}) ON CONFLICT (booking_id) DO NOTHING`)
  return NextResponse.json({ id: normalized }, { status: 201 })
}

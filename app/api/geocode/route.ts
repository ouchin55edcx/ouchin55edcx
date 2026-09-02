import { NextResponse } from 'next/server'

function extractCoordinates(value: string) {
  const decoded = decodeURIComponent(value)
  const match = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)|@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
  return match ? { lat: Number(match[1] || match[3]), lng: Number(match[2] || match[4]) } : null
}

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get('url')
  if (!url || !/^https?:\/\/(?:www\.)?google\.[^/]+\//i.test(url)) return NextResponse.json({ error: 'Invalid Google Maps URL' }, { status: 400 })
  try {
    const direct = extractCoordinates(url)
    if (direct) return NextResponse.json(direct)
    const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
    const resolved = extractCoordinates(response.url) || extractCoordinates(await response.text())
    return resolved ? NextResponse.json(resolved) : NextResponse.json({ error: 'Coordinates not found' }, { status: 404 })
  } catch {
    return NextResponse.json({ error: 'Unable to resolve location' }, { status: 502 })
  }
}

/**
 * Core pickup-grouping algorithm.
 *
 * Given a list of bookings (each with pax + lat/lng) and a list of buses
 * (each with a fixed seat capacity), assigns every booking to exactly one
 * bus such that:
 *   1. No bus ever exceeds its capacity.
 *   2. Each bus's total pax gets as close to its capacity as possible
 *      (few near-empty buses).
 *   3. Bookings on the same bus are geographically close to each other
 *      (minimizes average intra-group distance, using real haversine km).
 *
 * Pipeline: geographic k-means clustering -> best-fit-decreasing bin-pack
 * per cluster onto buses -> local-search refinement (swap / move single
 * bookings between buses) to fix leftover capacity violations and reduce
 * spread further.
 *
 * No external dependencies. Drop this file into the app and call
 * `generateGroups(bookings, buses)`.
 */

// ---------- Types ----------

export interface Booking {
  id: string;
  leadTraveler: string;
  phone?: string;
  email?: string;
  pax: number;
  lat: number;
  lng: number;
  bookingRef?: string;
  pinnedBusId?: string | null; // if set, this booking should stay on this bus
}

export interface Bus {
  id: string;
  name: string;
  owner?: string;
  capacity: number;
}

export interface BusGroup {
  bus: Bus;
  bookings: Booking[];
  totalPax: number;
  zoneCenter: { lat: number; lng: number };
}

export interface GenerateGroupsResult {
  groups: BusGroup[];
  unassigned: Booking[]; // bookings that could not fit anywhere (fleet too small)
}

// ---------- Distance ----------

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function centroid(points: { lat: number; lng: number }[]) {
  const n = points.length || 1;
  const lat = points.reduce((s, p) => s + p.lat, 0) / n;
  const lng = points.reduce((s, p) => s + p.lng, 0) / n;
  return { lat, lng };
}

// average pairwise distance within a group (lower = tighter geographic group)
function groupSpread(bookings: Booking[]): number {
  if (bookings.length < 2) return 0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < bookings.length; i++) {
    for (let j = i + 1; j < bookings.length; j++) {
      total += haversineKm(bookings[i], bookings[j]);
      count++;
    }
  }
  return total / count;
}

// ---------- Step 1: geographic k-means clustering ----------

function kmeans(
  points: Booking[],
  k: number,
  iterations = 50
): number[] /* cluster index per point */ {
  if (points.length === 0) return [];
  k = Math.max(1, Math.min(k, points.length));

  // deterministic seed: pick k points spread across the data (farthest-point init)
  const centers: { lat: number; lng: number }[] = [];
  centers.push({ lat: points[0].lat, lng: points[0].lng });
  while (centers.length < k) {
    let best = points[0];
    let bestDist = -1;
    for (const p of points) {
      const minDistToCenters = Math.min(
        ...centers.map((c) => haversineKm(p, c))
      );
      if (minDistToCenters > bestDist) {
        bestDist = minDistToCenters;
        best = p;
      }
    }
    centers.push({ lat: best.lat, lng: best.lng });
  }

  let labels = new Array(points.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    // assign
    for (let i = 0; i < points.length; i++) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = haversineKm(points[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (labels[i] !== bestC) changed = true;
      labels[i] = bestC;
    }
    // update
    for (let c = 0; c < centers.length; c++) {
      const members = points.filter((_, i) => labels[i] === c);
      if (members.length > 0) centers[c] = centroid(members);
    }
    if (!changed) break;
  }

  return labels;
}

// ---------- Step 2: capacity bin-packing per cluster ----------
//
// Each cluster claims its own exclusive buses from the shared pool and
// packs tightly into them (best-fit-decreasing). A bus, once claimed by a
// cluster, is never split across an unrelated cluster in this pass — that
// was the source of the "same bus appears 3 times" bug. Any bus with
// leftover room stays claimed by this cluster; unopened buses go back to
// the shared pool for the next cluster.

interface WorkingGroup {
  bus: Bus;
  bookings: Booking[];
}

function usedPax(g: WorkingGroup): number {
  return g.bookings.reduce((s, b) => s + b.pax, 0);
}

function packClusterExclusive(
  clusterBookings: Booking[],
  busPool: Bus[] // shared pool, mutated in place (claimed buses are removed)
): { groups: WorkingGroup[]; unplaced: Booking[] } {
  const sortedBookings = [...clusterBookings].sort((a, b) => b.pax - a.pax);
  const opened: WorkingGroup[] = [];
  const unplaced: Booking[] = [];

  for (const booking of sortedBookings) {
    // 1) best-fit into an already-opened bus for this cluster
    let bestIdx = -1;
    let bestRoom = Infinity;
    for (let i = 0; i < opened.length; i++) {
      const room = opened[i].bus.capacity - usedPax(opened[i]);
      if (booking.pax <= room && room - booking.pax < bestRoom) {
        bestRoom = room - booking.pax;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      opened[bestIdx].bookings.push(booking);
      continue;
    }

    // 2) claim a new bus from the shared pool: smallest capacity that still fits
    let poolIdx = -1;
    let poolBest = Infinity;
    for (let i = 0; i < busPool.length; i++) {
      if (busPool[i].capacity >= booking.pax && busPool[i].capacity < poolBest) {
        poolBest = busPool[i].capacity;
        poolIdx = i;
      }
    }
    if (poolIdx >= 0) {
      const bus = busPool.splice(poolIdx, 1)[0];
      opened.push({ bus, bookings: [booking] });
      continue;
    }

    // 3) nothing fits — leave for the cross-cluster second pass
    unplaced.push(booking);
  }

  return { groups: opened, unplaced };
}

// ---------- Step 3: local-search refinement ----------

function totalPax(bookings: Booking[]): number {
  return bookings.reduce((s, b) => s + b.pax, 0);
}

function refine(groups: WorkingGroup[], maxRounds = 300): void {
  let improved = true;
  let round = 0;
  while (improved && round < maxRounds) {
    improved = false;
    round++;
    outer: for (let a = 0; a < groups.length; a++) {
      for (let b = 0; b < groups.length; b++) {
        if (a === b) continue;
        for (let i = 0; i < groups[a].bookings.length; i++) {
          const ma = groups[a].bookings[i];
          if (ma.pinnedBusId) continue;

          // try MOVE: shift ma from a -> b if it fits and improves spread
          const roomB = groups[b].bus.capacity - totalPax(groups[b].bookings);
          if (ma.pax <= roomB) {
            const beforeSpread =
              groupSpread(groups[a].bookings) + groupSpread(groups[b].bookings);
            const newA = groups[a].bookings.filter((_, idx) => idx !== i);
            const newB = [...groups[b].bookings, ma];
            const afterSpread = groupSpread(newA) + groupSpread(newB);
            if (afterSpread < beforeSpread - 1e-6) {
              groups[a].bookings = newA;
              groups[b].bookings = newB;
              improved = true;
              continue outer;
            }
          }

          // try SWAP: exchange ma <-> mb between a and b if both fit and improves spread
          for (let j = 0; j < groups[b].bookings.length; j++) {
            const mb = groups[b].bookings[j];
            if (mb.pinnedBusId) continue;
            const sa = totalPax(groups[a].bookings);
            const sb = totalPax(groups[b].bookings);
            const newSa = sa - ma.pax + mb.pax;
            const newSb = sb - mb.pax + ma.pax;
            if (newSa > groups[a].bus.capacity || newSb > groups[b].bus.capacity)
              continue;
            const beforeSpread =
              groupSpread(groups[a].bookings) + groupSpread(groups[b].bookings);
            const newA = groups[a].bookings.map((x, idx) => (idx === i ? mb : x));
            const newB = groups[b].bookings.map((x, idx) => (idx === j ? ma : x));
            const afterSpread = groupSpread(newA) + groupSpread(newB);
            if (afterSpread < beforeSpread - 1e-6) {
              groups[a].bookings = newA;
              groups[b].bookings = newB;
              improved = true;
              continue outer;
            }
          }
        }
      }
    }
  }
}

// ---------- Step 4: consolidation ----------
//
// After clustering + packing, some buses can end up lightly loaded (e.g. a
// small geographic cluster only fills 5 of 17 seats). This pass folds
// under-filled groups entirely into the nearest group that has room for
// all of its bookings, freeing up buses so the fleet isn't used more than
// necessary. Pinned bookings block a group from being folded away.

function consolidate(groups: WorkingGroup[]): WorkingGroup[] {
  let changed = true;
  while (changed) {
    changed = false;
    groups.sort((a, b) => usedPax(a) - usedPax(b));
    for (let i = 0; i < groups.length; i++) {
      const src = groups[i];
      if (src.bookings.length === 0) continue;
      if (src.bookings.some((b) => b.pinnedBusId)) continue; // don't dissolve a pinned group

      let bestJ = -1;
      let bestScore = Infinity;
      for (let j = 0; j < groups.length; j++) {
        if (j === i || groups[j].bookings.length === 0) continue;
        const target = groups[j];
        const room = target.bus.capacity - usedPax(target);
        if (usedPax(src) > room) continue;
        // prefer close + snug fit: distance is primary, leftover room breaks ties
        const d = haversineKm(centroid(src.bookings), centroid(target.bookings));
        const leftover = room - usedPax(src);
        const score = d * 100 + leftover; // distance dominates, leftover is a tiebreaker
        if (score < bestScore) {
          bestScore = score;
          bestJ = j;
        }
      }
      if (bestJ >= 0) {
        groups[bestJ].bookings.push(...src.bookings);
        src.bookings = [];
        changed = true;
        break;
      }
    }
  }
  return groups.filter((g) => g.bookings.length > 0);
}

// ---------- Public entry point ----------

export function generateGroups(
  bookings: Booking[],
  buses: Bus[]
): GenerateGroupsResult {
  if (bookings.length === 0 || buses.length === 0) {
    return { groups: [], unassigned: [...bookings] };
  }

  // Pinned bookings keep their bus and claim capacity on it up front.
  const pinned = bookings.filter((b) => b.pinnedBusId);
  const free = bookings.filter((b) => !b.pinnedBusId);

  const busById = new Map(buses.map((b) => [b.id, b]));
  const groupsByBus = new Map<string, WorkingGroup>();

  for (const p of pinned) {
    const bus = busById.get(p.pinnedBusId!);
    if (!bus) continue; // pinned to a bus that no longer exists — treat as free instead
    let g = groupsByBus.get(bus.id);
    if (!g) {
      g = { bus, bookings: [] };
      groupsByBus.set(bus.id, g);
    }
    g.bookings.push(p);
  }

  // Shared pool = buses with no pinned bookings at all. Buses partially
  // filled by pinned bookings are deliberately left out of the initial
  // packing pass (packClusterExclusive assumes a bus's full nominal
  // capacity is free) and are instead topped up afterwards by the
  // leftover/second pass and by refine(), both of which compute remaining
  // room live via usedPax() so they never overbook a partially-pinned bus.
  let busPool: Bus[] = buses.filter((bus) => !groupsByBus.has(bus.id));

  const avgCapacity = buses.reduce((s, b) => s + b.capacity, 0) / buses.length || 16;
  const totalFreePax = totalPax(free);
  const k = Math.max(1, Math.round(totalFreePax / avgCapacity));

  const labels = kmeans(free, k);
  const clusters = new Map<number, Booking[]>();
  free.forEach((b, i) => {
    const c = labels[i];
    const arr = clusters.get(c) || [];
    arr.push(b);
    clusters.set(c, arr);
  });
  // process bigger clusters first so they get first pick of well-fitting buses
  const orderedClusters = [...clusters.values()].sort(
    (a, b) => totalPax(b) - totalPax(a)
  );

  let unassignedFromClusters: Booking[] = [];

  for (const clusterBookings of orderedClusters) {
    // let already-opened buses for this cluster include any pinned-but-not-full
    // bus that's geographically inside this cluster, so pinned seats count
    // toward the same physical bus rather than opening a duplicate.
    const { groups, unplaced } = packClusterExclusive(clusterBookings, busPool);
    for (const g of groups) {
      const existing = groupsByBus.get(g.bus.id);
      if (existing) {
        existing.bookings.push(...g.bookings);
      } else {
        groupsByBus.set(g.bus.id, g);
      }
    }
    unassignedFromClusters.push(...unplaced);
  }

  // second pass: place leftovers into ANY group with room, nearest first
  let stillUnassigned: Booking[] = [];
  for (const booking of unassignedFromClusters) {
    let bestGroup: WorkingGroup | null = null;
    let bestDist = Infinity;
    for (const g of groupsByBus.values()) {
      const room = g.bus.capacity - usedPax(g);
      if (booking.pax <= room) {
        const d = haversineKm(booking, centroid(g.bookings));
        if (d < bestDist) {
          bestDist = d;
          bestGroup = g;
        }
      }
    }
    if (bestGroup) {
      bestGroup.bookings.push(booking);
      continue;
    }
    // open a fresh bus from the pool as a last resort
    const poolIdx = busPool.findIndex(
      (b) => b.capacity >= booking.pax && !groupsByBus.has(b.id)
    );
    if (poolIdx >= 0) {
      const bus = busPool[poolIdx];
      groupsByBus.set(bus.id, { bus, bookings: [booking] });
    } else {
      stillUnassigned.push(booking);
    }
  }

  let workingGroups = [...groupsByBus.values()];
  refine(workingGroups);
  workingGroups = consolidate(workingGroups);
  refine(workingGroups); // one more tightening pass now that groups merged

  // Rescue pass: greedy bin-packing can leave a booking unplaced even when
  // the fleet has just enough total room (a known limitation of best-fit
  // heuristics on tightly-packed instances). Before giving up on a leftover
  // booking, try a single displacement: bump one existing booking off a
  // bus onto a different bus with room, freeing exactly enough space.
  if (stillUnassigned.length > 0) {
    const rescued: Booking[] = [];
    for (const booking of stillUnassigned) {
      let done = false;
      for (const hostGroup of workingGroups) {
        if (done) break;
        const hostRoom = hostGroup.bus.capacity - usedPax(hostGroup);
        if (booking.pax <= hostRoom) continue; // already would have fit, skip
        for (let x = 0; x < hostGroup.bookings.length; x++) {
          const displaced = hostGroup.bookings[x];
          if (displaced.pinnedBusId) continue;
          const roomIfRemoved = hostRoom + displaced.pax;
          if (booking.pax > roomIfRemoved) continue;
          // find a different bus for the displaced booking
          for (const otherGroup of workingGroups) {
            if (otherGroup === hostGroup) continue;
            const otherRoom = otherGroup.bus.capacity - usedPax(otherGroup);
            if (displaced.pax <= otherRoom) {
              hostGroup.bookings.splice(x, 1);
              hostGroup.bookings.push(booking);
              otherGroup.bookings.push(displaced);
              done = true;
              break;
            }
          }
          if (done) break;
        }
      }
      if (done) {
        rescued.push(booking);
      }
    }
    stillUnassigned = stillUnassigned.filter((b) => !rescued.includes(b));
    if (rescued.length > 0) refine(workingGroups);
  }

  const result: BusGroup[] = workingGroups
    .filter((g) => g.bookings.length > 0)
    .map((g) => ({
      bus: g.bus,
      bookings: g.bookings,
      totalPax: totalPax(g.bookings),
      zoneCenter: centroid(g.bookings),
    }))
    .sort((a, b) => a.zoneCenter.lng - b.zoneCenter.lng);

  return { groups: result, unassigned: stillUnassigned };
}

// ---------- Export helper ----------

export function exportGroupsAsTxt(
  result: GenerateGroupsResult,
  date: string
): string {
  const lines: string[] = [];
  const totalBookings = result.groups.reduce((s, g) => s + g.bookings.length, 0);
  const totalPaxAll = result.groups.reduce((s, g) => s + g.totalPax, 0);

  lines.push(`PICKUP GROUPS - ${date}`);
  lines.push(
    `Total buses used: ${result.groups.length} | Total bookings: ${totalBookings} | Total pax: ${totalPaxAll}`
  );
  lines.push("=".repeat(70));

  for (const g of result.groups) {
    lines.push("");
    lines.push(
      `BUS: ${g.bus.name} (${g.bus.owner || "unassigned owner"}) - ${g.totalPax}/${g.bus.capacity} PAX - ${g.bookings.length} bookings`
    );
    lines.push("-".repeat(70));
    for (const b of g.bookings) {
      lines.push(`Lead traveler: ${b.leadTraveler}`);
      if (b.phone) lines.push(`Phone: ${b.phone}`);
      if (b.email) lines.push(`Email: ${b.email}`);
      lines.push(`Pax: ${b.pax}`);
      lines.push(`Pick up location: https://www.google.com/maps/place/${b.lat},${b.lng}`);
      lines.push("");
    }
    lines.push("=".repeat(70));
  }

  if (result.unassigned.length > 0) {
    lines.push("");
    lines.push(`UNASSIGNED (fleet capacity exceeded) - ${result.unassigned.length} bookings`);
    lines.push("-".repeat(70));
    for (const b of result.unassigned) {
      lines.push(`Lead traveler: ${b.leadTraveler} - Pax: ${b.pax}`);
    }
  }

  return lines.join("\n");
}
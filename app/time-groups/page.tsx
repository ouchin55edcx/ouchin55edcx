import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import DashboardShell from '@/components/dashboard-shell'
import TimeGroupsClient from '@/components/time-groups-client'

export default async function TimeGroupsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/login')
  return <DashboardShell userName={session.user.name}><TimeGroupsClient /></DashboardShell>
}

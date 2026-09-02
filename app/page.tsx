import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import DashboardClient from '@/components/dashboard-client'
import DashboardShell from '@/components/dashboard-shell'

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/login')
  return <DashboardShell userName={session.user.name}><DashboardClient userName={session.user.name} /></DashboardShell>
}

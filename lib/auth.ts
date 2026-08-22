import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

const origins = [
  'http://localhost:3000',
  ...['V0_RUNTIME_URL', 'V0_DEV_APP_URL', 'V0_BUILD_URL', 'V0_SANDBOX_URL'].map((key) => process.env[key]).filter(Boolean).map((value) => value!.startsWith('http') ? value! : `https://${value}`),
  ...['VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL'].map((key) => process.env[key]).filter(Boolean).map((value) => value!.startsWith('http') ? value! : `https://${value}`),
]

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  baseURL: process.env.BETTER_AUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.V0_RUNTIME_URL),
  trustedOrigins: origins,
  emailAndPassword: { enabled: true, disableSignUp: true },
  hooks: {
    before: async (ctx: any) => {
      if (ctx.path === '/sign-in/email' && ctx.body?.email?.toLowerCase() !== 'ouchinmustapha82@gmail.com') {
        throw new Error('Unauthorized account')
      }
    },
  },
  session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60 * 12 },
  ...(process.env.NODE_ENV === 'development' ? { advanced: { defaultCookieAttributes: { sameSite: 'none' as const, secure: true } } } : {}),
})

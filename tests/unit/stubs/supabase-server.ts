// Stand-in for '#supabase/server' (a Nuxt module alias). A test that
// reaches the database mocks it: vi.mock('#supabase/server', …).
export function serverSupabaseServiceRole(): never {
  throw new Error('unit tests have no database: vi.mock("#supabase/server") in the test')
}

export function serverSupabaseClient(): never {
  throw new Error('unit tests have no database: vi.mock("#supabase/server") in the test')
}

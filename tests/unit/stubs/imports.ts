// Stand-in for '#imports' (Nuxt auto-imports). Tests exercise the
// plain functions next to the composables, never the composables.
export function useI18n(): never {
  throw new Error('no Nuxt app in unit tests: test the plain function instead of the composable')
}

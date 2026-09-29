import { paymentsDevMode, providerConfigured } from '../../utils/payments'

/**
 * GET /api/checkout/providers — which payment buttons the dashboard
 * should show. A provider without its full set of keys would only
 * answer 503 `payments_unavailable`, so its button is hidden.
 *
 *   Returns: { payme: boolean, click: boolean }
 */
export default defineEventHandler(() => {
  const dev = paymentsDevMode()
  return {
    payme: dev || providerConfigured('payme'),
    click: dev || providerConfigured('click'),
  }
})

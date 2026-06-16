import type { PricingType, PricingTier, PricingOption } from '@/types'
import { formatCents } from '@/lib/utils'

// "Per unit (each)" pricing is modeled as a single open-ended tier — it reuses the
// existing tiered booking flow (quantity stepper, qty × unit-price math, billing).
// A real multi-break tiered service has >1 tier; a per-unit one has exactly one
// tier starting at quantity 1. PER_UNIT_MAX_QTY (999) stays under the booking
// API's per-booking quantity cap (1000).
export const PER_UNIT_MAX_QTY = 999

export function makePerUnitTiers(unitPriceCents: number): PricingTier[] {
  return [{ minQty: 1, maxQty: PER_UNIT_MAX_QTY, unitPriceCents }]
}

export function isPerUnitService(service: Pick<PricingService, 'pricingType' | 'pricingTiers'>): boolean {
  if (service.pricingType !== 'tiered') return false
  const tiers = service.pricingTiers ?? []
  return tiers.length === 1 && tiers[0].minQty <= 1
}

export function perUnitCents(service: Pick<PricingService, 'pricingTiers' | 'priceCents'>): number {
  return service.pricingTiers?.[0]?.unitPriceCents ?? service.priceCents
}

export interface PricingService {
  priceCents: number
  pricingType: string
  addonAmountCents: number | null
  pricingTiers: PricingTier[] | null
  pricingOptions: PricingOption[] | null
}

export interface ResolvePriceInput {
  quantity?: number
  selectedOption?: string
  includeAddon?: boolean
}

export interface ResolvePriceResult {
  priceCents: number
  addonTotalCents: number | null
}

export function resolvePrice(
  service: PricingService,
  input: ResolvePriceInput = {}
): ResolvePriceResult {
  switch (service.pricingType) {
    case 'addon': {
      const addonAmount =
        input.includeAddon && service.addonAmountCents
          ? service.addonAmountCents
          : 0
      return {
        priceCents: service.priceCents + addonAmount,
        addonTotalCents: addonAmount || null,
      }
    }

    case 'tiered': {
      const qty = input.quantity ?? 1
      const tiers = service.pricingTiers ?? []
      const tier = tiers.find((t) => qty >= t.minQty && qty <= t.maxQty)
      if (!tier) {
        return { priceCents: service.priceCents, addonTotalCents: null }
      }
      return { priceCents: qty * tier.unitPriceCents, addonTotalCents: null }
    }

    case 'multi_option': {
      const options = service.pricingOptions ?? []
      const option = options.find((o) => o.name === input.selectedOption)
      if (!option) {
        return { priceCents: service.priceCents, addonTotalCents: null }
      }
      return { priceCents: option.priceCents, addonTotalCents: null }
    }

    default:
      return { priceCents: service.priceCents, addonTotalCents: null }
  }
}

export function formatPricingLabel(service: PricingService): string {
  switch (service.pricingType) {
    case 'addon': {
      const surcharge = service.addonAmountCents ?? service.priceCents
      return surcharge ? `+${formatCents(surcharge)}` : formatCents(service.priceCents)
    }

    case 'tiered': {
      const tiers = service.pricingTiers ?? []
      if (tiers.length === 0) return formatCents(service.priceCents)
      // A single open-ended tier is a flat per-unit price → "$8.00 each".
      if (isPerUnitService(service)) return `${formatCents(tiers[0].unitPriceCents)} each`
      return `${formatCents(tiers[0].unitPriceCents)}/unit`
    }

    case 'multi_option': {
      const options = service.pricingOptions ?? []
      if (options.length === 0) return formatCents(service.priceCents)
      const prices = options.map((o) => o.priceCents)
      const min = Math.min(...prices)
      const max = Math.max(...prices)
      return min === max
        ? formatCents(min)
        : `${formatCents(min)}–${formatCents(max)}`
    }

    default:
      return formatCents(service.priceCents)
  }
}

export function validatePricingInput(
  service: PricingService,
  input: ResolvePriceInput
): string | null {
  switch (service.pricingType) {
    case 'tiered': {
      const qty = input.quantity
      if (qty == null || qty < 1) return 'Quantity is required'
      const tiers = service.pricingTiers ?? []
      const tier = tiers.find((t) => qty >= t.minQty && qty <= t.maxQty)
      if (!tier) return `Quantity ${qty} is outside the available tiers`
      return null
    }

    case 'multi_option': {
      if (!input.selectedOption) return 'Please select an option'
      const options = service.pricingOptions ?? []
      const option = options.find((o) => o.name === input.selectedOption)
      if (!option) return `Option "${input.selectedOption}" not found`
      return null
    }

    default:
      return null
  }
}

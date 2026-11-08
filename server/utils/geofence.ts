import { z } from 'zod'
import { GEOFENCE_RADIUS_MAX, GEOFENCE_RADIUS_MIN } from '#shared/geofence'
import { fail } from './errors'

/**
 * The geofence fields of the admin event endpoints (POST create, PATCH
 * edit). They travel as a group: the venue point AND a radius turn it
 * on, a null point turns it off and clears all three. Anything in
 * between (one coordinate, a point without a radius) is refused with
 * 422 geofence_incomplete — half a geofence would silently never apply.
 */
export const geofenceShape = {
  venue_lat: z.number().min(-90).max(90).nullable().optional(),
  venue_lng: z.number().min(-180).max(180).nullable().optional(),
  geofence_radius: z.number().int().min(GEOFENCE_RADIUS_MIN).max(GEOFENCE_RADIUS_MAX).nullable().optional(),
}

export const GEOFENCE_FIELD_CODES = {
  venue_lat: 'invalid_coordinates',
  venue_lng: 'invalid_coordinates',
  geofence_radius: 'invalid_radius',
} as const

type GeofenceInput = {
  venue_lat?: number | null
  venue_lng?: number | null
  geofence_radius?: number | null
}
export type GeofenceColumns = { venue_lat: number | null; venue_lng: number | null; geofence_radius: number | null }

/** The columns to write, or null when the body doesn't mention the geofence. */
export function geofenceColumns(input: GeofenceInput): GeofenceColumns | null {
  const { venue_lat: lat, venue_lng: lng, geofence_radius: radius } = input
  if (lat === undefined && lng === undefined && radius === undefined) return null
  if (typeof lat === 'number' && typeof lng === 'number' && typeof radius === 'number') {
    return { venue_lat: lat, venue_lng: lng, geofence_radius: radius }
  }
  if (lat === null && lng === null && (radius === null || radius === undefined)) {
    return { venue_lat: null, venue_lng: null, geofence_radius: null }
  }
  fail(422, 'geofence_incomplete', { field: 'venue_lat' })
}

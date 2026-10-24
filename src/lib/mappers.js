// DB -> frontend shapes (see src/types/index.ts in the frontend).
import { pickI18n, altI18n, num, toDateOnly } from './i18n.js';

const TOUR_CATEGORIES = new Set(['wildlife', 'city', 'beach', 'transfer']);

export function mediaToImage(mediaRow) {
  if (!mediaRow) return null;
  return {
    id: mediaRow.id,
    url: mediaRow.public_url || mediaRow.storage_key,
    alt: altI18n(mediaRow.alt_i18n),
    ...(mediaRow.width_px ? { width: mediaRow.width_px } : {}),
    ...(mediaRow.height_px ? { height: mediaRow.height_px } : {}),
  };
}

function orderedMedia(links, lang) {
  const sorted = [...(links ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const coverFirst = [...sorted].sort((a, b) => (a.role === 'COVER' ? -1 : 0) - (b.role === 'COVER' ? -1 : 0));
  return { cover: coverFirst[0]?.media ?? null, gallery: coverFirst.map((l) => l.media).filter(Boolean), lang };
}

export function serviceToTour(svc, lang = 'en') {
  const categorySlug = svc.service_categories?.[0]?.tour_categories?.slug;
  const category = TOUR_CATEGORIES.has(categorySlug)
    ? categorySlug
    : svc.service_type === 'TRANSFER'
      ? 'transfer'
      : 'wildlife';
  const media = orderedMedia(svc.service_media, lang);
  const places = (svc.service_places ?? [])
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((sp) => ({
      id: sp.places?.id,
      slug: sp.places?.slug,
      name: pickI18n(sp.places?.name_i18n, lang),
      description: pickI18n(sp.places?.description_i18n, lang) || pickI18n(sp.places?.short_description_i18n, lang),
      region: sp.places?.region,
      image: mediaToImage(sp.places?.place_media?.[0]?.media ?? null),
      gallery: (sp.places?.place_media ?? []).map((l) => mediaToImage(l.media)).filter(Boolean),
    }))
    .filter((p) => p.name);
  const placeNames = places.map((p) => p.name).filter(Boolean);
  const duration = svc.duration_minutes
    ? svc.duration_minutes >= 60
      ? `About ${Math.round(svc.duration_minutes / 60)} hour${svc.duration_minutes >= 120 ? 's' : ''}`
      : `About ${svc.duration_minutes} minutes`
    : 'Confirmed by admin';
  return {
    id: svc.id,
    slug: svc.slug,
    title: pickI18n(svc.title_i18n, lang),
    category,
    location: svc.service_places?.[0]?.places?.region || 'Trincomalee, Sri Lanka',
    description: pickI18n(svc.description_i18n, lang) || pickI18n(svc.short_description_i18n, lang),
    places: placeNames,
    placesDetail: places,
    duration,
    ...(num(svc.price_from_usd) != null ? { startingPriceUsd: num(svc.price_from_usd) } : {}),
    ...(media.cover ? { coverImage: mediaToImage(media.cover) } : {}),
    gallery: media.gallery.map(mediaToImage),
    featured: svc.is_featured,
    active: svc.status === 'PUBLISHED',
  };
}

export function placeToCard(place, lang = 'en') {
  const media = orderedMedia(place.place_media, lang);
  return {
    id: place.id,
    slug: place.slug,
    name: pickI18n(place.name_i18n, lang),
    description: pickI18n(place.description_i18n, lang) || pickI18n(place.short_description_i18n, lang),
    region: place.region,
    mapUrl: place.map_url,
    imageUrl: media.cover?.public_url || media.gallery[0]?.public_url || null,
    featured: place.is_featured,
    active: place.status === 'PUBLISHED',
  };
}

export function vehicleTypePublic(vt, lang = 'en') {
  return {
    id: vt.id,
    slug: vt.slug,
    name: pickI18n(vt.name_i18n, lang),
    description: pickI18n(vt.description_i18n, lang),
    passengerCapacity: vt.passenger_capacity,
    luggageCapacity: vt.luggage_capacity,
    pricingModel: vt.pricing_model,
    priceFrom: { usd: num(vt.price_from_usd) ?? null, lkr: num(vt.price_from_lkr) ?? null },
    driverIncluded: vt.driver_included,
  };
}

// DB booking_status -> frontend display label.
export const STATUS_LABEL = {
  NEW_REQUEST: 'New Request',
  CONTACT_PENDING: 'Contacted',
  QUOTATION_SENT: 'Contacted',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

export function bookingToSummary(booking, lang = 'en') {
  const serviceName = booking.services
    ? pickI18n(booking.services.title_i18n, lang)
    : booking.vehicle_types
      ? pickI18n(booking.vehicle_types.name_i18n, lang)
      : 'Custom request';
  return {
    bookingId: booking.booking_code,
    status: STATUS_LABEL[booking.status] ?? 'New Request',
    service: serviceName,
    travelDate: toDateOnly(booking.travel_date),
  };
}

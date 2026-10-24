import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db.js';
import { ok, fail, ah } from '../lib/http.js';
import { pickI18n, toDateOnly } from '../lib/i18n.js';
import { serviceToTour, placeToCard, vehicleTypePublic, bookingToSummary } from '../lib/mappers.js';

export const publicRouter = Router();

const serviceInclude = {
  service_categories: { include: { tour_categories: true } },
  service_places: { include: { places: { include: { place_media: { include: { media: true }, orderBy: { sort_order: 'asc' } } } } }, orderBy: { sort_order: 'asc' } },
  service_media: { include: { media: true }, orderBy: { sort_order: 'asc' } },
};

const placeInclude = {
  place_media: { include: { media: true }, orderBy: { sort_order: 'asc' } },
};

function langOf(req) {
  const q = String(req.query.lang || req.body?.language || 'en').toLowerCase();
  return ['en', 'ta', 'si'].includes(q) ? q : 'en';
}

// ---------- Tours ----------
publicRouter.get(
  '/tours',
  ah(async (req, res) => {
    const lang = langOf(req);
    const where = { status: 'PUBLISHED' };
    if (req.query.featured === 'true') where.is_featured = true;
    const services = await prisma.services.findMany({
      where,
      include: serviceInclude,
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });
    ok(res, services.map((s) => serviceToTour(s, lang)));
  }),
);

publicRouter.get(
  '/tours/:slug',
  ah(async (req, res) => {
    const lang = langOf(req);
    const svc = await prisma.services.findFirst({
      where: { slug: req.params.slug, status: 'PUBLISHED' },
      include: serviceInclude,
    });
    if (!svc) return fail(res, 404, 'Tour not found.', 'NOT_FOUND');
    ok(res, serviceToTour(svc, lang));
  }),
);

// ---------- Destinations ----------
publicRouter.get(
  '/places',
  ah(async (req, res) => {
    const lang = langOf(req);
    const where = { status: 'PUBLISHED' };
    if (req.query.featured === 'true') where.is_featured = true;
    const places = await prisma.places.findMany({
      where,
      include: placeInclude,
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });
    ok(res, places.map((p) => placeToCard(p, lang)));
  }),
);

publicRouter.get(
  '/places/:slug',
  ah(async (req, res) => {
    const lang = langOf(req);
    const place = await prisma.places.findFirst({
      where: { slug: req.params.slug, status: 'PUBLISHED' },
      include: placeInclude,
    });
    if (!place) return fail(res, 404, 'Destination not found.', 'NOT_FOUND');
    const card = placeToCard(place, lang);
    ok(res, {
      ...card,
      address: pickI18n(place.address_i18n, lang),
      visitorTips: pickI18n(place.visitor_tips_i18n, lang),
      bestTime: pickI18n(place.best_time_i18n, lang),
    });
  }),
);

// ---------- Vehicle information (public) ----------
publicRouter.get(
  '/vehicles',
  ah(async (req, res) => {
    const lang = langOf(req);
    const types = await prisma.vehicle_types.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sort_order: 'asc' }],
    });
    ok(res, types.map((t) => vehicleTypePublic(t, lang)));
  }),
);

// ---------- FAQs ----------
publicRouter.get(
  '/faqs',
  ah(async (req, res) => {
    const lang = langOf(req);
    const faqs = await prisma.faqs.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sort_order: 'asc' }],
    });
    ok(
      res,
      faqs.map((f) => ({
        id: f.id,
        question: pickI18n(f.question_i18n, lang),
        answer: pickI18n(f.answer_i18n, lang),
        category: f.category,
      })),
    );
  }),
);

// ---------- Reviews ----------
publicRouter.get(
  '/reviews',
  ah(async (req, res) => {
    const reviews = await prisma.reviews.findMany({
      where: { status: 'APPROVED' },
      include: { bookings: { include: { services: true } } },
      orderBy: [{ created_at: 'desc' }],
      take: 100,
    });
    ok(
      res,
      reviews.map((r) => ({
        id: r.id,
        name: r.public_name,
        service: r.bookings?.services ? pickI18n(r.bookings.services.title_i18n) : 'Wander Wheels tour',
        rating: r.rating,
        comment: r.comment,
      })),
    );
  }),
);

publicRouter.post(
  '/reviews',
  ah(async (req, res) => {
    const { bookingId, name, publicName, rating, comment, language } = req.body ?? {};
    const fieldErrors = {};
    const code = String(bookingId ?? '').trim().toUpperCase();
    const displayName = String(name ?? publicName ?? '').trim();
    const text = String(comment ?? '').trim();
    const stars = Number(rating);
    if (!code) fieldErrors.bookingId = 'Booking ID is required.';
    if (displayName.length < 1 || displayName.length > 100) fieldErrors.name = 'Name must be 1-100 characters.';
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) fieldErrors.rating = 'Rating must be 1-5.';
    if (text.length < 5 || text.length > 3000) fieldErrors.comment = 'Comment must be 5-3000 characters.';
    if (Object.keys(fieldErrors).length > 0) {
      return fail(res, 400, 'Review validation failed.', 'VALIDATION_ERROR', fieldErrors);
    }
    const booking = await prisma.bookings.findUnique({ where: { booking_code: code } });
    if (!booking) return fail(res, 404, 'Booking not found for this ID.', 'NOT_FOUND');
    const existing = await prisma.reviews.findUnique({ where: { booking_id: booking.id } });
    if (existing) return fail(res, 409, 'A review was already submitted for this booking.', 'CONFLICT');
    const review = await prisma.reviews.create({
      data: {
        booking_id: booking.id,
        public_name: displayName,
        rating: stars,
        comment: text,
        language: ['en', 'ta', 'si'].includes(String(language)) ? String(language) : 'en',
        status: 'PENDING',
      },
    });
    ok(res, { id: review.id, status: 'PENDING' }, 201);
  }),
);

// ---------- Public settings ----------
publicRouter.get(
  '/settings/public',
  ah(async (_req, res) => {
    const rows = await prisma.site_settings.findMany({ where: { is_public: true } });
    ok(res, Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])));
  }),
);

// ---------- Bookings ----------
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode() {
  let code = 'WW-';
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

async function uniqueBookingCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    const existing = await prisma.bookings.findUnique({ where: { booking_code: code } });
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique booking code.');
}

// Accept both the API-contract payload and the frontend BookingRequest shape.
function normalizeBookingInput(body) {
  const b = body ?? {};
  const tourRef = String(b.serviceId ?? b.service ?? b.tour ?? '').trim();
  const travelDate = String(b.travelDate ?? '').trim();
  const timeRaw = String(b.preferredTime ?? b.pickupTime ?? '').trim();
  return {
    customerName: String(b.customerName ?? '').trim(),
    phone: String(b.phone ?? '').trim(),
    email: b.email ? String(b.email).trim() : null,
    tourRef,
    travelDate,
    preferredTime: /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(timeRaw) ? timeRaw : null,
    passengers: Number(b.passengers),
    pickupLocation: String(b.pickupLocation ?? '').trim(),
    pickupMapUrl: b.pickupMapUrl ?? b.mapsLink ?? null,
    destinationText: b.destination_text ?? b.destination ?? null,
    destinationMapUrl: b.destination_map_url ?? null,
    extraRequests: b.extraRequests ?? b.additionalRequests ?? null,
    language: ['en', 'ta', 'si'].includes(String(b.language)) ? String(b.language) : 'en',
    privacyConsent: b.privacyConsent === true || typeof b.privacyConsentAt === 'string',
    privacyConsentAt: typeof b.privacyConsentAt === 'string' ? b.privacyConsentAt : null,
    idempotencyKey:
      typeof b.idempotencyKey === 'string' && b.idempotencyKey.length > 0 ? b.idempotencyKey : null,
  };
}

async function resolveService(tourRef) {
  if (!tourRef) return null;
  // UUID -> direct id lookup.
  if (/^[0-9a-f-]{36}$/i.test(tourRef)) {
    return prisma.services.findUnique({
      where: { id: tourRef },
      include: { service_places: { include: { places: true } } },
    });
  }
  // Otherwise treat as slug first, then case-insensitive title match.
  const bySlug = await prisma.services.findUnique({
    where: { slug: tourRef.toLowerCase() },
    include: { service_places: { include: { places: true } } },
  });
  if (bySlug) return bySlug;
  const all = await prisma.services.findMany({
    where: { status: 'PUBLISHED' },
    include: { service_places: { include: { places: true } } },
  });
  const needle = tourRef.toLowerCase();
  return (
    all.find((s) => {
      const titles = Object.values(s.title_i18n ?? {}).map((v) => String(v).toLowerCase());
      return titles.includes(needle) || titles.some((t) => t.includes(needle) || needle.includes(t));
    }) ?? null
  );
}

export const createBookingLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

publicRouter.post(
  '/bookings',
  createBookingLimiter,
  ah(async (req, res) => {
    const input = normalizeBookingInput(req.body);
    const fieldErrors = {};
    if (input.customerName.length < 2 || input.customerName.length > 160) {
      fieldErrors.customerName = 'Name must be 2-160 characters.';
    }
    if (input.phone.length < 6 || input.phone.length > 32) {
      fieldErrors.phone = 'Phone must be 6-32 characters.';
    }
    const travelDate = new Date(`${input.travelDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.travelDate) || Number.isNaN(travelDate.getTime())) {
      fieldErrors.travelDate = 'Travel date must be YYYY-MM-DD.';
    } else {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (travelDate < today) fieldErrors.travelDate = 'Travel date cannot be in the past.';
    }
    if (!Number.isInteger(input.passengers) || input.passengers <= 0) {
      fieldErrors.passengers = 'Passengers must be at least 1.';
    }
    if (!input.pickupLocation) fieldErrors.pickupLocation = 'Pickup location is required.';
    if (!input.privacyConsent) fieldErrors.privacyConsent = 'Privacy consent is required.';
    if (Object.keys(fieldErrors).length > 0) {
      return fail(res, 400, 'Booking validation failed.', 'VALIDATION_ERROR', fieldErrors);
    }

    // Idempotent retry: same key returns the original summary, never a duplicate row.
    if (input.idempotencyKey) {
      const prior = await prisma.bookings.findUnique({
        where: { idempotency_key: input.idempotencyKey },
        include: { services: true, vehicle_types: true },
      });
      if (prior) return ok(res, bookingToSummary(prior, input.language));
    }

    const service = await resolveService(input.tourRef);
    if (service && service.status !== 'PUBLISHED') {
      return fail(res, 409, 'That tour is no longer available.', 'SLOT_UNAVAILABLE');
    }
    if (service?.max_passengers && input.passengers > service.max_passengers) {
      return fail(res, 400, `This tour allows at most ${service.max_passengers} passengers.`, 'VALIDATION_ERROR', {
        passengers: `Maximum is ${service.max_passengers}. Contact us for group arrangements.`,
      });
    }
    if (service && service.minimum_advance_hours > 0) {
      const earliest = Date.now() + service.minimum_advance_hours * 3_600_000;
      if (travelDate.getTime() < earliest) {
        return fail(res, 400, 'This tour needs earlier booking.', 'VALIDATION_ERROR', {
          travelDate: `Book at least ${service.minimum_advance_hours} hours in advance.`,
        });
      }
    }

    const bookingType =
      // eslint-disable-next-line no-nested-ternary
      service == null ? 'CUSTOM' : service.service_type === 'TRANSFER' ? 'TRANSFER' : 'TOUR';
    const bookingCode = await uniqueBookingCode();

    const created = await prisma.$transaction(async (tx) => {
      const booking = await tx.bookings.create({
        data: {
          booking_code: bookingCode,
          idempotency_key: input.idempotencyKey,
          booking_type: bookingType,
          customer_name: input.customerName,
          phone: input.phone,
          email: input.email,
          language: input.language,
          service_id: service?.id ?? null,
          travel_date: travelDate,
          preferred_time: input.preferredTime
            ? new Date(`1970-01-01T${input.preferredTime.length === 5 ? `${input.preferredTime}:00` : input.preferredTime}Z`)
            : null,
          pickup_location: input.pickupLocation,
          pickup_map_url: input.pickupMapUrl ? String(input.pickupMapUrl) : null,
          destination_text: input.destinationText ? String(input.destinationText) : null,
          destination_map_url: input.destinationMapUrl ? String(input.destinationMapUrl) : null,
          passengers: input.passengers,
          extra_requests: input.extraRequests ? String(input.extraRequests) : null,
          status: 'NEW_REQUEST',
          privacy_consent_at: input.privacyConsent ? new Date(input.privacyConsentAt ?? Date.now()) : null,
          privacy_policy_version: '2026-10-01',
          customer_source: 'WEBSITE',
        },
        include: { services: true, vehicle_types: true },
      });
      await tx.booking_status_history.create({
        data: { booking_id: booking.id, old_status: null, new_status: 'NEW_REQUEST' },
      });
      return booking;
    });

    ok(
      res,
      bookingToSummary(created, input.language),
      201,
    );
  }),
);

export const lookupLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public lookup returns ONLY id, status, service and travel date (never contacts/pickup).
publicRouter.post(
  '/bookings/lookup',
  lookupLimiter,
  ah(async (req, res) => {
    const code = String(req.body?.bookingId ?? '').trim().toUpperCase();
    const phone = String(req.body?.phone ?? '').trim();
    if (!code || !phone) return fail(res, 400, 'Booking ID and phone are required.', 'VALIDATION_ERROR');
    const booking = await prisma.bookings.findUnique({
      where: { booking_code: code },
      include: { services: true, vehicle_types: true },
    });
    if (!booking || booking.phone.trim() !== phone) {
      // Same response for unknown code vs wrong phone: no account enumeration.
      return fail(res, 404, 'No booking matches that ID and phone.', 'NOT_FOUND');
    }
    ok(res, {
      ...bookingToSummary(booking),
      travelDate: toDateOnly(booking.travel_date),
    });
  }),
);

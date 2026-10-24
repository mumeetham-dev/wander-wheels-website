import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { ok, fail, ah } from '../lib/http.js';
import { validateAdminEmail } from '../lib/email.js';
import { pickI18n, num, toDateOnly, jsonSafe } from '../lib/i18n.js';
import { serviceToTour, placeToCard, bookingToSummary } from '../lib/mappers.js';
import { requireAdmin, requireRole, logActivity, clientIp } from '../lib/auth.js';
import { deleteFromCloudinary, isCloudinaryConfigured, uploadToCloudinary } from '../lib/cloudinary.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const EDITOR = ['OWNER', 'ADMIN', 'EDITOR'];
const MANAGER = ['OWNER', 'ADMIN'];

const serviceInclude = {
  service_categories: { include: { tour_categories: true } },
  service_places: { include: { places: true }, orderBy: { sort_order: 'asc' } },
  service_media: { include: { media: true }, orderBy: { sort_order: 'asc' } },
};

function pagination(req) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `item-${Date.now().toString(36)}`
  );
}

function i18nInput(value, fallback = '') {
  if (value == null) return { en: fallback };
  if (typeof value === 'string') return { en: value };
  if (typeof value === 'object') {
    const out = {};
    for (const k of ['en', 'ta', 'si']) if (typeof value[k] === 'string') out[k] = value[k];
    if (!out.en) out.en = fallback;
    return out;
  }
  return { en: fallback };
}

const CONTENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

// ---------- Tours ----------
adminRouter.get('/tours', requireRole(...EDITOR), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pagination(req);
  const where = {};
  if (req.query.status && CONTENT_STATUSES.includes(String(req.query.status))) {
    where.status = String(req.query.status);
  }
  if (req.query.search) {
    where.slug = { contains: String(req.query.search), mode: 'insensitive' };
  }
  const [total, rows] = await Promise.all([
    prisma.services.count({ where }),
    prisma.services.findMany({ where, include: serviceInclude, orderBy: [{ sort_order: 'asc' }], skip, take }),
  ]);
  ok(res, {
    items: rows.map((s) => ({
      ...serviceToTour(s),
      status: s.status,
      serviceType: s.service_type,
      sortOrder: s.sort_order,
      maxPassengers: s.max_passengers,
      priceLkr: num(s.price_from_lkr) ?? null,
    })),
    page, pageSize, total,
  });
}));

adminRouter.post('/tours', requireRole(...EDITOR), ah(async (req, res) => {
  const b = req.body ?? {};
  const title = i18nInput(b.title ?? b.title_i18n, '');
  if (!title.en) return fail(res, 400, 'English title is required.', 'VALIDATION_ERROR', { title: 'Required.' });
  const slug = String(b.slug || slugify(title.en));
  const svc = await prisma.services.create({
    data: {
      slug,
      service_type: ['TOUR', 'TRANSFER', 'EXPERIENCE', 'CUSTOM'].includes(b.service_type ?? b.serviceType) ? (b.service_type ?? b.serviceType) : 'TOUR',
      title_i18n: title,
      short_description_i18n: i18nInput(b.short_description ?? b.short_description_i18n, ''),
      description_i18n: i18nInput(b.description ?? b.description_i18n, ''),
      duration_minutes: b.duration_minutes ?? null,
      pricing_model: b.pricing_model ?? 'QUOTE_REQUIRED',
      price_from_usd: b.price_from_usd ?? b.startingPriceUsd ?? null,
      price_from_lkr: b.price_from_lkr ?? null,
      max_passengers: b.max_passengers ?? null,
      minimum_advance_hours: b.minimum_advance_hours ?? 0,
      status: CONTENT_STATUSES.includes(b.status) ? b.status : 'DRAFT',
      is_featured: b.is_featured ?? b.featured ?? false,
      sort_order: b.sort_order ?? 0,
    },
    include: serviceInclude,
  });
  logActivity({ adminId: req.admin.id, action: 'tour.create', entityType: 'service', entityId: svc.id, summary: `Created tour ${slug}`, ip: clientIp(req) });
  ok(res, { ...serviceToTour(svc), status: svc.status }, 201);
}));

adminRouter.get('/tours/:id', requireRole(...EDITOR), ah(async (req, res) => {
  const svc = await prisma.services.findUnique({ where: { id: req.params.id }, include: serviceInclude });
  if (!svc) return fail(res, 404, 'Tour not found.', 'NOT_FOUND');
  ok(res, jsonSafe({ ...serviceToTour(svc), status: svc.status, raw: svc }));
}));

adminRouter.patch('/tours/:id', requireRole(...EDITOR), ah(async (req, res) => {
  const b = req.body ?? {};
  const data = {};
  if (b.title ?? b.title_i18n) data.title_i18n = i18nInput(b.title ?? b.title_i18n, '');
  if (b.short_description ?? b.short_description_i18n) data.short_description_i18n = i18nInput(b.short_description ?? b.short_description_i18n, '');
  if (b.description ?? b.description_i18n) data.description_i18n = i18nInput(b.description ?? b.description_i18n, '');
  if (b.slug) data.slug = String(b.slug);
  if (b.service_type ?? b.serviceType) data.service_type = b.service_type ?? b.serviceType;
  for (const k of ['duration_minutes', 'price_from_usd', 'price_from_lkr', 'max_passengers', 'minimum_advance_hours', 'sort_order']) {
    if (b[k] !== undefined) data[k] = b[k];
  }
  if (b.pricing_model) data.pricing_model = b.pricing_model;
  if (b.status && CONTENT_STATUSES.includes(b.status)) data.status = b.status;
  if (b.is_featured ?? b.featured !== undefined) data.is_featured = b.is_featured ?? b.featured;
  try {
    const svc = await prisma.services.update({ where: { id: req.params.id }, data, include: serviceInclude });
    logActivity({ adminId: req.admin.id, action: 'tour.update', entityType: 'service', entityId: svc.id, summary: `Updated tour ${svc.slug}`, ip: clientIp(req) });
    ok(res, { ...serviceToTour(svc), status: svc.status });
  } catch {
    return fail(res, 404, 'Tour not found.', 'NOT_FOUND');
  }
}));

// Archive instead of hard delete so historical bookings keep their service link.
adminRouter.delete('/tours/:id', requireRole(...EDITOR), ah(async (req, res) => {
  try {
    const svc = await prisma.services.update({
      where: { id: req.params.id },
      data: { status: 'ARCHIVED', archived_at: new Date() },
    });
    logActivity({ adminId: req.admin.id, action: 'tour.archive', entityType: 'service', entityId: svc.id, summary: `Archived tour ${svc.slug}`, ip: clientIp(req) });
    ok(res, { archived: true });
  } catch {
    return fail(res, 404, 'Tour not found.', 'NOT_FOUND');
  }
}));

// Replace ordered place assignments for a tour.
adminRouter.put('/tours/:id/places', requireRole(...EDITOR), ah(async (req, res) => {
  const placeIds = Array.isArray(req.body?.placeIds) ? req.body.placeIds : null;
  if (!placeIds) return fail(res, 400, 'placeIds array is required.', 'VALIDATION_ERROR');
  const svc = await prisma.services.findUnique({ where: { id: req.params.id } });
  if (!svc) return fail(res, 404, 'Tour not found.', 'NOT_FOUND');
  await prisma.$transaction([
    prisma.service_places.deleteMany({ where: { service_id: svc.id } }),
    ...(placeIds.length > 0
      ? [
          prisma.service_places.createMany({
            data: placeIds.map((place_id, i) => ({ service_id: svc.id, place_id, sort_order: i })),
          }),
        ]
      : []),
  ]);
  logActivity({ adminId: req.admin.id, action: 'tour.places', entityType: 'service', entityId: svc.id, summary: `Reassigned ${placeIds.length} places`, ip: clientIp(req) });
  ok(res, { assigned: placeIds.length });
}));

// ---------- Places ----------
adminRouter.get('/places', requireRole(...EDITOR), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pagination(req);
  const where = {};
  if (req.query.status && CONTENT_STATUSES.includes(String(req.query.status))) where.status = String(req.query.status);
  const [total, rows] = await Promise.all([
    prisma.places.count({ where }),
    prisma.places.findMany({ where, include: { place_media: { include: { media: true } } }, orderBy: [{ sort_order: 'asc' }], skip, take }),
  ]);
  ok(res, jsonSafe({ items: rows.map((p) => ({ ...placeToCard(p), status: p.status, sortOrder: p.sort_order, place_media: p.place_media })), page, pageSize, total }));
}));

adminRouter.post('/places', requireRole(...EDITOR), ah(async (req, res) => {
  const b = req.body ?? {};
  const name = i18nInput(b.name ?? b.name_i18n, '');
  if (!name.en) return fail(res, 400, 'English name is required.', 'VALIDATION_ERROR', { name: 'Required.' });
  const slug = String(b.slug || slugify(name.en));
  const place = await prisma.places.create({
    data: {
      slug,
      name_i18n: name,
      short_description_i18n: i18nInput(b.short_description ?? b.short_description_i18n, ''),
      description_i18n: i18nInput(b.description ?? b.description_i18n, ''),
      region: b.region ?? null,
      map_url: b.map_url ?? b.mapUrl ?? null,
      status: CONTENT_STATUSES.includes(b.status) ? b.status : 'DRAFT',
      is_featured: b.is_featured ?? b.featured ?? false,
      sort_order: b.sort_order ?? 0,
    },
    include: { place_media: { include: { media: true } } },
  });
  logActivity({ adminId: req.admin.id, action: 'place.create', entityType: 'place', entityId: place.id, summary: `Created place ${slug}`, ip: clientIp(req) });
  ok(res, { ...placeToCard(place), status: place.status }, 201);
}));

adminRouter.get('/places/:id', requireRole(...EDITOR), ah(async (req, res) => {
  const place = await prisma.places.findUnique({ where: { id: req.params.id }, include: { place_media: { include: { media: true } } } });
  if (!place) return fail(res, 404, 'Destination not found.', 'NOT_FOUND');
  ok(res, jsonSafe({ ...placeToCard(place), status: place.status, raw: place }));
}));

adminRouter.patch('/places/:id', requireRole(...EDITOR), ah(async (req, res) => {
  const b = req.body ?? {};
  const data = {};
  if (b.name ?? b.name_i18n) data.name_i18n = i18nInput(b.name ?? b.name_i18n, '');
  if (b.short_description ?? b.short_description_i18n) data.short_description_i18n = i18nInput(b.short_description ?? b.short_description_i18n, '');
  if (b.description ?? b.description_i18n) data.description_i18n = i18nInput(b.description ?? b.description_i18n, '');
  if (b.slug) data.slug = String(b.slug);
  if (b.region !== undefined) data.region = b.region;
  if (b.map_url ?? b.mapUrl !== undefined) data.map_url = b.map_url ?? b.mapUrl;
  if (b.status && CONTENT_STATUSES.includes(b.status)) data.status = b.status;
  if (b.is_featured ?? b.featured !== undefined) data.is_featured = b.is_featured ?? b.featured;
  if (b.sort_order !== undefined) data.sort_order = b.sort_order;
  try {
    const place = await prisma.places.update({ where: { id: req.params.id }, data, include: { place_media: { include: { media: true } } } });
    logActivity({ adminId: req.admin.id, action: 'place.update', entityType: 'place', entityId: place.id, summary: `Updated place ${place.slug}`, ip: clientIp(req) });
    ok(res, { ...placeToCard(place), status: place.status });
  } catch {
    return fail(res, 404, 'Destination not found.', 'NOT_FOUND');
  }
}));

adminRouter.delete('/places/:id', requireRole(...EDITOR), ah(async (req, res) => {
  try {
    const place = await prisma.places.update({ where: { id: req.params.id }, data: { status: 'ARCHIVED', archived_at: new Date() } });
    logActivity({ adminId: req.admin.id, action: 'place.archive', entityType: 'place', entityId: place.id, summary: `Archived place ${place.slug}`, ip: clientIp(req) });
    ok(res, { archived: true });
  } catch {
    return fail(res, 404, 'Destination not found.', 'NOT_FOUND');
  }
}));

// ---------- Media ----------
const uploadDir = path.join(process.cwd(), 'uploads');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image/* and video/* uploads are accepted.'));
  },
});

function mediaPublicUrl(req, row) {
  if (row.public_url) return row;
  return { ...row, public_url: `${req.protocol}://${req.get('host')}/uploads/${row.storage_key}` };
}

adminRouter.get('/media', requireRole(...EDITOR), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pagination(req);
  const [total, rows] = await Promise.all([
    prisma.media.count(),
    prisma.media.findMany({ orderBy: [{ created_at: 'desc' }], skip, take }),
  ]);
  ok(res, { items: jsonSafe(rows.map((r) => mediaPublicUrl(req, r))), page, pageSize, total });
}));

adminRouter.post('/media', requireRole(...EDITOR), upload.single('file'), ah(async (req, res) => {
  if (!req.file) return fail(res, 400, 'Multipart field "file" is required.', 'VALIDATION_ERROR');
  if (!isCloudinaryConfigured()) {
    return fail(res, 503, 'Media storage is not configured. Contact the site administrator.', 'MEDIA_STORAGE_UNAVAILABLE');
  }

  let asset;
  try {
    asset = await uploadToCloudinary(req.file);
  } catch (error) {
    console.error('Cloudinary media upload failed:', error);
    return fail(res, 502, 'Could not store uploaded media. Please try again.', 'MEDIA_UPLOAD_FAILED');
  }

  let row;
  try {
    row = await prisma.media.create({
      data: {
        storage_provider: 'cloudinary',
        storage_key: asset.storageKey,
        public_url: asset.publicUrl,
        kind: req.file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE',
        mime_type: req.file.mimetype,
        size_bytes: BigInt(asset.sizeBytes),
        alt_i18n: i18nInput(req.body?.alt, ''),
        caption_i18n: i18nInput(req.body?.caption, ''),
        uploaded_by: req.admin.id,
      },
    });
  } catch (error) {
    try {
      await deleteFromCloudinary(asset.storageKey, req.file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE');
    } catch (cleanupError) {
      console.error('Could not clean up Cloudinary asset after database failure:', cleanupError);
    }
    throw error;
  }

  logActivity({ adminId: req.admin.id, action: 'media.upload', entityType: 'media', entityId: row.id, summary: req.file.originalname, ip: clientIp(req) });
  ok(res, jsonSafe(mediaPublicUrl(req, row)), 201);
}));

adminRouter.patch('/media/:id', requireRole(...EDITOR), ah(async (req, res) => {
  const data = {};
  if (req.body?.alt ?? req.body?.alt_i18n) data.alt_i18n = i18nInput(req.body.alt ?? req.body.alt_i18n, '');
  if (req.body?.caption ?? req.body?.caption_i18n) data.caption_i18n = i18nInput(req.body.caption ?? req.body.caption_i18n, '');
  try {
    const row = await prisma.media.update({ where: { id: req.params.id }, data });
    ok(res, jsonSafe(mediaPublicUrl(req, row)));
  } catch {
    return fail(res, 404, 'Media not found.', 'NOT_FOUND');
  }
}));

// Attach/detach library media to tours, places and vehicle types.
const LINK_TARGETS = {
  service: { table: 'service_media', entityColumn: 'service_id' },
  place: { table: 'place_media', entityColumn: 'place_id' },
  vehicle_type: { table: 'vehicle_media', entityColumn: 'vehicle_type_id' },
};

adminRouter.post('/media/links', requireRole(...EDITOR), ah(async (req, res) => {
  const { entity, entity_id, media_id, role, sort_order } = req.body ?? {};
  const target = LINK_TARGETS[String(entity)];
  if (!target || !entity_id || !media_id || !role) {
    return fail(res, 400, 'entity, entity_id, media_id and role are required.', 'VALIDATION_ERROR');
  }
  const delegate = prisma[target.table];
  try {
    const row = await delegate.create({
      data: {
        [target.entityColumn]: String(entity_id),
        media_id: String(media_id),
        role: String(role),
        sort_order: Number.isInteger(sort_order) ? sort_order : 0,
      },
    });
    ok(res, row, 201);
  } catch (e) {
    if (e?.code === 'P2002') return fail(res, 409, 'Media already linked with this role.', 'CONFLICT');
    return fail(res, 500, 'Could not link media.', 'LINK_FAILED');
  }
}));

adminRouter.delete('/media/links', requireRole(...EDITOR), ah(async (req, res) => {
  const { entity, entity_id, media_id, role } = req.body ?? {};
  const target = LINK_TARGETS[String(entity)];
  if (!target || !entity_id || !media_id || !role) {
    return fail(res, 400, 'entity, entity_id, media_id and role are required.', 'VALIDATION_ERROR');
  }
  const delegate = prisma[target.table];
  try {
    const result = await delegate.deleteMany({
      where: {
        [target.entityColumn]: String(entity_id),
        media_id: String(media_id),
        role: String(role),
      },
    });
    if (result.count === 0) {
      return fail(res, 404, 'Media link not found.', 'NOT_FOUND');
    }
    ok(res, { deleted: true });
  } catch {
    return fail(res, 404, 'Media link not found.', 'NOT_FOUND');
  }
}));

adminRouter.delete('/media/:id', requireRole(...EDITOR), ah(async (req, res) => {
  const [s, p, v] = await Promise.all([
    prisma.service_media.count({ where: { media_id: req.params.id } }),
    prisma.place_media.count({ where: { media_id: req.params.id } }),
    prisma.vehicle_media.count({ where: { media_id: req.params.id } }),
  ]);
  if (s + p + v > 0) {
    return fail(res, 409, 'Media is still linked to content. Unlink it first.', 'CONFLICT');
  }
  try {
    const existing = await prisma.media.findUnique({ where: { id: req.params.id } });
    if (!existing) return fail(res, 404, 'Media not found.', 'NOT_FOUND');
    if (existing.storage_provider === 'cloudinary') {
      await deleteFromCloudinary(existing.storage_key, existing.kind);
    } else if (existing.storage_provider !== 'local') {
      return fail(res, 500, 'Media uses an unsupported storage provider.', 'MEDIA_STORAGE_UNSUPPORTED');
    }

    const row = await prisma.media.delete({ where: { id: req.params.id } });
    if (row.storage_provider === 'local') {
      fs.unlink(path.join(uploadDir, row.storage_key), () => {});
    }
    logActivity({ adminId: req.admin.id, action: 'media.delete', entityType: 'media', entityId: req.params.id, ip: clientIp(req) });
    ok(res, { deleted: true });
  } catch (error) {
    if (error?.code === 'P2025') {
      return fail(res, 404, 'Media not found.', 'NOT_FOUND');
    }
    throw error;
  }
}));

// ---------- Vehicles ----------
adminRouter.get('/vehicle-types', requireRole(...EDITOR), ah(async (req, res) => {
  const rows = await prisma.vehicle_types.findMany({ orderBy: [{ sort_order: 'asc' }] });
  ok(res, jsonSafe(rows));
}));

adminRouter.post('/vehicle-types', requireRole(...MANAGER), ah(async (req, res) => {
  const b = req.body ?? {};
  const name = i18nInput(b.name ?? b.name_i18n, '');
  if (!name.en) return fail(res, 400, 'English name is required.', 'VALIDATION_ERROR');
  if (!Number.isInteger(b.passenger_capacity) || b.passenger_capacity <= 0) {
    return fail(res, 400, 'passenger_capacity must be a positive integer.', 'VALIDATION_ERROR');
  }
  const row = await prisma.vehicle_types.create({
    data: {
      slug: String(b.slug || slugify(name.en)),
      name_i18n: name,
      description_i18n: i18nInput(b.description ?? b.description_i18n, ''),
      passenger_capacity: b.passenger_capacity,
      luggage_capacity: b.luggage_capacity ?? null,
      pricing_model: b.pricing_model ?? 'QUOTE_REQUIRED',
      price_from_usd: b.price_from_usd ?? null,
      price_from_lkr: b.price_from_lkr ?? null,
      driver_included: b.driver_included ?? true,
      status: CONTENT_STATUSES.includes(b.status) ? b.status : 'PUBLISHED',
      sort_order: b.sort_order ?? 0,
    },
  });
  logActivity({ adminId: req.admin.id, action: 'vehicle_type.create', entityType: 'vehicle_type', entityId: row.id, ip: clientIp(req) });
  ok(res, jsonSafe(row), 201);
}));

adminRouter.patch('/vehicle-types/:id', requireRole(...MANAGER), ah(async (req, res) => {
  const b = req.body ?? {};
  const data = {};
  if (b.name ?? b.name_i18n) data.name_i18n = i18nInput(b.name ?? b.name_i18n, '');
  if (b.description ?? b.description_i18n) data.description_i18n = i18nInput(b.description ?? b.description_i18n, '');
  for (const k of ['passenger_capacity', 'luggage_capacity', 'price_from_usd', 'price_from_lkr', 'sort_order']) {
    if (b[k] !== undefined) data[k] = b[k];
  }
  if (b.pricing_model) data.pricing_model = b.pricing_model;
  if (b.driver_included !== undefined) data.driver_included = b.driver_included;
  if (b.status && CONTENT_STATUSES.includes(b.status)) data.status = b.status;
  try {
    const row = await prisma.vehicle_types.update({ where: { id: req.params.id }, data });
    ok(res, jsonSafe(row));
  } catch {
    return fail(res, 404, 'Vehicle type not found.', 'NOT_FOUND');
  }
}));

adminRouter.get('/vehicles', requireRole(...EDITOR), ah(async (req, res) => {
  const rows = await prisma.vehicles.findMany({ include: { vehicle_types: true }, orderBy: [{ created_at: 'asc' }] });
  ok(res, jsonSafe(rows));
}));

adminRouter.post('/vehicles', requireRole(...MANAGER), ah(async (req, res) => {  const b = req.body ?? {};
  if (!b.vehicle_type_id) return fail(res, 400, 'vehicle_type_id is required.', 'VALIDATION_ERROR');
  if (!b.display_name) return fail(res, 400, 'display_name is required.', 'VALIDATION_ERROR');
  const row = await prisma.vehicles.create({
    data: {
      vehicle_type_id: b.vehicle_type_id,
      display_name: String(b.display_name),
      internal_code: b.internal_code ?? null,
      registration_number: b.registration_number ?? null,
      passenger_capacity: b.passenger_capacity ?? null,
      luggage_capacity: b.luggage_capacity ?? null,
      status: CONTENT_STATUSES.includes(b.status) ? b.status : 'PUBLISHED',
      operational_notes: b.operational_notes ?? null,
    },
  });
  logActivity({ adminId: req.admin.id, action: 'vehicle.create', entityType: 'vehicle', entityId: row.id, ip: clientIp(req) });
  ok(res, jsonSafe(row), 201);
}));

adminRouter.patch('/vehicles/:id', requireRole(...MANAGER), ah(async (req, res) => {
  const b = req.body ?? {};
  const data = {};
  if (b.vehicle_type_id) data.vehicle_type_id = b.vehicle_type_id;
  if (b.display_name) data.display_name = String(b.display_name);
  if (b.internal_code !== undefined) data.internal_code = b.internal_code || null;
  if (b.registration_number !== undefined) data.registration_number = b.registration_number || null;
  if (b.passenger_capacity !== undefined) data.passenger_capacity = b.passenger_capacity;
  if (b.luggage_capacity !== undefined) data.luggage_capacity = b.luggage_capacity;
  if (b.operational_notes !== undefined) data.operational_notes = b.operational_notes || null;
  if (b.status && CONTENT_STATUSES.includes(b.status)) data.status = b.status;
  try {
    const row = await prisma.vehicles.update({ where: { id: req.params.id }, data });
    logActivity({ adminId: req.admin.id, action: 'vehicle.update', entityType: 'vehicle', entityId: row.id, ip: clientIp(req) });
    ok(res, jsonSafe(row));
  } catch {
    return fail(res, 404, 'Vehicle not found.', 'NOT_FOUND');
  }
}));

adminRouter.delete('/vehicles/:id', requireRole(...EDITOR), ah(async (req, res) => {
  try {
    const row = await prisma.vehicles.update({
      where: { id: req.params.id },
      data: { status: 'ARCHIVED', archived_at: new Date() },
    });
    logActivity({ adminId: req.admin.id, action: 'vehicle.archive', entityType: 'vehicle', entityId: row.id, ip: clientIp(req) });
    ok(res, { archived: true });
  } catch {
    return fail(res, 404, 'Vehicle not found.', 'NOT_FOUND');
  }
}));

// ---------- Availability ----------
adminRouter.get('/availability', requireRole(...EDITOR), ah(async (req, res) => {
  const where = {};
  if (req.query.vehicle_id) where.vehicle_id = String(req.query.vehicle_id);
  if (req.query.vehicle_type_id) where.vehicle_type_id = String(req.query.vehicle_type_id);
  const rows = await prisma.availability_blocks.findMany({ where, orderBy: [{ starts_at: 'asc' }], take: 200 });
  ok(res, jsonSafe(rows));
}));

adminRouter.post('/availability', requireRole(...MANAGER), ah(async (req, res) => {
  const b = req.body ?? {};
  if ((!b.vehicle_id && !b.vehicle_type_id) || !b.starts_at || !b.ends_at) {
    return fail(res, 400, 'vehicle_id or vehicle_type_id plus starts_at/ends_at are required.', 'VALIDATION_ERROR');
  }
  if (new Date(b.ends_at) <= new Date(b.starts_at)) {
    return fail(res, 400, 'ends_at must be after starts_at.', 'VALIDATION_ERROR');
  }
  const row = await prisma.availability_blocks.create({
    data: {
      vehicle_id: b.vehicle_id ?? null,
      vehicle_type_id: b.vehicle_type_id ?? null,
      starts_at: new Date(b.starts_at),
      ends_at: new Date(b.ends_at),
      block_type: ['MAINTENANCE', 'UNAVAILABLE', 'PRIVATE_USE', 'OTHER'].includes(b.block_type) ? b.block_type : 'UNAVAILABLE',
      reason: b.reason ?? null,
      created_by: req.admin.id,
    },
  });
  logActivity({ adminId: req.admin.id, action: 'availability.block', entityType: 'availability_block', entityId: row.id, ip: clientIp(req) });
  ok(res, jsonSafe(row), 201);
}));

adminRouter.delete('/availability/:id', requireRole(...MANAGER), ah(async (req, res) => {
  try {
    await prisma.availability_blocks.delete({ where: { id: req.params.id } });
    ok(res, { deleted: true });
  } catch {
    return fail(res, 404, 'Availability block not found.', 'NOT_FOUND');
  }
}));

// ---------- Bookings (admin) ----------
// Booking code (WW-XXXXXX) vs UUID: only query the matching column, otherwise
// Prisma throws trying to cast a code to UUID instead of falling through.
function bookingWhere(param) {
  const p = String(param ?? '');
  if (/^[0-9a-f-]{36}$/i.test(p)) return { id: p };
  return { booking_code: p.toUpperCase() };
}

const STATUS_TRANSITIONS = {  NEW_REQUEST: ['CONTACT_PENDING', 'QUOTATION_SENT', 'CONFIRMED', 'CANCELLED', 'REJECTED'],
  CONTACT_PENDING: ['QUOTATION_SENT', 'CONFIRMED', 'CANCELLED', 'REJECTED'],
  QUOTATION_SENT: ['CONFIRMED', 'CANCELLED', 'REJECTED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

function dec(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bookingDetail(b, lang = 'en') {
  return {
    ...jsonSafe({
      id: b.id,
      bookingCode: b.booking_code,
      bookingType: b.booking_type,
      customerName: b.customer_name,
      phone: b.phone,
      email: b.email,
      language: b.language,
      travelDate: toDateOnly(b.travel_date),
      returnDate: toDateOnly(b.return_date),
      preferredTime: b.preferred_time,
      pickupLocation: b.pickup_location,
      pickupMapUrl: b.pickup_map_url,
      destinationText: b.destination_text,
      destinationMapUrl: b.destination_map_url,
      tripType: b.trip_type,
      passengers: b.passengers,
      childrenCount: b.children_count,
      luggageCount: b.luggage_count,
      extraRequests: b.extra_requests,
      status: b.status,
      quotedAmount: dec(b.quoted_amount),
      quotedCurrency: b.quoted_currency,
      paymentStatus: b.payment_status,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    }),
    summary: bookingToSummary(b, lang),
    service: b.services ? { id: b.services.id, slug: b.services.slug, title: pickI18n(b.services.title_i18n, lang) } : null,
    vehicleType: b.vehicle_types ? { id: b.vehicle_types.id, slug: b.vehicle_types.slug } : null,
  };
}

adminRouter.get('/bookings', requireRole(...MANAGER), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pagination(req);
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.type) where.booking_type = String(req.query.type);
  if (req.query.search) {
    const q = String(req.query.search).trim();
    where.OR = [
      { booking_code: { equals: q.toUpperCase(), mode: 'insensitive' } },
      { customer_name: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ];
  }
  if (req.query.from || req.query.to) {
    where.travel_date = {};
    if (req.query.from) where.travel_date.gte = new Date(String(req.query.from));
    if (req.query.to) where.travel_date.lte = new Date(String(req.query.to));
  }
  const [total, rows] = await Promise.all([
    prisma.bookings.count({ where }),
    prisma.bookings.findMany({
      where,
      include: { services: true, vehicle_types: true },
      orderBy: [{ created_at: 'desc' }],
      skip, take,
    }),
  ]);
  ok(res, { items: rows.map((b) => bookingDetail(b)), page, pageSize, total });
}));

adminRouter.get('/bookings/:id', requireRole(...MANAGER), ah(async (req, res) => {
  const b = await prisma.bookings.findFirst({
    where: bookingWhere(req.params.id),
    include: {
      services: true,
      vehicle_types: true,
      booking_notes: { orderBy: [{ created_at: 'desc' }] },
      booking_status_history: { orderBy: [{ created_at: 'desc' }] },
      booking_quote_history: { orderBy: [{ created_at: 'desc' }] },
    },
  });
  if (!b) return fail(res, 404, 'Booking not found.', 'NOT_FOUND');
  const quoteHistory = (b.booking_quote_history ?? []).map((q) => ({
    ...jsonSafe(q),
    old_amount: q.old_amount == null ? null : Number(q.old_amount),
    new_amount: Number(q.new_amount),
  }));
  ok(res, { ...bookingDetail(b), notes: jsonSafe(b.booking_notes), statusHistory: jsonSafe(b.booking_status_history), quoteHistory });
}));

adminRouter.patch('/bookings/:id/status', requireRole(...MANAGER), ah(async (req, res) => {
  const next = String(req.body?.status ?? '');
  const reason = req.body?.reason ? String(req.body.reason) : null;
  if (!Object.keys(STATUS_TRANSITIONS).includes(next)) {
    return fail(res, 400, 'Unknown status.', 'VALIDATION_ERROR');
  }
  const booking = await prisma.bookings.findFirst({
    where: bookingWhere(req.params.id),
  });
  if (!booking) return fail(res, 404, 'Booking not found.', 'NOT_FOUND');
  if (!STATUS_TRANSITIONS[booking.status].includes(next)) {
    return fail(res, 409, `Cannot move booking from ${booking.status} to ${next}.`, 'CONFLICT');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.bookings.update({ where: { id: booking.id }, data: { status: next }, include: { services: true, vehicle_types: true } });
    await tx.booking_status_history.create({
      data: { booking_id: booking.id, old_status: booking.status, new_status: next, reason, changed_by: req.admin.id },
    });
    return b;
  });
  logActivity({ adminId: req.admin.id, action: 'booking.status', entityType: 'booking', entityId: booking.id, summary: `${booking.booking_code}: ${booking.status} -> ${next}`, ip: clientIp(req) });
  ok(res, bookingDetail(updated));
}));

adminRouter.patch('/bookings/:id/final-quote', requireRole(...MANAGER), ah(async (req, res) => {
  const amount = Number(req.body?.amount);
  const currency = String(req.body?.currency ?? '').toUpperCase();
  if (!Number.isFinite(amount) || amount < 0) return fail(res, 400, 'amount must be >= 0.', 'VALIDATION_ERROR');
  if (!['USD', 'LKR'].includes(currency)) return fail(res, 400, 'currency must be USD or LKR.', 'VALIDATION_ERROR');
  const booking = await prisma.bookings.findFirst({
    where: bookingWhere(req.params.id),
  });
  if (!booking) return fail(res, 404, 'Booking not found.', 'NOT_FOUND');
  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.bookings.update({
      where: { id: booking.id },
      data: { quoted_amount: amount, quoted_currency: currency },
      include: { services: true, vehicle_types: true },
    });
    await tx.booking_quote_history.create({
      data: {
        booking_id: booking.id,
        old_amount: booking.quoted_amount,
        old_currency: booking.quoted_currency,
        new_amount: amount,
        new_currency: currency,
        notes: req.body?.notes ? String(req.body.notes) : null,
        changed_by: req.admin.id,
      },
    });
    return b;
  });
  logActivity({ adminId: req.admin.id, action: 'booking.quote', entityType: 'booking', entityId: booking.id, summary: `${booking.booking_code}: quote ${amount} ${currency}`, ip: clientIp(req) });
  ok(res, bookingDetail(updated));
}));

adminRouter.post('/bookings/:id/notes', requireRole(...MANAGER), ah(async (req, res) => {
  const note = String(req.body?.note ?? '').trim();
  if (!note) return fail(res, 400, 'note is required.', 'VALIDATION_ERROR');
  const booking = await prisma.bookings.findFirst({
    where: bookingWhere(req.params.id),
  });
  if (!booking) return fail(res, 404, 'Booking not found.', 'NOT_FOUND');
  const row = await prisma.booking_notes.create({
    data: { booking_id: booking.id, admin_id: req.admin.id, note },
  });
  ok(res, jsonSafe(row), 201);
}));

// ---------- Reviews moderation ----------
adminRouter.get('/reviews', requireRole(...EDITOR), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pagination(req);
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  const [total, rows] = await Promise.all([
    prisma.reviews.count({ where }),
    prisma.reviews.findMany({ where, include: { bookings: true }, orderBy: [{ created_at: 'desc' }], skip, take }),
  ]);
  ok(res, { items: jsonSafe(rows), page, pageSize, total });
}));

adminRouter.patch('/reviews/:id', requireRole(...EDITOR), ah(async (req, res) => {
  const status = String(req.body?.status ?? '');
  if (!['APPROVED', 'REJECTED', 'HIDDEN', 'PENDING'].includes(status)) {
    return fail(res, 400, 'Unknown moderation status.', 'VALIDATION_ERROR');
  }
  try {
    const row = await prisma.reviews.update({
      where: { id: req.params.id },
      data: {
        status,
        moderated_by: req.admin.id,
        moderated_at: new Date(),
        moderation_note: req.body?.moderation_note ? String(req.body.moderation_note) : null,
      },
    });
    logActivity({ adminId: req.admin.id, action: 'review.moderate', entityType: 'review', entityId: row.id, summary: `Review ${status}`, ip: clientIp(req) });
    ok(res, jsonSafe(row));
  } catch {
    return fail(res, 404, 'Review not found.', 'NOT_FOUND');
  }
}));

adminRouter.delete('/reviews/:id', requireRole(...MANAGER), ah(async (req, res) => {
  try {
    await prisma.reviews.delete({ where: { id: req.params.id } });
    ok(res, { deleted: true });
  } catch {
    return fail(res, 404, 'Review not found.', 'NOT_FOUND');
  }
}));

// ---------- FAQs ----------
adminRouter.get('/faqs', requireRole(...EDITOR), ah(async (req, res) => {
  const rows = await prisma.faqs.findMany({ orderBy: [{ sort_order: 'asc' }] });
  ok(res, jsonSafe(rows));
}));

adminRouter.post('/faqs', requireRole(...EDITOR), ah(async (req, res) => {
  const b = req.body ?? {};
  const question = i18nInput(b.question ?? b.question_i18n, '');
  const answer = i18nInput(b.answer ?? b.answer_i18n, '');
  if (!question.en || !answer.en) return fail(res, 400, 'English question and answer are required.', 'VALIDATION_ERROR');
  const row = await prisma.faqs.create({
    data: {
      question_i18n: question,
      answer_i18n: answer,
      category: b.category ?? null,
      status: CONTENT_STATUSES.includes(b.status) ? b.status : 'DRAFT',
      sort_order: b.sort_order ?? 0,
    },
  });
  ok(res, jsonSafe(row), 201);
}));

adminRouter.patch('/faqs/:id', requireRole(...EDITOR), ah(async (req, res) => {
  const b = req.body ?? {};
  const data = {};
  if (b.question ?? b.question_i18n) data.question_i18n = i18nInput(b.question ?? b.question_i18n, '');
  if (b.answer ?? b.answer_i18n) data.answer_i18n = i18nInput(b.answer ?? b.answer_i18n, '');
  if (b.category !== undefined) data.category = b.category;
  if (b.status && CONTENT_STATUSES.includes(b.status)) data.status = b.status;
  if (b.sort_order !== undefined) data.sort_order = b.sort_order;
  try {
    const row = await prisma.faqs.update({ where: { id: req.params.id }, data });
    ok(res, jsonSafe(row));
  } catch {
    return fail(res, 404, 'FAQ not found.', 'NOT_FOUND');
  }
}));

adminRouter.delete('/faqs/:id', requireRole(...EDITOR), ah(async (req, res) => {
  try {
    await prisma.faqs.delete({ where: { id: req.params.id } });
    ok(res, { deleted: true });
  } catch {
    return fail(res, 404, 'FAQ not found.', 'NOT_FOUND');
  }
}));

// ---------- Settings + exchange rates ----------
adminRouter.get('/settings', requireRole(...EDITOR), ah(async (_req, res) => {
  const rows = await prisma.site_settings.findMany({ orderBy: [{ setting_key: 'asc' }] });
  ok(res, jsonSafe(rows));
}));

adminRouter.patch('/settings', requireRole(...MANAGER), ah(async (req, res) => {
  const entries = req.body?.settings;
  if (!entries || typeof entries !== 'object') {
    return fail(res, 400, 'settings object is required.', 'VALIDATION_ERROR');
  }
  const keys = Object.keys(entries).slice(0, 50);
  await prisma.$transaction(
    keys.map((key) =>
      prisma.site_settings.upsert({
        where: { setting_key: key },
        create: { setting_key: key, setting_value: entries[key] ?? null, is_public: false, updated_by: req.admin.id },
        update: { setting_value: entries[key] ?? null, updated_by: req.admin.id },
      }),
    ),
  );
  logActivity({ adminId: req.admin.id, action: 'settings.update', summary: `Updated ${keys.length} settings`, ip: clientIp(req) });
  const rows = await prisma.site_settings.findMany({ where: { setting_key: { in: keys } } });
  ok(res, jsonSafe(rows));
}));

adminRouter.get('/exchange-rates', requireRole(...EDITOR), ah(async (_req, res) => {
  const rows = await prisma.exchange_rates.findMany({ orderBy: [{ effective_at: 'desc' }], take: 20 });
  ok(res, jsonSafe(rows));
}));

adminRouter.post('/exchange-rates', requireRole(...MANAGER), ah(async (req, res) => {
  const b = req.body ?? {};
  const base = String(b.base_currency ?? '').toUpperCase();
  const quote = String(b.quote_currency ?? '').toUpperCase();
  const rate = Number(b.rate);
  if (base.length !== 3 || quote.length !== 3 || base === quote) {
    return fail(res, 400, 'Two different 3-letter currencies are required.', 'VALIDATION_ERROR');
  }
  if (!Number.isFinite(rate) || rate <= 0) return fail(res, 400, 'rate must be > 0.', 'VALIDATION_ERROR');
  const row = await prisma.exchange_rates.create({
    data: { base_currency: base, quote_currency: quote, rate, source: b.source ?? null, created_by: req.admin.id },
  });
  ok(res, jsonSafe(row), 201);
}));

// ---------- Activity log (read-only) ----------
adminRouter.get('/activity-log', requireRole(...MANAGER), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pagination(req);
  const [total, rows] = await Promise.all([
    prisma.activity_logs.count(),
    prisma.activity_logs.findMany({ orderBy: [{ created_at: 'desc' }], skip, take }),
  ]);
  ok(res, { items: jsonSafe(rows), page, pageSize, total });
}));

// ---------- Admin accounts (owner only) ----------
adminRouter.get('/admins', requireRole('OWNER'), ah(async (_req, res) => {
  const rows = await prisma.admins.findMany({ orderBy: [{ created_at: 'asc' }] });
  ok(res, rows.map((a) => jsonSafe({ id: a.id, email: a.email, name: a.display_name, role: a.role, isActive: a.is_active, lastLoginAt: a.last_login_at, createdAt: a.created_at })));
}));

adminRouter.post('/admins', requireRole('OWNER'), ah(async (req, res) => {
  const email = String(req.body?.email ?? '').trim();
  const name = String(req.body?.name ?? req.body?.display_name ?? '').trim();
  const password = String(req.body?.password ?? '');
  const role = String(req.body?.role ?? 'ADMIN').toUpperCase();
  if (name.length < 2) return fail(res, 400, 'Display name is required.', 'VALIDATION_ERROR');
  if (password.length < 10) return fail(res, 400, 'Password must be 10+ characters.', 'VALIDATION_ERROR');
  if (!['OWNER', 'ADMIN', 'EDITOR'].includes(role)) return fail(res, 400, 'Unknown role.', 'VALIDATION_ERROR');
  // The address must belong to a domain that can really receive mail (e.g. gmail.com).
  const deliverable = await validateAdminEmail(email);
  if (!deliverable.ok) {
    return fail(res, 400, deliverable.reason, 'VALIDATION_ERROR', { email: deliverable.reason });
  }
  const existing = await prisma.admins.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (existing) return fail(res, 409, 'An admin with that email already exists.', 'CONFLICT');
  const row = await prisma.admins.create({
    data: { email, display_name: name, password_hash: await bcrypt.hash(password, 10), role },
  });
  logActivity({ adminId: req.admin.id, action: 'admin.create', entityType: 'admin', entityId: row.id, summary: `Created ${email} (${role})`, ip: clientIp(req) });
  ok(res, { id: row.id, email: row.email, name: row.display_name, role: row.role }, 201);
}));

adminRouter.patch('/admins/:id', requireRole('OWNER'), ah(async (req, res) => {
  if (req.params.id === req.admin.id && (req.body?.is_active === false || req.body?.isActive === false)) {
    return fail(res, 400, 'You cannot deactivate your own account.', 'VALIDATION_ERROR');
  }
  const data = {};
  if (req.body?.name) data.display_name = String(req.body.name);
  if (req.body?.role && ['OWNER', 'ADMIN', 'EDITOR'].includes(String(req.body.role).toUpperCase())) {
    data.role = String(req.body.role).toUpperCase();
  }
  if (req.body?.is_active ?? req.body?.isActive !== undefined) data.is_active = req.body.is_active ?? req.body.isActive;
  if (req.body?.password && String(req.body.password).length >= 10) {
    data.password_hash = await bcrypt.hash(String(req.body.password), 10);
    data.password_changed_at = new Date();
  }
  try {
    const row = await prisma.admins.update({ where: { id: req.params.id }, data });
    logActivity({ adminId: req.admin.id, action: 'admin.update', entityType: 'admin', entityId: row.id, summary: `Updated ${row.email}`, ip: clientIp(req) });
    ok(res, { id: row.id, email: row.email, name: row.display_name, role: row.role, isActive: row.is_active });
  } catch {
    return fail(res, 404, 'Admin not found.', 'NOT_FOUND');
  }
}));

// ---------- Reports ----------
adminRouter.get('/reports', requireRole(...MANAGER), ah(async (req, res) => {
  const [byStatus, upcoming, pendingReviews, totalTours] = await Promise.all([
    prisma.bookings.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.bookings.count({ where: { travel_date: { gte: new Date() }, status: { in: ['NEW_REQUEST', 'CONTACT_PENDING', 'QUOTATION_SENT', 'CONFIRMED'] } } }),
    prisma.reviews.count({ where: { status: 'PENDING' } }),
    prisma.services.count({ where: { status: 'PUBLISHED' } }),
  ]);
  ok(res, jsonSafe({
    bookingsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count.status])),
    upcomingActiveBookings: upcoming,
    pendingReviews,
    publishedTours: totalTours,
  }));
}));

adminRouter.get('/reports/export.csv', requireRole(...MANAGER), ah(async (req, res) => {
  const rows = await prisma.bookings.findMany({
    include: { services: true },
    orderBy: [{ created_at: 'desc' }],
    take: 1000,
  });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    'booking_code,status,booking_type,customer_name,phone,travel_date,passengers,service,created_at',
    ...rows.map((b) =>
      [
        esc(b.booking_code), esc(b.status), esc(b.booking_type), esc(b.customer_name), esc(b.phone),
        esc(toDateOnly(b.travel_date)), esc(b.passengers),
        esc(b.services ? pickI18n(b.services.title_i18n) : ''), esc(b.created_at.toISOString()),
      ].join(','),
    ),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wander-wheels-bookings.csv"');
  res.send(lines.join('\n'));
}));

// ---------- Operations ----------
adminRouter.get('/operations/status', requireRole(...MANAGER), ah(async (req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  ok(res, { db: 'connected', uptimeSeconds: Math.round(process.uptime()), node: process.version });
}));

adminRouter.get('/operations/backups', requireRole(...MANAGER), ah(async (_req, res) => {
  const rows = await prisma.backup_jobs.findMany({ orderBy: [{ created_at: 'desc' }], take: 50 });
  ok(res, jsonSafe(rows));
}));

// Records a backup-job request row only. Binary backup/restore itself is an
// ops task (pg_dump to offsite storage) and is NOT performed by this endpoint.
adminRouter.post('/operations/backups', requireRole('OWNER'), ah(async (req, res) => {
  const row = await prisma.backup_jobs.create({
    data: { status: 'QUEUED', created_by: req.admin.id },
  });
  logActivity({ adminId: req.admin.id, action: 'backup.request', entityType: 'backup_job', entityId: row.id, ip: clientIp(req) });
  ok(res, { ...jsonSafe(row), note: 'Job recorded as QUEUED. Binary backup to offsite storage is not performed by the API.' }, 201);
}));

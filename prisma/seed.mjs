// Idempotent local seed: owner admin + demo catalog matching the frontend.
// Run: npm run seed
// Env: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (dev only defaults below).
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const L = (en) => ({ en });

async function upsertCategory(slug, name) {
  return prisma.tour_categories.upsert({
    where: { slug },
    create: { slug, name_i18n: L(name), status: 'PUBLISHED' },
    update: { name_i18n: L(name), status: 'PUBLISHED' },
  });
}

async function upsertService(data, categorySlugs = [], placeSlugs = []) {
  const svc = await prisma.services.upsert({
    where: { slug: data.slug },
    create: { ...data, status: 'PUBLISHED' },
    update: { ...data, status: 'PUBLISHED', archived_at: null },
  });
  for (const slug of categorySlugs) {
    const cat = await prisma.tour_categories.findUnique({ where: { slug } });
    if (cat) {
      await prisma.service_categories.upsert({
        where: { service_id_category_id: { service_id: svc.id, category_id: cat.id } },
        create: { service_id: svc.id, category_id: cat.id },
        update: {},
      });
    }
  }
  await prisma.service_places.deleteMany({ where: { service_id: svc.id } });
  for (const [i, slug] of placeSlugs.entries()) {
    const place = await prisma.places.findUnique({ where: { slug } });
    if (place) {
      await prisma.service_places.create({
        data: { service_id: svc.id, place_id: place.id, sort_order: i },
      });
    }
  }
  return svc;
}

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (process.env.NODE_ENV === 'production' && (!email || !password)) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set before seeding in production.');
  }
  const adminEmail = email || 'admin@wanderwheels.local';
  const adminPassword = password || 'WanderWheels!123';
  const existing = await prisma.admins.findFirst({ where: { email: { equals: adminEmail, mode: 'insensitive' } } });
  if (!existing) {
    await prisma.admins.create({
      data: {
        email: adminEmail,
        display_name: 'Site Owner',
        password_hash: await bcrypt.hash(adminPassword, 10),
        role: 'OWNER',
      },
    });
    console.log(`created owner admin ${adminEmail}`);
  } else {
    console.log(`owner admin already exists (${existing.email})`);
  }

  await upsertCategory('wildlife', 'Wildlife');
  await upsertCategory('city', 'City');
  await upsertCategory('beach', 'Beach');
  await upsertCategory('transfer', 'Transfers');

  const places = [
    ['koneswaram-temple', 'Koneswaram Temple', 'Historic temple with coastal views in Trincomalee.', true],
    ['fort-frederick', 'Fort Frederick', 'Explore a historic fort and the surrounding area.', false],
    ['deer-park', 'Deer Park', 'A popular stop for visitors exploring Trincomalee.', false],
    ['kanniya-hot-springs', 'Kanniya Hot Water Springs', 'Optional stop on a Trincomalee city tour.', false],
    ['arisimale-beach', 'Arisimale Beach', 'A coastal destination for a beach and nature trip.', true],
    ['karadi-malai-beach', 'Karadi Malai Beach', 'Ask the team about route and availability before booking.', false],
    ['nilaveli-wildlife', 'Nilaveli Wildlife Experience', 'Local wildlife and nature experience arranged with the team.', true],
  ];
  for (const [i, [slug, name, desc, featured]] of places.entries()) {
    await prisma.places.upsert({
      where: { slug },
      create: {
        slug, name_i18n: L(name), short_description_i18n: L(desc), description_i18n: L(desc),
        region: 'Trincomalee, Sri Lanka', status: 'PUBLISHED', is_featured: featured, sort_order: i,
      },
      update: { name_i18n: L(name), status: 'PUBLISHED', archived_at: null },
    });
  }

  await upsertService(
    {
      slug: 'nilaveli-wildlife-tours', service_type: 'TOUR',
      title_i18n: L('Nilaveli Wildlife Tours'),
      short_description_i18n: L('Explore the nature and wildlife around Nilaveli with a local tour arranged around your group.'),
      description_i18n: L('Explore the nature and wildlife around Nilaveli with a local tour arranged around your group.'),
      pricing_model: 'PER_PERSON', price_from_usd: 15, max_passengers: 12,
      is_featured: true, sort_order: 0,
    },
    ['wildlife'], ['nilaveli-wildlife'],
  );
  await upsertService(
    {
      slug: 'trincomalee-city-tours', service_type: 'TOUR',
      title_i18n: L('Trincomalee City Tours'),
      short_description_i18n: L('Discover Trincomalee landmarks, coastal views and local history.'),
      description_i18n: L('Discover Trincomalee landmarks, coastal views and local history. Kanniya Hot Water Springs can be included as an optional stop.'),
      pricing_model: 'PER_PERSON', price_from_usd: 18, max_passengers: 12,
      is_featured: true, sort_order: 1,
    },
    ['city'], ['koneswaram-temple', 'fort-frederick', 'deer-park', 'kanniya-hot-springs'],
  );
  await upsertService(
    {
      slug: 'beach-and-nature-tours', service_type: 'TOUR',
      title_i18n: L('Beach & Nature Tours'),
      short_description_i18n: L('Spend time exploring the beaches and natural scenery around Trincomalee.'),
      description_i18n: L('Spend time exploring the beaches and natural scenery around Trincomalee.'),
      pricing_model: 'PER_PERSON', price_from_usd: 25, max_passengers: 12,
      is_featured: true, sort_order: 2,
    },
    ['beach'], ['arisimale-beach', 'karadi-malai-beach'],
  );
  await upsertService(
    {
      slug: 'transfers-and-taxi-service', service_type: 'TRANSFER',
      title_i18n: L('Transfers & Taxi Service'),
      short_description_i18n: L('Request tuk-tuk, private car or van transfers. Final availability and price are confirmed by the admin.'),
      description_i18n: L('Request tuk-tuk, private car or van transfers, airport pickup/drop-off and hotel-to-hotel transfers. Final availability and price are confirmed by the admin.'),
      pricing_model: 'QUOTE_REQUIRED',
      is_featured: true, sort_order: 3,
    },
    ['transfer'], [],
  );

  const vehicles = [
    ['auto-tuk-tuk', 'Auto / Tuk-tuk', 'Main vehicle. Planning estimate: up to 3 passengers per auto.', 3, 1],
    ['private-car', 'Private car', 'Available on request, subject to availability.', 4, 2],
    ['van', 'Van', 'Available on request for larger groups, subject to availability.', 8, 8],
  ];
  for (const [i, [slug, name, desc, cap, lug]] of vehicles.entries()) {
    await prisma.vehicle_types.upsert({
      where: { slug },
      create: {
        slug, name_i18n: L(name), description_i18n: L(desc),
        passenger_capacity: cap, luggage_capacity: lug,
        pricing_model: 'QUOTE_REQUIRED', driver_included: true,
        status: 'PUBLISHED', sort_order: i,
      },
      update: { name_i18n: L(name), status: 'PUBLISHED' },
    });
  }

  const faqs = [
    ['Is my booking confirmed when I submit the form?', 'No. The form creates a booking request. Your booking is confirmed only after the WANDER WHEELS admin checks availability and confirms the final price with you.'],
    ['How is the final price decided?', 'The website displays starting prices where available. The admin confirms the final price and currency based on your date, group size, route and service.'],
    ['Can I request a group discount?', 'Yes. Groups with more than six passengers, or groups needing multiple autos, can ask the admin about a discount.'],
    ['How many passengers fit in one auto?', 'The planning estimate is up to three passengers per auto. The admin confirms the final vehicle count and availability.'],
    ['How can I change or cancel a booking?', 'Contact the admin by WhatsApp or phone. The admin will verify the request and update the booking status.'],
    ['Can I pay online?', 'Online payment is not available on this website. Ask the admin about accepted payment methods and any advance payment for your booking.'],
  ];
  const existingFaqs = await prisma.faqs.count();
  if (existingFaqs === 0) {
    for (const [i, [q, a]] of faqs.entries()) {
      await prisma.faqs.create({
        data: { question_i18n: L(q), answer_i18n: L(a), status: 'PUBLISHED', sort_order: i },
      });
    }
  }

  const settings = {
    contact_phone: '+94716240412',
    whatsapp_number: '94716240412',
    supported_currencies: ['USD', 'LKR'],
    group_discount_note: 'Groups over 6 passengers or needing multiple autos may ask the admin about a discount. Discounts are approved by the admin in the final quote.',
    vehicle_policy_note: 'Main vehicle: auto/tuk-tuk, up to 3 passengers per auto. Cars and vans on request, subject to availability.',
    privacy_policy_version: '2026-10-01',
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.site_settings.upsert({
      where: { setting_key: key },
      create: { setting_key: key, setting_value: value, is_public: true },
      update: { setting_value: value, is_public: true },
    });
  }

  console.log('seed complete: catalog, vehicles, FAQs, public settings');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

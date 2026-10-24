-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('OWNER', 'ADMIN', 'EDITOR');

-- CreateEnum
CREATE TYPE "availability_block_type" AS ENUM ('MAINTENANCE', 'UNAVAILABLE', 'PRIVATE_USE', 'OTHER');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('NEW_REQUEST', 'CONTACT_PENDING', 'QUOTATION_SENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "booking_type" AS ENUM ('TOUR', 'VEHICLE', 'TRANSFER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "content_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "media_kind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "moderation_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "pricing_model" AS ENUM ('PER_PERSON', 'PER_BOOKING', 'PER_VEHICLE', 'PER_HOUR', 'PER_DAY', 'PER_DISTANCE', 'QUOTE_REQUIRED');

-- CreateEnum
CREATE TYPE "service_type" AS ENUM ('TOUR', 'TRANSFER', 'EXPERIENCE', 'CUSTOM');

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" BIGSERIAL NOT NULL,
    "admin_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "summary" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6),
    "ip_address" INET,
    "user_agent" TEXT,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "admin_role" NOT NULL DEFAULT 'ADMIN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID,
    "vehicle_type_id" UUID,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "block_type" "availability_block_type" NOT NULL DEFAULT 'UNAVAILABLE',
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" TEXT NOT NULL,
    "storage_key" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "error_summary" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "admin_id" UUID,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_quote_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "old_amount" DECIMAL(12,2),
    "old_currency" CHAR(3),
    "new_amount" DECIMAL(12,2) NOT NULL,
    "new_currency" CHAR(3) NOT NULL,
    "notes" TEXT,
    "changed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_quote_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "old_status" "booking_status",
    "new_status" "booking_status" NOT NULL,
    "reason" TEXT,
    "changed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_code" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "booking_type" "booking_type" NOT NULL,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "service_id" UUID,
    "vehicle_type_id" UUID,
    "requested_vehicle_id" UUID,
    "travel_date" DATE NOT NULL,
    "return_date" DATE,
    "preferred_time" TIME(6),
    "pickup_location" TEXT NOT NULL,
    "pickup_map_url" TEXT,
    "destination_text" TEXT,
    "destination_map_url" TEXT,
    "trip_type" TEXT,
    "passengers" INTEGER NOT NULL,
    "children_count" INTEGER NOT NULL DEFAULT 0,
    "luggage_count" INTEGER,
    "requested_duration_minutes" INTEGER,
    "extra_requests" TEXT,
    "status" "booking_status" NOT NULL DEFAULT 'NEW_REQUEST',
    "quoted_amount" DECIMAL(12,2),
    "quoted_currency" CHAR(3),
    "payment_status" "payment_status" NOT NULL DEFAULT 'NOT_REQUIRED',
    "privacy_consent_at" TIMESTAMPTZ(6),
    "privacy_policy_version" TEXT,
    "customer_source" TEXT NOT NULL DEFAULT 'WEBSITE',
    "internal_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" TEXT,
    "effective_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "question_i18n" JSONB NOT NULL,
    "answer_i18n" JSONB NOT NULL,
    "category" TEXT,
    "status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "public_url" TEXT,
    "kind" "media_kind" NOT NULL DEFAULT 'IMAGE',
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "width_px" INTEGER,
    "height_px" INTEGER,
    "alt_i18n" JSONB NOT NULL DEFAULT '{}',
    "caption_i18n" JSONB NOT NULL DEFAULT '{}',
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_media" (
    "place_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'GALLERY',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "place_media_pkey" PRIMARY KEY ("place_id","media_id","role")
);

-- CreateTable
CREATE TABLE "places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "short_description_i18n" JSONB NOT NULL DEFAULT '{}',
    "description_i18n" JSONB NOT NULL DEFAULT '{}',
    "address_i18n" JSONB NOT NULL DEFAULT '{}',
    "region" TEXT,
    "country_code" CHAR(2) NOT NULL DEFAULT 'LK',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "map_url" TEXT,
    "suggested_duration_minutes" INTEGER,
    "visitor_tips_i18n" JSONB NOT NULL DEFAULT '{}',
    "best_time_i18n" JSONB NOT NULL DEFAULT '{}',
    "status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "seo_title_i18n" JSONB NOT NULL DEFAULT '{}',
    "seo_description_i18n" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID,
    "public_name" TEXT NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "status" "moderation_status" NOT NULL DEFAULT 'PENDING',
    "moderated_by" UUID,
    "moderated_at" TIMESTAMPTZ(6),
    "moderation_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "service_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("service_id","category_id")
);

-- CreateTable
CREATE TABLE "service_media" (
    "service_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'GALLERY',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_media_pkey" PRIMARY KEY ("service_id","media_id","role")
);

-- CreateTable
CREATE TABLE "service_places" (
    "service_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_places_pkey" PRIMARY KEY ("service_id","place_id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "service_type" "service_type" NOT NULL,
    "title_i18n" JSONB NOT NULL,
    "short_description_i18n" JSONB NOT NULL DEFAULT '{}',
    "description_i18n" JSONB NOT NULL DEFAULT '{}',
    "duration_minutes" INTEGER,
    "pricing_model" "pricing_model" NOT NULL DEFAULT 'QUOTE_REQUIRED',
    "price_from_usd" DECIMAL(12,2),
    "price_from_lkr" DECIMAL(14,2),
    "currency" CHAR(3),
    "includes_i18n" JSONB NOT NULL DEFAULT '{}',
    "excludes_i18n" JSONB NOT NULL DEFAULT '{}',
    "highlights_i18n" JSONB NOT NULL DEFAULT '{}',
    "cancellation_policy_i18n" JSONB NOT NULL DEFAULT '{}',
    "minimum_advance_hours" INTEGER NOT NULL DEFAULT 0,
    "max_passengers" INTEGER,
    "status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "seo_title_i18n" JSONB NOT NULL DEFAULT '{}',
    "seo_description_i18n" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "setting_key" TEXT NOT NULL,
    "setting_value" JSONB NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("setting_key")
);

-- CreateTable
CREATE TABLE "tour_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "description_i18n" JSONB NOT NULL DEFAULT '{}',
    "status" "content_status" NOT NULL DEFAULT 'PUBLISHED',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_media" (
    "vehicle_type_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'GALLERY',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vehicle_media_pkey" PRIMARY KEY ("vehicle_type_id","media_id","role")
);

-- CreateTable
CREATE TABLE "vehicle_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "description_i18n" JSONB NOT NULL DEFAULT '{}',
    "passenger_capacity" INTEGER NOT NULL,
    "luggage_capacity" INTEGER,
    "pricing_model" "pricing_model" NOT NULL DEFAULT 'QUOTE_REQUIRED',
    "price_from_usd" DECIMAL(12,2),
    "price_from_lkr" DECIMAL(14,2),
    "driver_included" BOOLEAN NOT NULL DEFAULT true,
    "status" "content_status" NOT NULL DEFAULT 'PUBLISHED',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_type_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "internal_code" TEXT,
    "registration_number" TEXT,
    "passenger_capacity" INTEGER,
    "luggage_capacity" INTEGER,
    "status" "content_status" NOT NULL DEFAULT 'PUBLISHED',
    "operational_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_admin_idx" ON "activity_logs"("admin_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_created_idx" ON "activity_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_entity_idx" ON "activity_logs"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_idx" ON "admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "admin_sessions_expiry_idx" ON "admin_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "availability_blocks_type_time_idx" ON "availability_blocks"("vehicle_type_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "availability_blocks_vehicle_time_idx" ON "availability_blocks"("vehicle_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "booking_notes_booking_idx" ON "booking_notes"("booking_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "booking_quote_history_booking_idx" ON "booking_quote_history"("booking_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "booking_status_history_booking_idx" ON "booking_status_history"("booking_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_code_key" ON "bookings"("booking_code");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_idempotency_key_key" ON "bookings"("idempotency_key");

-- CreateIndex
CREATE INDEX "bookings_created_idx" ON "bookings"("created_at" DESC);

-- CreateIndex
CREATE INDEX "bookings_date_status_idx" ON "bookings"("travel_date", "status");

-- CreateIndex
CREATE INDEX "bookings_phone_idx" ON "bookings"("phone");

-- CreateIndex
CREATE INDEX "bookings_service_date_idx" ON "bookings"("service_id", "travel_date");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "bookings_type_date_idx" ON "bookings"("booking_type", "travel_date");

-- CreateIndex
CREATE INDEX "bookings_vehicle_date_idx" ON "bookings"("requested_vehicle_id", "travel_date");

-- CreateIndex
CREATE INDEX "exchange_rates_pair_date_idx" ON "exchange_rates"("base_currency", "quote_currency", "effective_at" DESC);

-- CreateIndex
CREATE INDEX "faqs_public_order_idx" ON "faqs"("status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "media_storage_provider_storage_key_key" ON "media"("storage_provider", "storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_expiry_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "place_media_order_idx" ON "place_media"("place_id", "role", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "places_slug_key" ON "places"("slug");

-- CreateIndex
CREATE INDEX "places_public_listing_idx" ON "places"("status", "is_featured", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"("booking_id");

-- CreateIndex
CREATE INDEX "reviews_public_idx" ON "reviews"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_rating_idx" ON "reviews"("rating");

-- CreateIndex
CREATE INDEX "service_media_order_idx" ON "service_media"("service_id", "role", "sort_order");

-- CreateIndex
CREATE INDEX "service_places_place_idx" ON "service_places"("place_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");

-- CreateIndex
CREATE INDEX "services_public_listing_idx" ON "services"("status", "service_type", "is_featured", "sort_order");

-- CreateIndex
CREATE INDEX "services_type_idx" ON "services"("service_type");

-- CreateIndex
CREATE UNIQUE INDEX "tour_categories_slug_key" ON "tour_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_types_slug_key" ON "vehicle_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_internal_code_key" ON "vehicles"("internal_code");

-- CreateIndex
CREATE INDEX "vehicles_type_status_idx" ON "vehicles"("vehicle_type_id", "status");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_notes" ADD CONSTRAINT "booking_notes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_notes" ADD CONSTRAINT "booking_notes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_quote_history" ADD CONSTRAINT "booking_quote_history_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_quote_history" ADD CONSTRAINT "booking_quote_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_requested_vehicle_id_fkey" FOREIGN KEY ("requested_vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "place_media" ADD CONSTRAINT "place_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "place_media" ADD CONSTRAINT "place_media_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_fkey" FOREIGN KEY ("moderated_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "tour_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_media" ADD CONSTRAINT "service_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_media" ADD CONSTRAINT "service_media_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_places" ADD CONSTRAINT "service_places_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_places" ADD CONSTRAINT "service_places_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehicle_media" ADD CONSTRAINT "vehicle_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehicle_media" ADD CONSTRAINT "vehicle_media_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

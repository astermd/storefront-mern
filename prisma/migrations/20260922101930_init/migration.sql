-- CreateTable
CREATE TABLE "sessions" (
    "session_uuid" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT,
    "journey_state" TEXT NOT NULL,
    "attribution" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_uuid" TEXT,
    "provider_reference" TEXT NOT NULL,
    "anchor_slug" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "treatment_reference" TEXT,
    "verification_status" TEXT,
    "verification_at" TEXT,
    "buyer_email" TEXT,
    "buyer_name" TEXT,
    "buyer_territory" TEXT,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "promotion_code" TEXT,
    "payment_method" TEXT,
    "card_last_four" TEXT,
    "idempotency_key" TEXT,
    "provider_category" TEXT,
    "placed_at" TEXT,
    "is_upsell" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "orders_session_uuid_fkey" FOREIGN KEY ("session_uuid") REFERENCES "sessions" ("session_uuid") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider_offer" TEXT,
    "provider_item" TEXT,
    "unit_price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sent_to_provider" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_consents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "consent_key" TEXT NOT NULL,
    "granted" INTEGER NOT NULL,
    "copy_version" TEXT NOT NULL,
    "copy_shown" TEXT NOT NULL,
    "recorded_at" TEXT NOT NULL,
    CONSTRAINT "order_consents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" TEXT,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "checkout_attempts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idempotency_key" TEXT NOT NULL,
    "session_key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "outcome" TEXT,
    "created_at" TEXT NOT NULL,
    "completed_at" TEXT
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bucket" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "window_start" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "idx_sessions_updated_at" ON "sessions"("updated_at");

-- CreateIndex
CREATE INDEX "idx_orders_session" ON "orders"("session_uuid");

-- CreateIndex
CREATE INDEX "idx_orders_treatment_reference" ON "orders"("treatment_reference");

-- CreateIndex
CREATE INDEX "idx_orders_placed_at" ON "orders"("placed_at");

-- CreateIndex
CREATE INDEX "idx_orders_provider_reference" ON "orders"("provider_reference");

-- CreateIndex
CREATE INDEX "idx_order_lines_order" ON "order_lines"("order_id");

-- CreateIndex
CREATE INDEX "idx_order_consents_order" ON "order_consents"("order_id");

-- CreateIndex
CREATE INDEX "idx_events_session" ON "events"("session_uuid");

-- CreateIndex
CREATE INDEX "idx_events_created_at" ON "events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_attempts_idempotency_key_key" ON "checkout_attempts"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_checkout_attempts_created_at" ON "checkout_attempts"("created_at");

-- CreateIndex
CREATE INDEX "idx_rate_limits_window_start" ON "rate_limits"("window_start");

-- CreateIndex
CREATE UNIQUE INDEX "idx_rate_limits_bucket_identity" ON "rate_limits"("bucket", "identity");

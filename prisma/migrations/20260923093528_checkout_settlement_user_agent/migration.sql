-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_orders" (
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
    "settlement" TEXT NOT NULL DEFAULT 'capture',
    "user_agent" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "orders_session_uuid_fkey" FOREIGN KEY ("session_uuid") REFERENCES "sessions" ("session_uuid") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_orders" ("amount_cents", "anchor_slug", "buyer_email", "buyer_name", "buyer_territory", "card_last_four", "created_at", "currency", "discount_cents", "id", "idempotency_key", "is_upsell", "payment_method", "placed_at", "promotion_code", "provider_category", "provider_reference", "session_uuid", "status", "treatment_reference", "updated_at", "verification_at", "verification_status") SELECT "amount_cents", "anchor_slug", "buyer_email", "buyer_name", "buyer_territory", "card_last_four", "created_at", "currency", "discount_cents", "id", "idempotency_key", "is_upsell", "payment_method", "placed_at", "promotion_code", "provider_category", "provider_reference", "session_uuid", "status", "treatment_reference", "updated_at", "verification_at", "verification_status" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
CREATE INDEX "idx_orders_session" ON "orders"("session_uuid");
CREATE INDEX "idx_orders_treatment_reference" ON "orders"("treatment_reference");
CREATE INDEX "idx_orders_placed_at" ON "orders"("placed_at");
CREATE INDEX "idx_orders_provider_reference" ON "orders"("provider_reference");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

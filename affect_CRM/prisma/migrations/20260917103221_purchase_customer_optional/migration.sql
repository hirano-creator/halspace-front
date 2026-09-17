-- お名前が分からないお客様の購入も売上として残せるように、Purchase.customerId を任意にする
-- AlterTable
ALTER TABLE "Purchase" ALTER COLUMN "customerId" DROP NOT NULL;

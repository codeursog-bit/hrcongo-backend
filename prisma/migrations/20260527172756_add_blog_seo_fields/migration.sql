-- AlterTable
ALTER TABLE "blog_posts" ADD COLUMN     "keywords" TEXT,
ADD COLUMN     "seoDesc" VARCHAR(160),
ADD COLUMN     "seoTitle" VARCHAR(60);

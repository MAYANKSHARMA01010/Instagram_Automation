-- CreateTable
CREATE TABLE "upload_logs" (
    "id" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "drive_file_name" TEXT NOT NULL,
    "instagram_account_id" TEXT,
    "uploaded_drive_folder_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "instagram_media_id" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "storage_time_ms" INTEGER,
    "proxy_url" TEXT,
    "queue_start_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upload_start_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upload_end_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_files" (
    "id" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "drive_file_name" TEXT NOT NULL,
    "instagram_media_id" TEXT,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_jobs" (
    "id" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "drive_file_name" TEXT NOT NULL,
    "local_file_path" TEXT,
    "instagram_account_id" TEXT,
    "uploaded_drive_folder_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processing_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "instagram_container_id" TEXT,
    "instagram_media_id" TEXT,
    "error_message" TEXT,
    "error_stack" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_health" (
    "instagram_account_id" TEXT NOT NULL,
    "health_score" INTEGER NOT NULL DEFAULT 100,
    "successful_uploads" INTEGER NOT NULL DEFAULT 0,
    "failed_uploads" INTEGER NOT NULL DEFAULT 0,
    "restriction_count" INTEGER NOT NULL DEFAULT 0,
    "challenge_count" INTEGER NOT NULL DEFAULT 0,
    "checkpoint_count" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_restriction_time" TIMESTAMP(3),
    "cooldown_until" TIMESTAMP(3),
    "last_successful_upload" TIMESTAMP(3),
    "last_upload_failure" TIMESTAMP(3),
    "last_upload_time" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_health_pkey" PRIMARY KEY ("instagram_account_id")
);

-- CreateIndex
CREATE INDEX "upload_logs_drive_file_id_idx" ON "upload_logs"("drive_file_id");

-- CreateIndex
CREATE INDEX "upload_logs_status_idx" ON "upload_logs"("status");

-- CreateIndex
CREATE INDEX "upload_logs_created_at_idx" ON "upload_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "processed_files_drive_file_id_key" ON "processed_files"("drive_file_id");

-- CreateIndex
CREATE INDEX "processed_files_drive_file_id_idx" ON "processed_files"("drive_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "upload_jobs_drive_file_id_key" ON "upload_jobs"("drive_file_id");

-- CreateIndex
CREATE INDEX "upload_jobs_status_idx" ON "upload_jobs"("status");

-- CreateIndex
CREATE INDEX "upload_jobs_drive_file_id_idx" ON "upload_jobs"("drive_file_id");

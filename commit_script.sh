git add .gitignore
git commit -m "chore: add .gitignore"
git add package.json package-lock.json pnpm-lock.yaml
git commit -m "chore: add package dependencies and lockfiles"
git add tsconfig.json .eslintrc.json .prettierrc
git commit -m "chore: add typescript and linter configurations"
git add Dockerfile .dockerignore docker-compose.yml
git commit -m "chore: add docker configuration for deployment"
git add README.md
git commit -m "docs: add project README"
git add docs/
git commit -m "docs: add detailed project documentation"
git add caption.txt
git commit -m "feat: add default video caption template"
git add prisma/
git commit -m "feat: add Prisma ORM database schema"
git add scripts/
git commit -m "chore: add utility scripts"
git add n8n/
git commit -m "feat: add n8n workflow definitions"
git add src/types/
git commit -m "feat: define shared TypeScript interfaces and types"
git add src/utils/
git commit -m "feat: implement generic utility functions"
git add src/config/
git commit -m "feat: setup application and database configuration"
git add src/database/
git commit -m "feat: implement Prisma repository layer"
git add src/queue/
git commit -m "feat: implement asynchronous task queues"
git add src/services/google-drive.service.ts
git commit -m "feat: integrate Google Drive API service"
git add src/services/instagram.service.ts
git commit -m "feat: integrate Meta Graph API for Instagram Reels"
git add src/services/scheduler.service.ts src/services/notification.service.ts
git commit -m "feat: add background scheduler and Telegram notification services"
git add src/workers/download.worker.ts
git commit -m "feat: implement sequential video download worker"
git add src/workers/upload.worker.ts
git commit -m "feat: implement containerized upload worker"
git add src/workers/status.worker.ts
git commit -m "feat: implement status polling worker"
git add src/controllers/
git commit -m "feat: implement express API controllers"
git add src/routes/
git commit -m "feat: define HTTP API routes"
git add src/server.ts
git commit -m "feat: add core server entrypoint and bootstrapper"
git add .
git commit -m "chore: add remaining miscellaneous files"
git push

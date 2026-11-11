FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:ui

ENV NODE_ENV=production PORT=8787 PRINT_AUDIT_LOG_PATH=/app/var/prints.jsonl
EXPOSE 8787
CMD ["npm", "run", "server"]

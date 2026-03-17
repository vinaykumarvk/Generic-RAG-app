# IntelliRAG Web — build + nginx
FROM node:20-slim AS builder
ARG VITE_API_BASE_URL=http://localhost:3001
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace=apps/web --include-workspace-root

COPY apps/web/ apps/web/
RUN cd apps/web && VITE_API_BASE_URL=${VITE_API_BASE_URL} npx vite build

# --- Serve with nginx ---
FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

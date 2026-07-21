# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY start.sh ./
RUN chmod +x start.sh
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8000/health', (res) => { if (res.statusCode === 200) process.exit(0); else process.exit(1); }).on('error', () => process.exit(1));"
CMD ["sh", "./start.sh"]

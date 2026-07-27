FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=8000
EXPOSE 8000

CMD ["node", "index.js"]

FROM node:22-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY src ./src

ENV NODE_ENV=production

CMD ["node", "src/index.js"]

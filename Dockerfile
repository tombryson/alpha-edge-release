# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code (ARG before COPY busts Depot remote cache when needed)
ARG CACHEBUST=1
COPY . .

# Build arguments for environment variables
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Build the application
RUN npm run build

# Production stage
FROM node:24-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Expose port
EXPOSE 3000

# Set environment variables at runtime
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run the application
CMD ["node", "server.js"]

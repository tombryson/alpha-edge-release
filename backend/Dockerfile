# Build stage
FROM golang:1.26-bookworm AS builder

WORKDIR /app

# Install build dependencies
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y \
    gcc \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy go mod files
COPY go.mod go.sum* ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=1 go test ./internal/database ./cmd/dbtool -count=1
RUN CGO_ENABLED=1 GOOS=linux go build -o main .
RUN CGO_ENABLED=1 GOOS=linux go build -o dbtool ./cmd/dbtool

# Runtime stage
FROM flyio/litefs:0.5 AS litefs

FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
# The slim base needs trusted roots before its first HTTPS package download.
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y \
    libsqlite3-0 \
    sqlite3 \
    restic \
    ca-certificates \
    fuse3 \
    && rm -rf /var/lib/apt/lists/*

# Copy LiteFS binary from official image
COPY --from=litefs /usr/local/bin/litefs /usr/local/bin/litefs

# Copy binary from builder
COPY --from=builder /app/main .
COPY --from=builder /app/dbtool /usr/local/bin/dbtool

# Copy LiteFS configuration
COPY litefs.yml /etc/litefs.yml

# Create directories for LiteFS (FUSE mount) and persistent data
RUN mkdir -p /litefs /data

# Expose port (LiteFS proxy will listen on 8080, app on 8081)
EXPOSE 8080

# Set environment variables
ENV DB_PATH=/litefs/trading.db
ENV PORT=8081
ENV PRIMARY_REGION=syd

# Run LiteFS which will start the application
CMD ["litefs", "mount"]

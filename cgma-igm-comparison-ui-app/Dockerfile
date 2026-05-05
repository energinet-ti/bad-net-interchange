# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM rust:1.88-bookworm AS backend-build
WORKDIR /app/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
# Create dummy src to cache deps
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release 2>/dev/null || true
COPY backend/src/ src/
RUN cargo build --release

# Stage 3: Runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Place binary in /app/backend/ so ../frontend/build resolves to /app/frontend/build
COPY --from=backend-build /app/backend/target/release/cgma-igm-backend ./backend/
COPY --from=frontend-build /app/frontend/build ./frontend/build
ENV PORT=8080
EXPOSE 8080
WORKDIR /app/backend
CMD ["./cgma-igm-backend"]

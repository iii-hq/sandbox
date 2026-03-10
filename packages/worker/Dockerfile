FROM rust:1.85-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /build
COPY . .
RUN cargo build --release

FROM alpine:3.20
RUN apk add --no-cache ca-certificates docker-cli
COPY --from=builder /build/target/release/iii-sandbox-worker /usr/local/bin/
EXPOSE 3111
ENTRYPOINT ["iii-sandbox-worker"]

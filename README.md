# SEV Backend (Cloudflare Workers)

A backend API for a URL Shortener, built with Hono.js on the Cloudflare Workers runtime and powered by Neon Serverless PostgreSQL.

## Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono.js
- **Database**: Neon Serverless PostgreSQL
- **Package Manager**: Bun
- **Authentication**: OAuth 2.0 (GitHub & Google) via Arctic

## Getting Started

### 1. Install Dependencies

```bash
bun install
```

### 2. Local Development

Run a local PostgreSQL and neon-proxy instance with Docker Compose:

```bash
docker compose up -d

# or podman

podman compose up -d
```

See this [guide](https://neon.com/guides/local-development-with-neon#local-postgresql) for more details.

Start the development server:

```bash
bun run dev
```

## Environment Variables

- Local development: Create a `.dev.vars` file in the root directory based on `.dev.vars.example` and fill in the required values.
- Production: Set the environment variables in `wrangler.jsonc`.

## Type Generation

Synchronize type definitions with your Cloudflare Worker configuration:

```bash
bun run cf-typegen
```

This generates type definitions for `CloudflareBindings`.

Usage example:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```

## Database Schema

### User

```sql
-- Table Definition
CREATE TABLE "public"."users" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "email" varchar(255) NOT NULL,
    "avatar_url" text,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    PRIMARY KEY ("id")
);


-- Indices
CREATE UNIQUE INDEX email_idx ON public.users USING btree (email);
```

### Accounts

```sql
DROP TYPE IF EXISTS "public"."provider";
CREATE TYPE "public"."provider" AS ENUM ('google', 'github');

-- Table Definition
CREATE TABLE "public"."accounts" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL,
    "provider" "public"."provider" NOT NULL,
    "provider_user_id" varchar(128) NOT NULL,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE,
    PRIMARY KEY ("id")
);


-- Indices
CREATE UNIQUE INDEX provider_user_idx ON public.accounts USING btree (provider, provider_user_id);
```

### Clicks

```sql
-- Table Definition
CREATE TABLE "public"."clicks" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "created_at" timestamptz DEFAULT now(),
    "short_code" varchar(16) NOT NULL,
    "ip" inet,
    "user_agent" text,
    "referer" text,
    "country_code" varchar(3),
    "city" varchar(255),
    "device_type" varchar(16),
    CONSTRAINT "clicks_short_code_fkey" FOREIGN KEY ("short_code") REFERENCES "public"."links"("short_code") ON DELETE CASCADE,
    PRIMARY KEY ("id")
);


-- Indices
CREATE INDEX idx_clicks_country_code ON public.clicks USING btree (country_code);
CREATE INDEX idx_clicks_created_at ON public.clicks USING btree (created_at DESC);
CREATE INDEX idx_clicks_device_type ON public.clicks USING btree (device_type);
CREATE INDEX idx_clicks_shortcode ON public.clicks USING btree (short_code);
```

### Links

```sql
-- Table Definition
CREATE TABLE "public"."links" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "short_code" text NOT NULL,
    "url" text NOT NULL,
    "user_id" uuid,
    "updated_at" timestamptz DEFAULT now(),
    "created_at" timestamptz DEFAULT now(),
    "password" text,
    "expires_at" timestamptz,
    "archived" timestamptz,
    "clicks" int4 DEFAULT 0,
    CONSTRAINT "links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE,
    PRIMARY KEY ("id")
);


-- Indices
CREATE UNIQUE INDEX short_code_idx ON public.links USING btree (short_code);
```

## References

- [Hono.js Documentation](https://hono.dev/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Neon Documentation](https://neon.tech/docs)
- [Arctic Documentation](https://arcticjs.dev/)
- [Bun Documentation](https://bun.sh/docs)

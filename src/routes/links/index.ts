import { randomBytes } from "crypto";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { jwt, verify } from "hono/jwt";
import { validator } from "hono/validator";
import * as z from "zod";
import { sql } from "~/lib/db";

const links = new Hono();

links.get(
  "/",
  jwt({
    secret: process.env.JWT_SECRET!,
    cookie: "svTkn",
  }),
  async (c) => {
    const {
      page = "1",
      limit = "10",
      sortBy = "created_at",
      sortOrder = "desc",
      status,
      search,
    } = c.req.query();

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const allowedSortBy = [
      "created_at",
      "url",
      "short_code",
      "expires_at",
      "clicks",
    ];
    const safeSortBy = allowedSortBy.includes(sortBy) ? sortBy : "created_at";
    const safeSortOrder =
      sortOrder.toLowerCase() === "asc" ? sql`ASC` : sql`DESC`;

    const { sub: userId } = c.get("jwtPayload");
    let whereClause = sql`WHERE user_id = ${userId}`;

    if (status === "active") {
      whereClause = sql`${whereClause} AND archived IS NULL`;
    } else if (status === "archived") {
      whereClause = sql`${whereClause} AND archived IS NOT NULL`;
    }

    if (search) {
      whereClause = sql`${whereClause} AND (url ILIKE ${"%" + search + "%"} OR short_code ILIKE ${"%" + search + "%"})`;
    }

    try {
      const [linksResult, totalResult] = await Promise.all([
        sql`
          SELECT * FROM links
          ${whereClause}
          ORDER BY ${sql.unsafe(safeSortBy)} ${safeSortOrder}
          LIMIT ${limitNum}
          OFFSET ${offset}
        `,
        sql`
          SELECT COUNT(*) FROM links
          ${whereClause}
        `,
      ]);

      const totalItems = parseInt(totalResult[0].count as string, 10);
      const totalPages = Math.ceil(totalItems / limitNum);

      return c.json({
        data: linksResult,
        meta: {
          totalItems,
          totalPages,
          currentPage: pageNum,
          itemsPerPage: limitNum,
        },
      });
    } catch (error) {
      console.error("Failed to retrieve links:", error);
      return c.json({ error: "Failed to retrieve links" }, 500);
    }
  },
);

const createSchema = z.object({
  url: z.url(),
  short_code: z.string().min(3).max(20).optional(),
  password: z.string().optional().nullable(),
  accessible_at: z.coerce.date().optional().nullable(),
  expires_at: z.coerce.date().optional().nullable(),
});

links.post(
  "/",
  async (c, next) => {
    const token = getCookie(c, "svTkn");

    if (!token) {
      c.set("jwtPayload", null);
      return await next();
    }

    try {
      const payload = await verify(token, process.env.JWT_SECRET!);
      c.set("jwtPayload", payload);
    } catch (e) {
      c.set("jwtPayload", null);
    }

    await next();
  },
  validator("json", (value, c) => {
    const parsed = createSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: parsed.error }, 400);
    }

    return parsed.data;
  }),
  async (c) => {
    const jwtPayload = c.get("jwtPayload");
    const body = c.req.valid("json");
    const userId = jwtPayload ? jwtPayload.sub : null;

    if (!jwtPayload) {
      body.short_code = generateShortCode();
      body.password = undefined;
      body.accessible_at = undefined;
      body.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    if (!body.short_code) {
      body.short_code = generateShortCode();
    }

    try {
      const newLinks = await sql`
        INSERT INTO links (url, short_code, user_id, password, accessible_at, expires_at)
        VALUES (${body.url}, ${body.short_code}, ${userId}, ${body.password}, ${body.accessible_at}, ${body.expires_at})
        RETURNING *`;

      return c.json({ message: "Link created", data: newLinks[0] }, 201);
    } catch (e) {
      if ((e as any).code === "23505") {
        return c.json({ error: "Short code already exists." }, 409);
      }

      return c.json({ error: "Failed to create link" }, 500);
    }
  },
);

links.patch(
  "/:id",
  jwt({ secret: process.env.JWT_SECRET!, cookie: "svTkn" }),
  validator("json", (value, c) => {
    const parsed = createSchema.partial().safeParse(value);
    if (!parsed.success) {
      return c.json({ error: parsed.error }, 400);
    }

    return parsed.data;
  }),
  async (c) => {
    const linkId = c.req.param("id");
    const updates = c.req.valid("json");
    const { sub: userId } = c.get("jwtPayload");

    const updateEntries = Object.entries(updates)
      .filter(([_key, value]) => value !== undefined)
      .map(([key, value]) => sql`${sql.unsafe(key)} = ${value}`);

    const setClause = updateEntries.reduce((prev, curr, i) =>
      i === 0 ? curr : sql`${prev}, ${curr}`,
    );

    try {
      const updatedLinks = await sql`
        UPDATE links
        SET ${setClause}
        WHERE id = ${linkId} AND user_id = ${userId}
        RETURNING *`;

      return c.json({
        message: "Link updated successfully",
        data: updatedLinks[0],
      });
    } catch (error) {
      if ((error as any).code === "23505") {
        return c.json(
          { error: "The provided short code is already in use." },
          409,
        );
      }

      return c.json({ error: "Failed to update link" }, 500);
    }
  },
);

links.delete(
  "/:id",
  jwt({ secret: process.env.JWT_SECRET!, cookie: "svTkn" }),
  async (c) => {
    const linkId = c.req.param("id");
    const { sub: userId } = c.get("jwtPayload");

    try {
      await sql`DELETE FROM links WHERE id = ${linkId} AND user_id = ${userId}`;
      return c.json({ message: "Link deleted successfully" });
    } catch (error) {
      return c.json({ error: "Failed to delete link" }, 500);
    }
  },
);

function generateShortCode(length: number = 7): string {
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

export default links;

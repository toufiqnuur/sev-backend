import { Hono } from "hono";
import { cache } from "hono/cache";
import { jwt } from "hono/jwt";
import { sql } from "~/lib/db";

const dashboard = new Hono();

dashboard.use("*", jwt({ secret: process.env.JWT_SECRET!, cookie: "svTkn" }));

dashboard.use(
  "*",
  cache({
    cacheName: (c) => c.req.url + `?user=${c.get("jwtPayload").sub}`,
    cacheControl: "max-age=30",
    cacheableStatusCodes: [200],
  }),
);

dashboard.get("/stats", async (c) => {
  const { sub: userId } = c.get("jwtPayload");

  try {
    const [links, uniqueVisitors] = await Promise.allSettled([
      sql`
          SELECT
            COUNT(id)::int AS "total_links",
            COUNT(id) FILTER (
              WHERE
                archived IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())
            )::int AS "active_links",
            COALESCE(SUM(clicks), 0)::int AS "total_clicks"
          FROM links
          WHERE user_id = ${userId};`,
      sql`
          SELECT 
            COUNT(DISTINCT (c.ip::text || '|' || c.user_agent))::int 
              AS total_unique_clicks
          FROM public.links l
          LEFT JOIN public.clicks c 
            ON l.short_code = c.short_code
          WHERE l.user_id = ${userId};`,
    ]);

    const stats =
      links.status === "fulfilled"
        ? links.value[0]
        : { total_links: 0, active_links: 0, total_clicks: 0 };

    return c.json({
      ...stats,
      unique_clicks:
        uniqueVisitors.status === "fulfilled"
          ? uniqueVisitors.value[0].total_unique_clicks
          : 0,
    });
  } catch (error) {
    console.error("Failed to fetch dashboard stats:", error);
    return c.json({ message: "Internal Server Error" }, 500);
  }
});

dashboard.get("/analytics", async (c) => {
  const { sub: userId } = c.get("jwtPayload");

  try {
    const [countries, devices] = await Promise.allSettled([
      sql`
          SELECT c.country_code, COUNT(*) AS click_count
          FROM clicks c
          JOIN links l ON c.short_code = l.short_code
          WHERE c.country_code IS NOT NULL
            AND l.user_id = ${userId}
          GROUP BY country_code
          ORDER BY click_count DESC
          LIMIT 10;`,
      sql`
          SELECT c.device_type, COUNT(*) AS click_count
          FROM clicks c
          JOIN links l ON c.short_code = l.short_code
          WHERE l.user_id = ${userId}
          GROUP BY device_type
          ORDER BY click_count DESC;`,
    ]);
    return c.json({
      topCountries: countries.status === "fulfilled" ? countries.value : [],
      topDevices: devices.status === "fulfilled" ? devices.value : [],
    });
  } catch (error) {
    console.error("Failed to fetch reports:", error);
    return c.json({ message: "Internal Server Error" }, 500);
  }
});

export default dashboard;

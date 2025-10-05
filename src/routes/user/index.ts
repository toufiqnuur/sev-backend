import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { sql } from "~/lib/db";

const user = new Hono();

user.use("*", jwt({ secret: process.env.JWT_SECRET!, cookie: "svTkn" }));

user.get("/", async (c) => {
  const { sub: userId } = c.get("jwtPayload");

  try {
    const [user] = await sql`
      SELECT *
      FROM users
      WHERE id = ${userId};`;

    if (!user) {
      return c.json({ message: "User not found." }, 404);
    }

    return c.json(user);
  } catch (error) {
    console.error("Failed to fetch user profile:", error);
    return c.json({ message: "Internal Server Error" }, 500);
  }
});

user.patch("/", async (c) => {
  const { sub: userId } = c.get("jwtPayload");
  const { name } = await c.req.json();

  if (!name) {
    return c.json({ message: "No data provided for update." }, 400);
  }

  try {
    const [user] = await sql`
      UPDATE users
      SET name = COALESCE(${name}, name)
      WHERE id = ${userId}
      RETURNING *;`;

    if (!user) {
      return c.json({ message: "User not found or nothing changed." }, 404);
    }

    return c.json(user);
  } catch (error) {
    console.error("Failed to update user profile:", error);
    return c.json({ message: "Internal Server Error" }, 500);
  }
});

export default user;

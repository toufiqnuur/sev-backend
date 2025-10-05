import { Hono } from "hono";
import { cors } from "hono/cors";
import auth from "./routes/auth";
import dashboard from "./routes/dashboard";
import links from "./routes/links";
import user from "./routes/user";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use("*", async (c, next) => {
  const domain = process.env.DOMAIN!;
  const corsMiddlewareHandler = cors({
    origin: (origin) => {
      if (!origin) return null;

      if (origin.endsWith(domain)) {
        return origin;
      }
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  });
  return corsMiddlewareHandler(c, next);
});

app.get("/", (c) => c.text("OK"));

app.route("/auth", auth);
app.route("/links", links);
app.route("/dashboard", dashboard);
app.route("/user", user);

export default app;

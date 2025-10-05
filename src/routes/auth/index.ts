import * as arctic from "arctic";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { jwt, verify } from "hono/jwt";
import { sql } from "~/lib/db";
import { github, google } from "~/lib/provider";
import { generateToken, upsertOauthUser } from "~/utils/auth";

const cookieOptions = {
  httpOnly: true,
  sameSite: "Lax" as const,
  secure: true,
  path: "/",
  domain: process.env.DOMAIN!,
};

const TOKEN_EXPIRY = 15 * 60; // 15 minutes
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60; // 7 days

const DASHBOARD_URL = `${process.env.FRONTEND_URL}/dashboard`;

const auth = new Hono();

auth.get("/me", async (c) => {
  const token = getCookie(c, "svTkn");

  if (!token) {
    return c.json({ user: null }, 401);
  }

  try {
    const payload = await verify(token, process.env.JWT_SECRET!);
    const { sub: userId, email, name, avatarUrl } = payload;
    return c.json({ user: { userId, name, email, avatarUrl } });
  } catch (e) {
    if (e instanceof Error && e.name === "TokenExpiredError") {
      return c.json({ error: "Token expired" }, 401);
    }
    return c.json({ error: "Token verification failed" }, 500);
  }
});

auth.post(
  "/refresh",
  jwt({ secret: process.env.JWT_SECRET!, cookie: "svRtkn" }),
  async (c) => {
    const payload = c.get("jwtPayload");

    if (!payload || payload.typ !== "refresh" || !payload.sub) {
      return c.json({ error: "Invalid refresh token" }, 401);
    }

    try {
      const users = await sql`SELECT * FROM users WHERE id = ${payload.sub}`;
      const { accessToken, refreshToken } = await generateToken(users[0]);

      return c.json({ accessToken, refreshToken });
    } catch (e) {
      return c.json({ error: "Failed to refresh token" }, 500);
    }
  },
);

auth.get("/google", (c) => {
  const state = arctic.generateState();
  const codeVerifier = arctic.generateCodeVerifier();
  const scopes = ["openid", "profile", "email"];
  const url = google.createAuthorizationURL(state, codeVerifier, scopes);

  setCookie(c, "_state", state, { ...cookieOptions, maxAge: 300 });
  setCookie(c, "_code_verifier", codeVerifier, {
    ...cookieOptions,
    maxAge: 300,
  });

  return c.redirect(url, 302);
});

auth.get("/google/callback", async (c) => {
  const { code, state } = c.req.query();
  const storedState = getCookie(c, "_state");
  const storedCode = getCookie(c, "_code_verifier");

  if (!code || !storedCode || !state || !storedState) {
    return c.json({ error: "Invalid request" }, 400);
  }

  try {
    const tokens = await google.validateAuthorizationCode(code, storedCode);
    const claims = arctic.decodeIdToken(tokens.idToken()) as {
      sub: string;
      email: string;
      email_verified: boolean;
      name: string;
      picture?: string;
    };

    if (!claims.email_verified) throw new Error("Email not verified");

    const user = await upsertOauthUser({
      provider: "google",
      providerUserId: claims.sub,
      name: claims.name,
      email: claims.email,
      avatarUrl: claims.picture || undefined,
    });

    if (!user) throw new Error("User not found");

    const { accessToken, refreshToken } = await generateToken(user);

    deleteCookie(c, "_state");
    deleteCookie(c, "_code_verifier");

    setCookie(c, "svTkn", accessToken, {
      ...cookieOptions,
      maxAge: TOKEN_EXPIRY,
    });
    setCookie(c, "svRtkn", refreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_TOKEN_EXPIRY,
    });

    return c.redirect(DASHBOARD_URL, 302);
  } catch (error) {
    if (error instanceof arctic.OAuth2RequestError) {
      return c.json({ error: "OAuth Error", detail: error.code }, 400);
    }

    if (error instanceof arctic.ArcticFetchError) {
      return c.json({ error: "Fetch Error", detail: error.message }, 400);
    }

    return c.json({ error: "Internal Server Error" }, 500);
  }
});

auth.get("/github", (c) => {
  const state = arctic.generateState();
  const scopes = ["user:email"];
  const url = github.createAuthorizationURL(state, scopes);

  return c.redirect(url, 302);
});

auth.get("/github/callback", async (c) => {
  const { code } = c.req.query();

  try {
    const tokens = await github.validateAuthorizationCode(code);
    const githubAccessToken = tokens.accessToken();

    const [userResponse, emailsResponse] = await Promise.all([
      fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${githubAccessToken}`,
          "User-Agent": "SevApp",
        },
      }),
      fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${githubAccessToken}`,
          "User-Agent": "SevApp",
        },
      }),
    ]);

    const profile = (await userResponse.json()) as {
      id: number;
      login: string;
      name: string;
      avatar_url: string;
    };
    const emails = (await emailsResponse.json()) as Array<{
      name: string;
      primary: boolean;
      verified: boolean;
      email: string;
    }>;

    const primaryEmailObj = emails.find(
      (email: { primary: boolean; verified: boolean }) =>
        email.primary && email.verified,
    );

    const email =
      primaryEmailObj?.email ||
      emails.find((email: { verified: boolean }) => email.verified)?.email;

    const user = await upsertOauthUser({
      provider: "github",
      providerUserId: profile.id.toString(),
      name: profile.name || profile.login,
      email: email as string,
      avatarUrl: profile.avatar_url || undefined,
    });

    if (!user) throw new Error("User not found");

    const { accessToken, refreshToken } = await generateToken(user);

    setCookie(c, "svTkn", accessToken, {
      ...cookieOptions,
      maxAge: TOKEN_EXPIRY,
    });
    setCookie(c, "svRtkn", refreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_TOKEN_EXPIRY,
    });

    return c.redirect(DASHBOARD_URL, 302);
  } catch (error) {
    if (error instanceof arctic.OAuth2RequestError) {
      return c.json({ error: "OAuth Error", detail: error.code }, 400);
    }

    if (error instanceof arctic.ArcticFetchError) {
      return c.json({ error: "Fetch Error", detail: error.message }, 400);
    }

    return c.json({ error: "Internal Server Error" }, 500);
  }
});

export default auth;

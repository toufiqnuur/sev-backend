import { sign } from "hono/jwt";
import { sql } from "~/lib/db";

type OAuthData = {
  provider: string;
  providerUserId: string;
  name: string;
  email: string;
  avatarUrl?: string;
};

export async function upsertOauthUser(data: OAuthData) {
  let [user] = await sql`
    INSERT INTO users (email, name, avatar_url)
    VALUES (${data.email}, ${data.name}, ${data.avatarUrl})
    ON CONFLICT (email) DO NOTHING
    RETURNING *`;

  if (!user) {
    const [existingUser] = await sql`
      SELECT * FROM users WHERE email = ${data.email} LIMIT 1`;
    user = existingUser;
  }

  await sql`
    INSERT INTO accounts (user_id, provider, provider_user_id)
    VALUES (${user.id}, ${data.provider}, ${data.providerUserId})
    ON CONFLICT (provider, provider_user_id) DO NOTHING`;

  return user;
}

export async function generateToken(user: Record<string, any>) {
  const secret = process.env.JWT_SECRET!;
  const issuer = process.env.API_URL!;
  const audience = process.env.FRONTEND_URL!;

  const accessToken = await sign(
    {
      typ: "access",
      sub: String(user.id),
      iss: issuer,
      aud: audience,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 15 * 60,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
    },
    secret,
  );

  const refreshToken = await sign(
    {
      typ: "refresh",
      sub: String(user.id),
      iss: issuer,
      aud: audience,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
    secret,
  );

  return { accessToken, refreshToken };
}

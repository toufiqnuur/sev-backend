import { neon, neonConfig } from "@neondatabase/serverless";

let connectionString = process.env.DATABASE_URL!!;

if (process.env.NODE_ENV === "development") {
  neonConfig.fetchEndpoint = (host) => {
    const [protocol, port] =
      host === "db.localtest.me" ? ["http", 4444] : ["https", 443];
    return `${protocol}://${host}:${port}/sql`;
  };
}

const sql = neon(connectionString);

export { sql };

import * as arctic from "arctic";

export const github = new arctic.GitHub(
  process.env.GITHUB_CLIENT_ID!,
  process.env.GITHUB_CLIENT_SECRET!,
  `${process.env.API_URL!}/auth/github/callback`,
);

export const google = new arctic.Google(
  process.env.GOOGLE_CLIENT_ID!,
  process.env.GOOGLE_CLIENT_SECRET!,
  `${process.env.API_URL!}/auth/google/callback`,
);

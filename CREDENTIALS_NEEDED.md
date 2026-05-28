# Credentials Needed

Copy `.env` into the runtime environment or keep it beside `docker-compose.yml`.

Required for local Docker:
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `DATABASE_URL`
- `JWT_SECRET`

Required for Hostaway sync:
- `HOSTAWAY_ACCOUNT_ID`
- `HOSTAWAY_API_KEY`

Required for live email delivery:
- `POSTMARK_API_KEY`
- `POSTMARK_FROM_EMAIL`

Optional deployment:
- `VERCEL_TOKEN`
- `GITHUB_TOKEN`
- `FRONTEND_ORIGIN`
- `VITE_API_URL`

The application runs without Hostaway, Vercel, GitHub, or Postmark credentials. Live email sending is skipped until `POSTMARK_API_KEY` and `POSTMARK_FROM_EMAIL` are provided.

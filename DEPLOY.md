# Deployment Guide (Simple + Cheap)

This guide uses a low-cost, beginner-friendly setup with managed services and free tiers:

- **Database:** Supabase Postgres (free tier)
- **Backend:** Render Web Service (free tier)
- **Frontend:** Vercel (free tier)

Why this stack: no servers to manage, free tiers, and easy rollbacks.

---

## 1) One-time code prep (Postgres)

The backend currently targets SQLite for local dev. For production, switch Prisma to Postgres.

1. Open `attendance/backend/prisma/schema.prisma`.
2. Change the datasource provider:

```prisma
// before
provider = "sqlite"

// after
provider = "postgresql"
```

3. Commit this change and push to your repo.

---

## 2) Create the database (Supabase)

1. Create a free Supabase project.
2. Go to **Project Settings → Database** and copy the connection string.
3. Use the **Connection string (URI)** and keep it for Render as `DATABASE_URL`.

Example format:

```
postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
```

---

## 3) Deploy the backend (Render)

1. Create a new **Web Service** on Render and connect your GitHub repo.
2. Set **Root Directory** to `attendance/backend`.
3. **Build Command**:

```
npm install && npm run build && npx prisma generate && npx prisma migrate deploy
```

4. **Start Command**:

```
npm run start
```

5. Add environment variables in Render:

- `DATABASE_URL` = Supabase connection string
- `JWT_SECRET` = strong random string
- `JWT_EXPIRES_IN` = `7d`
- `GEMINI_API_KEY` = your Gemini API key (optional if you do not use AI exam)
- `FRONTEND_URL` = your Vercel URL (set after frontend deploy)
- `ADMIN_PASSWORD` = initial admin password

6. Deploy the service.

### Seed the admin user (one-time)

In Render, open the service shell and run:

```
npm run prisma:seed
```

This creates/updates the admin account using `ADMIN_PASSWORD`.

---

## 4) Deploy the frontend (Vercel)

1. Create a new Vercel project and import the same GitHub repo.
2. Set **Root Directory** to `attendance/frontend`.
3. Build settings:

- **Build Command:** `npm run build`
- **Output Directory:** `dist`

4. Add a rewrite so the frontend can call the backend at `/api`.

Create a file `attendance/frontend/vercel.json` with:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://YOUR_RENDER_BACKEND_URL/api/:path*" }
  ]
}
```

5. Deploy the frontend.

---

## 5) Final configuration

1. Go back to Render and set:

```
FRONTEND_URL=https://YOUR_VERCEL_URL
```

2. Redeploy the backend.

---

## 6) Verify

- Backend health: `https://YOUR_RENDER_BACKEND_URL/api/health`
- Frontend: `https://YOUR_VERCEL_URL`
- Login with:
  - Username: `admin`
  - Password: value of `ADMIN_PASSWORD`

---

## Notes / Tips

- If you change environment variables, **redeploy** the backend.
- For local dev, keep SQLite in `.env` and use Postgres only for production.
- Prisma migrations for production:

```
cd attendance/backend
npx prisma migrate deploy
```

---

## Optional: use a single host (lowest effort)

If you want everything on one server (no rewrites), you can:

1. Build the frontend locally with `npm run build`.
2. Serve `frontend/dist` with a simple static server or Nginx on the same host as the backend.

This avoids Vercel rewrites but requires managing a small VM.

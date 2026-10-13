# Internal Frontier

Internal Frontier clothing storefront and live chat enquiry flow.

The storefront (`backend/index.html`) is served from the backend on `http://localhost:3000`, where customers can filter and search the collection, select sizes, save pieces to an enquiry bag, and send their selection to the shop on WhatsApp.

## Backend

From the `backend` directory, install dependencies with `npm install` and start the API with `npm start`. The API listens on port `3000` by default and exposes `/`, `/health`, and `/api/chat`.

## Live chat agent

The chat widget posts to `/api/chat`. The backend sends the message to Vercel AI Gateway; the key stays on the server and is never sent to the browser.

Set `AI_GATEWAY_API_KEY` to your Vercel AI Gateway key before starting the backend. In PowerShell, from the `backend` directory, run:

```powershell
$env:AI_GATEWAY_API_KEY = "your-new-vercel-key"
npm start
```

That setting lasts only for the current terminal session. For a Vercel deployment, add `AI_GATEWAY_API_KEY` under the project's Environment Variables, then redeploy. You can optionally set `AI_GATEWAY_MODEL`; the default is `openai/gpt-4o-mini`.

Do not put the key in `index.html` or commit it to source control. The key pasted into chat should be revoked and replaced in Vercel. The older OpenAI key previously embedded in the page should also be revoked.

Set `DATABASE_URL` for the PostgreSQL health check if you want the database status to run correctly.

## Deploying on Vercel

1. Import the repo on Vercel with *Root Directory* set to `backend` and *Application Preset* set to `Express`.
2. The shop page (`index.html`) and `images` folder live inside `backend`, so Vercel includes them.
3. Add these Environment Variables before deploying: `AI_GATEWAY_API_KEY` (needed for the chat assistant). Optional: `AI_GATEWAY_MODEL`, `DATABASE_URL`, `DATABASE_SSL`.
4. Deploy. Local use is unchanged: run `npm install` then `npm start` inside `backend`.

# Internal Frontier

Internal Frontier clothing storefront and live chat enquiry flow.

The storefront (`backend/public/index.html`) is served by the backend on `http://localhost:3000`. Customers can filter and search the collection, select sizes, save pieces to an enquiry bag, and send their selection to the shop on WhatsApp. This is an enquiry checkout rather than online payment processing.

## Backend

From the `backend` directory, install dependencies with `npm install` and start the API with `npm start`. The API listens on port `3000` by default and exposes `/`, `/health`, and `/api/chat`.

## Live chat agent

The chat widget posts to `/api/chat`. The backend sends the message to Vercel AI Gateway; the key stays on the server and is never sent to the browser.

For local development, set `AI_GATEWAY_API_KEY` before starting the backend. In PowerShell, from the `backend` directory, run:

```powershell
$env:AI_GATEWAY_API_KEY = "your-new-vercel-key"
npm start
```

That setting lasts only for the current terminal session. For Vercel, set the project Root Directory to `backend`, choose the Express preset, add `AI_GATEWAY_API_KEY` under Project Settings > Environment Variables for the environments you use, and redeploy. The Express app in `backend/server.js` handles `/api/chat`. You can optionally set `AI_GATEWAY_MODEL`; the default is `openai/gpt-4o-mini`.

The bag and WhatsApp checkout run in the browser and need no backend database. The checkout opens WhatsApp with the selected products and sizes; pricing and payment are confirmed by the shop there.

Do not put the key in `index.html` or commit it to source control. The key pasted into chat should be revoked and replaced in Vercel. The older OpenAI key previously embedded in the page should also be revoked.

Set `DATABASE_URL` for the PostgreSQL health check if you want the database status to run correctly.

## Deploying on Vercel

1. Import the repo on Vercel with *Root Directory* set to `backend` and *Application Preset* set to `Express`.
2. The shop page and product images are in `backend/public`, so Vercel includes them when `backend` is the project Root Directory.
3. Add these Environment Variables before deploying: `AI_GATEWAY_API_KEY` (needed for the chat assistant). Optional: `AI_GATEWAY_MODEL`, `DATABASE_URL`, `DATABASE_SSL`.
4. Deploy. Local use is unchanged: run `npm install` then `npm start` inside `backend`.

## Free AI option (Gemini)

The chat assistant can use a free Google Gemini key. In Vercel, add the Environment Variable `GEMINI_API_KEY` (get the key from aistudio.google.com) and redeploy. Optionally set `GEMINI_MODEL` (default `gemini-2.5-flash`). If `GEMINI_API_KEY` is set it is used first; otherwise the app falls back to `AI_GATEWAY_API_KEY`.

## Back office (admin dashboard)

The back office lives at `/admin` on the same site. Staff sign in with an email and password. The first visit shows a one-time setup screen that creates the administrator account.

What it covers:

* Dashboard: live pieces, stock on hand, open orders, paid revenue, low stock.
* Products: add pieces with photos, prices, sizes and colours; stock is tracked per size and colour. Removing a product hides it but keeps its order history.
* Orders: unique references (e.g. IF-2610-0001), server-calculated totals, stock reserved when an order is taken and returned if it is cancelled. Statuses: new, confirmed, dispatched, delivered, cancelled.
* Payments: a payment is recorded with method (EcoCash, cash, bank transfer), amount and reference. An order is only marked paid when the recorded payments cover its total, never by editing a status.
* Customers: contact details and history, matched by phone number.
* Staff: admin and staff roles. Admins manage staff accounts and see the audit trail.

### Back office environment variables

The back office needs a PostgreSQL database:

* `DATABASE_URL`: connection string from your database provider (Neon, Supabase, Vercel Postgres all work).
* `DATABASE_SSL`: set to `true` if the provider requires SSL (Neon does).
* `SESSION_SECRET`: a long random string that keeps staff sign-in sessions secure. If unset the app falls back to a development default, so always set it in production.

The storefront keeps working without these, using the pieces built into the page. Create the database, add the variables in Vercel under Project Settings > Environment Variables, redeploy, then open `/admin` to create the first account.

On Vercel, remember the project Root Directory is `backend` and the preset is Express.

### Photos and customer checkout

Product photos can be chosen straight from a device in the back office. The browser shrinks the photo, it is stored in the `media` table, and it is served from `/api/media/<id>` with long-lived caching.

Customers can also check out on the site: the bag shows prices and a total when prices are set, and "Check out on the site" collects their details, delivery area and payment method (EcoCash, cash on delivery or bank transfer). The order lands in the back office as a new order with a unique reference and the chosen method, stock is reserved immediately, and payment is confirmed by the shop on WhatsApp and recorded in the back office. Pieces without a price stay on "price on request" and continue through the WhatsApp enquiry flow.

### Automated EcoCash and InnBucks payments (Paynow)

Set these environment variables to switch on automatic mobile money payments:

* `PAYNOW_INTEGRATION_ID` and `PAYNOW_INTEGRATION_KEY`: from Paynow, under "Sell or Receive" then "Receive Payment Links". The receive payment link must be configured to include EcoCash and InnBucks, in USD.
* `PAYNOW_URL`: never set this in production. (Testing override only.)

When it is on, choosing EcoCash at checkout sends a PIN prompt to the customer's phone; InnBucks gives them an authorization code to approve in the InnBucks app. The storefront polls for approval, Paynow posts the final result to `/api/payments/paynow/callback` (hash-verified), and the order is marked paid automatically with the payment recorded in the audit trail. Webhooks are idempotent, and a tampered one is rejected. Without these variables the shop stays on the manual WhatsApp flow.

Every order has a printable receipt at `/receipt/<reference>` with a private token link, shown to the customer after checkout and available from the back office order detail.

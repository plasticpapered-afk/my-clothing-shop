# Dust Patrol Cleaning Services

Customer storefront and back office for Dust Patrol (KHAR-ECE Consortium, Harare). Customers pick a cleaning service, check out on the site, and pay with EcoCash or InnBucks (Paynow Express), bank transfer or cash. The back office at `/admin` manages services, bookings, customers, staff and payments.

## Run locally

From the `backend` directory, install dependencies with `npm install` and start the API with `npm start`. The app listens on port `3000` by default and serves the storefront at `/`, the back office at `/admin`, printable receipts at `/receipt/<reference>?t=<token>`, and live payment status pages at `/status/<reference>?t=<token>`.

Tests run with `npm test`.

## Environment variables

On Vercel (Root Directory `backend`, Express preset), set:

- `DATABASE_URL` and `DATABASE_SSL=true` — a Postgres database (Neon works well).
- `SESSION_SECRET` — any long random text used to sign back office logins.
- `PAYNOW_INTEGRATION_ID` and `PAYNOW_INTEGRATION_KEY` — from Paynow, "Receive Payment Links" area. Switch on EcoCash and InnBucks for that link, and remember Vercel Authentication (Deployment Protection) must be off so Paynow can reach `/api/payments/paynow/callback`.

## How the pieces fit

- **Storefront** (`backend/public/index.html`, `app.js`): brand hero, service strip, live service catalogue from the database, booking bag, on-site checkout with EcoCash / InnBucks / bank / cash choice, and the AI chat.
- **Back office** (`/admin`): staff login (admin and staff roles), dashboard with Paynow connection light, services with packages and capacity, bookings with unique `DP-` references, payments (automatic when Paynow confirms), customers, staff and an audit trail.
- **Payments**: Paynow Express Checkout. EcoCash sends the customer a PIN prompt on their phone; InnBucks shows an authorization code and app link. Only signed Paynow messages can mark a booking paid; unsigned replies are readable but never confirm money. The customer's status page polls until the payment lands and has a "send the prompt again" button.
- **Photos**: product photos can be chosen from a device in the back office, stored in the `media` table, and served from `/api/media/<id>`.

Amounts are USD. Prices are set per service (or per package) in the back office; services without a price show "price on request" and flow through the WhatsApp enquiry path.

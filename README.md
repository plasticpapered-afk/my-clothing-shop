# Internal Frontier

Internal Frontier clothing storefront and live chat enquiry flow.

The storefront is served from the backend on `http://localhost:3000`, where customers can filter and search the collection, select sizes, save pieces to an enquiry bag, and send their selection to the shop on WhatsApp.

## Backend

From the `backend` directory, install dependencies with `npm install` and start the API with `npm start`. The API listens on port `3000` by default and exposes `/`, `/health`, and `/api/chat`.

## Live chat agent

The chat widget posts a message to `/api/chat`. If `OPENAI_API_KEY` is present in the environment, the server uses the OpenAI chat completions API. If it is missing, it falls back to the local product-aware reply logic in `backend/chat-agent.js`.

Set `OPENAI_API_KEY` in your local terminal or environment before starting the server, and set `DATABASE_URL` for the PostgreSQL health check if you want the database status to run correctly.

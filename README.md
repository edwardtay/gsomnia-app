# gSomnia — Frontend

This project adds a minimal web frontend and server for gSomnia built on the Somnia publisher/subscriber examples.

What was added

- `server.js` — Express server that polls the Somnia stream (using the same SDK as `subscriber.js`) and exposes new messages over Server-Sent Events at `/events`. Also serves static files from `/public`.
- `public/index.html`, `public/app.js`, `public/style.css` — Simple UI that connects to `/events` and shows live messages.
- `package.json` updated with a `start` script and `express`/`cors` dependencies.

Publisher UI

- `public/publisher.html`, `public/publisher.js` — A small page that connects to an injected browser wallet (MetaMask), signs a message payload locally, and POSTs the signed payload to the server's `/publish` endpoint. The server verifies the signature and publishes the message to the Somnia stream using the server-side `PRIVATE_KEY` (server pays gas). This proves the publisher owns the address while letting the server broadcast the transaction.

Setup

1. Copy or create a `.env` file in the project root containing at least either `PUBLISHER_WALLET` (recommended) or `PUBLIC_KEY` to identify which publisher wallet to watch. You may already have `PRIVATE_KEY` for the publisher but the server only needs the public wallet address.

Example `.env`:

PUBLISHER_WALLET=0xYourPublisherAddress

2. Install dependencies:

```bash
npm install
```

3. Run the server:

```bash
npm start
```

4. Open http://localhost:3000 in your browser.

Notes

- The server polls every 3 seconds for new messages and pushes them to connected browsers via SSE.
- If you prefer a websocket approach, that can be added; SSE is simple and works well for one-way live updates.

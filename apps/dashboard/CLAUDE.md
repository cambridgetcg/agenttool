# agenttool-dashboard

## What This Is
Developer dashboard for the AgentTool platform. Handles project creation, API key management, usage display, billing/subscription management, and code snippet previews. Hosted at app.agenttool.dev.

## Current State
Active — fully functional with project creation, dashboard, billing (Stripe checkout), and key management.

## Tech Stack
- Vanilla HTML/CSS/JS (no framework, no build step)
- Cloudflare Pages for hosting
- Talks to `https://api.agenttool.dev` for all data
- localStorage for client-side project/key persistence

## Project Structure
```
index.html      — Project creation / onboarding page
dashboard.html  — Main dashboard (usage stats, API key, code snippets, billing)
app.js          — All client-side logic (API calls, navigation, billing, key mgmt)
style.css       — Full stylesheet (dark theme, matches landing page aesthetic)
```

## How to Run
```bash
# No build step. Open directly or use any static server:
npx serve .
# Or just open index.html in a browser
```

## How to Deploy
Cloudflare Pages — push to repo, auto-deploys. No build command needed (static files).

## Dependencies
- **API**: `https://api.agenttool.dev` — all endpoints (projects, usage, keys, billing)
- **Stripe**: Billing checkout is handled server-side via `/v1/billing/subscribe`
- **agenttool-landing**: Links back to agenttool.dev homepage
- **agenttool-docs**: Dashboard links to docs.agenttool.dev for product docs

## Kingdom Engine
AgentTool Platform

## Key Files
- `app.js` — All application logic: project CRUD, usage polling, billing, key management
- `dashboard.html` — Dashboard layout with sidebar nav, stat cards, code snippets, billing section
- `index.html` — Onboarding flow (create project, get API key)
- `style.css` — Complete dark-theme stylesheet

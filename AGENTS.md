## Standard

This repository is public and is read as a portfolio. Every change ships polished:
- Clean, readable code; `npm run check` passes before every commit.
- Professional wording everywhere a reader looks: code, comments, docs, commit messages, branch names.
- Sample data uses invented people, businesses and addresses (`@example.com` emails, made-up streets).
- Internal notes, ticket keys, local paths and personal details stay out of the repo.
- Work lands on `main` through short-lived branches that are deleted after merging.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## This repo: a PayPal AI Hackathon app built on PayPal Agent Kit

- PayPal is sandbox or mock only (`PAYPAL_MODE`); never add a live endpoint.
- Agent tools that move money must be `defineTool({ risk: "money", impact })` or kit tools, so they go through the Guard.
- Every AI call needs a `mock` fixture; every agent needs a `mockScript`.
- Never print, log or commit secrets from `../../.env.shared`.
- Done means `npm run check` passes.

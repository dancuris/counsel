# Counsel

Most AI job tools help you apply to more roles. Counsel talks you out of the wrong ones.

It holds a rigorous, correctable model of one person's positioning, gaps included, and grounds
every judgement and document in it: fit evaluations that will say pass, tailored resumes and cover
letters, interview prep packages, and recruiter correspondence. Live at [tracker.ecuris.com](https://tracker.ecuris.com).

## Run your own copy

Counsel is one deployment per person: your own database, your own model keys, your own mailbox.
Nothing is shared, and there is no server of mine holding your job search.

You need a GitHub account, a Vercel account and a Postgres database. About ten minutes.

1. **Fork this repository**, then import the fork at [vercel.com/new](https://vercel.com/new).
2. **Add a database.** In the Vercel project, Storage → create a Neon Postgres database. That sets
   `DATABASE_URL` for you.
3. **Set one secret.** Project Settings → Environment Variables, add `SESSION_SECRET`:

   ```bash
   openssl rand -base64 32
   ```

4. **Deploy.** The build applies the database migrations itself, so the tables are there when it
   starts. If the migration fails the build stops and the deploy does not go out.
5. **Open your URL and claim it.** A new instance has no owner, so the first person to set an email
   and password becomes the owner. Do this promptly, or set `SETUP_TOKEN` first and the claim will
   require it.
6. **Answer the setup questions** at `/setup/start`: paste your resume, answer eight short
   questions, and the app writes its own profile for you to correct.

That is the whole of it. **No Google Cloud project is needed**, and nothing above asks you to
configure an OAuth consent screen.

### The one-click version, on their own account

For somebody who should own their own data, a deploy button puts the whole
thing on **their** Vercel and **their** Neon account. You never hold credentials
to their database, which is the only version of "I cannot see your job search"
that is a fact rather than a promise.

```
https://vercel.com/new/clone?repository-url=https://github.com/dancuris/job-search-tracker&integration-ids=<neon-integration-id>&env=SESSION_SECRET&envDescription=Signs%20your%20login%20cookie&envLink=https://github.com/dancuris/job-search-tracker%23run-your-own-copy
```

`integration-ids` makes the Neon integration **mandatory before the project can
be imported**, and Neon creates an account and a database for them if they do
not have one. Find the id in Vercel's Integrations Console.

Two limits worth knowing before promising anyone a one-click install:

- **The repository has to be public.** A deploy button clones from a public URL.
- **`SESSION_SECRET` is still one pasted field.** It cannot be generated on
  first boot, because the auth gate runs in Next's Edge runtime where Prisma
  cannot reach a database, so a secret stored in their database could never be
  read by the thing that checks sessions. One field, with a description telling
  them what to run.

They will also need a GitHub account, since the button clones the repo into it.
That is the real hurdle for a non-technical friend, and the reason hosting them
yourself still has a place.

### Setting one up for somebody else, in one command

Doing the above by hand takes about fifteen minutes and has four traps in it,
all of them artifacts of the Vercel web UI rather than of this app. The API has
none of them, because environment variables can be set in the same call that
creates the project.

```bash
export VERCEL_TOKEN=...    # vercel.com/account/tokens
export NEON_API_KEY=...    # console.neon.tech/app/settings/api-keys
npx tsx scripts/provision-instance.ts --name counsel-alex
```

That creates the Neon database, generates `SESSION_SECRET` and a `SETUP_TOKEN`,
creates the Vercel project with both already set, deploys it, waits for the
build, and prints the URL and the token to hand over.

It deliberately stops short of claiming the instance, since the point is that
the other person owns it. The setup token is what makes sending the link safe:
without one, an unclaimed instance belongs to whoever opens it first. Pass
`--no-token` to skip it, `--repo` and `--ref` to deploy something other than
this repository's `production` branch.

### What you can add later, and what each one buys

None of these are required, and the app is a working tracker without any of them.

| Add | You get |
| --- | --- |
| An Anthropic or Gemini key, in Settings | Fit verdicts that will tell you to pass, tailored resumes and cover letters, interview prep |
| A job-search mailbox (Gmail, read-only) | Recruiter mail filed against the right role, rejections and invitations moving the pipeline by themselves |
| A calendar feed URL (any provider) | Meetings booked elsewhere showing up on Today, and a clash warning on a proposed interview time |
| Google Drive | Every document filed into folders you already have |

Model keys are encrypted before they are stored and are billed to you and nobody else.

## Stack

- **Next.js 16** (App Router, Server Actions). Note the repo's `AGENTS.md`: this version has
  breaking changes from earlier Next, so check `node_modules/next/dist/docs/` rather than relying
  on older conventions.
- **Prisma 7** with `@prisma/adapter-pg` against **Neon Postgres**
- **Anthropic SDK** for evaluations, documents, interview prep, and correspondence
- **Password sign-in** for an instance you deploy yourself, or **Google OAuth** (hand-rolled with
  `jose`) locked to a single authorized email where `ALLOWED_EMAIL` is set
- Installable as a **PWA** on iOS via Add to Home Screen

## ⚠️ Local dev and production share one database

`DATABASE_URL` in `.env.local` points at the **same Neon database** production uses (production
just uses the pooled endpoint). There is no separate dev database.

This means **anything you change locally is immediately live**, including destructive changes. It
also means profile and content edits need no deploy to take effect. Be deliberate about writes when
running locally.

**If the Neon console says you have no projects, you are signed in as the wrong person.** Neon
treats "Continue with Google", "Continue with GitHub" and email/password as separate accounts even
when the address is identical, so the wrong one lands on an empty dashboard rather than an error.
Sign out and switch method before concluding anything is missing. Also worth checking the
organization switcher, since a project can sit under an org instead of a personal space.

Schema changes normally go through `npx prisma migrate deploy` from a machine with `.env.local`.
Running the SQL by hand in the Neon console works too, but insert the matching rows into
`_prisma_migrations` at the same time - otherwise the next `migrate deploy` tries to re-apply them
and fails on "relation already exists".

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npx prisma generate
npm run dev
```

Only `DATABASE_URL` and `SESSION_SECRET` are required. Everything else in `.env.example` switches
on a capability and can be left unset, or added later from Settings.

`ALLOWED_EMAIL` is what locks an instance to one Google account. Setting it also means the instance
can never be claimed with a password, which is what protects a deployment that is already in use.
Where Google sign-in is used, both the local and production `/api/auth/google/callback` URLs must be
registered as authorized redirect URIs on the OAuth client, since the redirect URI is matched
exactly.

## Deploying

Pushing to `main` deploys to production automatically via the Vercel GitHub integration. Manual
deploys still work if needed:

```bash
vercel deploy --prod
```

Schema changes need a migration committed alongside the code:

```bash
npx prisma migrate dev --name <what_changed>
```

## Layout

| Path | What lives there |
| --- | --- |
| `src/app/page.tsx` | Dashboard: interview-stage roles, pipeline, sidebar modules |
| `src/app/applications/[id]/` | Application detail, server actions, per-application UI |
| `src/app/api/evaluate/` | Fit evaluation; also extracts stated comp from the posting |
| `src/app/api/generate-documents/` | Resume and cover letter drafting |
| `src/app/api/generate-interview-prep/` | Interview prep package |
| `src/lib/profile-context.ts` | Builds the standing profile context every AI call is grounded in |
| `src/lib/document-format.ts` | The markdown-lite contract shared by the docx and pdf renderers |
| `src/proxy.ts` | Auth gate. Excludes PWA install assets, which must stay public |

## How the AI calls stay grounded

Every model call is grounded in the singleton `Profile` row via `buildProfileContext()`, which
carries positioning, career narrative, logistics constraints, document preferences, and the role
evaluation framework. **Editing the Profile changes model behavior immediately, with no deploy** —
it is read fresh on each request. That record, not the prompt text in the routes, is the right place
to correct how roles get judged.

Tool schemas use `strict: true`. Keep it that way: without it the model can return a field in the
wrong shape entirely, and a prep response that came back with an array field as a string once
produced a 318,000-character garbage document.

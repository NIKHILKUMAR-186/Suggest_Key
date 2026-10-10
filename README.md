<!-- <div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/0ba6805a-16b6-494b-b8df-b23aaf037639

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev` -->
# Suggest Key 🚀

**A mentorship marketplace connecting seekers with verified mentors for personalized, one-to-one mentoring sessions.**

Suggest Key helps users discover mentors, explore mentorship segments, book sessions, complete payments, attend meetings, and access personalized post-session notes and recommendations.

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [User Roles](#-user-roles)
- [Technology Stack](#-technology-stack)
- [System Architecture](#-system-architecture)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Database Setup](#-database-setup)
- [Available Scripts](#-available-scripts)
- [Application Routes](#-application-routes)
- [Payment System](#-payment-system)
- [Security](#-security)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [Project Structure](#-project-structure)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

Suggest Key is an India-focused mentorship platform designed to make personalized guidance accessible through structured, one-to-one sessions.

The platform supports three primary roles:

- **Seekers:** Discover mentors and book mentoring sessions.
- **Mentors:** Manage their profiles, services, availability, bookings, and session outcomes.
- **Administrators:** Manage users, approve mentors, oversee payments, configure mentorship segments, and operate the platform.

The application uses Supabase as its backend infrastructure and provides a React-based frontend with an Express API.

### Core User Journey

```text
Discover a Mentor
       ↓
Select a Mentorship Service
       ↓
Choose an Available Time Slot
       ↓
Reserve the Slot (5 Minutes)
       ↓
Complete Payment
       ↓
Mentor Confirms the Session
       ↓
Attend the Session
       ↓
Access Notes and Recommendations
```

---

## ✨ Key Features

### 👤 Authentication and Account Management

- Email and password authentication.
- Email verification and password recovery.
- Role-based access control.
- User profile management.
- Account suspension and activation controls.
- Protected routes and server-side authorization.

### 🎯 Mentor Discovery

- Browse mentorship segments and topics.
- Explore mentor profiles and available services.
- View session duration and pricing.
- Filter mentor discovery by relevant criteria.
- Display segment-specific experiences and content.
- Load real application data from Supabase-backed APIs.

### 🗓️ Availability and Booking

- Recurring weekly mentor availability.
- Date-specific availability exceptions.
- Dynamic server-side slot generation.
- Five-minute temporary booking holds.
- Database-enforced booking conflict prevention.
- Booking cancellation and rescheduling workflows.
- Server-authoritative booking and session states.

### 💳 Payments

- Manual UPI and QR-code payments.
- Payment-proof uploads.
- Administrator payment verification.
- Optional Razorpay Checkout integration.
- Server-side payment signature verification.
- Payment event tracking and webhook processing.
- Coupon codes, discounts, and original-price support.
- Refund workflows for supported payment paths.

**Default payment method:** Manual UPI/QR.

Razorpay is optional and must be explicitly enabled through server-side configuration.

### 🎓 Mentor Workspace

- Mentor profile and service management.
- Segment membership management.
- Availability scheduling.
- Booking confirmation and meeting-link management.
- Session lifecycle management.
- Post-session notes, takeaways, and recommendations.

### 🛠️ Administration

- User and mentor management.
- Mentor application and document verification.
- Segment and topic management.
- Booking and payment oversight.
- Coupon management.
- Notification management.
- Support-ticket management.
- Platform configuration.
- System health, logging, and audit facilities.

### 💬 Support System

- Support-ticket creation.
- Ticket replies and internal notes.
- Attachment support.
- Ticket status management.
- Administrative resolution workflows.

---

## 👥 User Roles

| Role | Responsibilities |
|---|---|
| Seeker | Discover mentors, book sessions, pay, attend, and access session workspaces. |
| Mentor | Manage services and availability, confirm bookings, conduct sessions, and publish session notes. |
| Admin | Manage users, approve mentors, oversee payments, manage content, and resolve operational issues. |

A user may hold multiple roles when authorized by the application.

---

## 🧰 Technology Stack

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Lucide React
- Motion
- Supabase JavaScript Client

### Backend

- Node.js 22
- Express 4
- TypeScript
- Zod validation
- esbuild

### Database and Infrastructure

- Supabase Authentication
- PostgreSQL
- Row Level Security (RLS)
- Supabase Storage
- Supabase Realtime
- PostgreSQL RPC functions
- `pg_cron` for scheduled database operations

### Payments

- Manual UPI/QR payment workflow
- Optional Razorpay integration using server-side HTTP requests

### Hosting and Deployment

- Vercel
- Vercel Node.js Functions
- Vite static build
- Supabase managed backend

---

## 🏗️ System Architecture

```text
┌───────────────────────────────────────┐
│           React Frontend              │
│      React + TypeScript + Vite        │
└──────────────────┬────────────────────┘
                   │
                   │ HTTPS / JSON
                   ▼
┌───────────────────────────────────────┐
│          Express API Server           │
│                                       │
│ Authentication and Authorization     │
│ Booking and Availability              │
│ Payments and Refunds                  │
│ Notifications and Support             │
│ Validation and Audit Logging          │
└──────────────────┬────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────┐
│             Supabase                  │
│                                       │
│ Authentication                        │
│ PostgreSQL + RLS                      │
│ Storage                               │
│ Realtime                              │
│ Database RPCs and Constraints         │
└───────────────────────────────────────┘
```

### Architectural Principles

- The backend is the source of truth for application operations.
- The database enforces critical booking and concurrency constraints.
- Payment amounts and payment verification are determined server-side.
- Sensitive credentials remain on the server.
- API routes validate incoming data before processing it.
- Protected operations fail closed when authorization or required infrastructure is unavailable.

---

## 🚀 Getting Started

### Prerequisites

Install the following before starting development:

- Node.js 22.x
- npm
- Git
- A Supabase project
- A configured development environment

Optional:

- Supabase CLI for database migrations.
- A Razorpay account if testing the optional Razorpay payment flow.

### 1. Clone the Repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd Suggest_key
```

Replace `<YOUR_REPOSITORY_URL>` with your actual Git repository URL.

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a local environment file using the example:

```bash
cp .env.example .env
```

On Windows PowerShell, you can use:

```powershell
Copy-Item .env.example .env
```

Update the environment variables with your own development credentials.

Never commit real secrets to Git.

### 4. Configure Supabase

Configure the Supabase project URL and publishable/anonymous client key as required by the application's existing environment configuration.

Apply database migrations in the correct order using the Supabase CLI or the SQL editor.

### 5. Start Development

```bash
npm run dev
```

The Express development server starts through `tsx server.ts`. The development setup also uses Vite for frontend assets and development behavior.

Use the development server's configured local address to open the application.

### 6. Build for Production

```bash
npm run build
```

The build process runs:

1. Frontend production build.
2. Express server bundling.
3. Distribution verification.

The server bundle is generated at `api/index.cjs` for the Vercel Node.js runtime.

---

## 🔐 Environment Variables

The authoritative environment configuration is `.env.example` and the corresponding configuration code.

The following table lists important configuration categories. Exact variable names should be verified against the current `.env.example`.

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL used by the frontend. |
| `VITE_SUPABASE_ANON_KEY` | Supabase client key used by the frontend. |
| `RAZORPAY_ENABLED` | Enables Razorpay when set to exactly `true`. |
| `RAZORPAY_KEY_ID` | Razorpay key identifier. |
| `RAZORPAY_KEY_SECRET` | Server-only Razorpay secret. |
| `RAZORPAY_WEBHOOK_SECRET` | Server-only webhook verification secret. |
| `RAZORPAY_API_BASE` | Optional Razorpay API base URL override. |

Additional configuration may be required for database access, logging, demo authentication, and operational features.

**Security requirements:**

- Never expose the Supabase service-role key to the browser.
- Never prefix private secrets with `VITE_`.
- Never commit `.env` files containing real credentials.
- Keep production secrets in the hosting provider's environment settings.
- Use separate credentials for development, staging, and production.

---

## 🗄️ Database Setup

Suggest Key uses Supabase PostgreSQL as its authoritative data store.

The repository contains database migrations under:

```text
supabase/
└── migrations/
    ├── 20260920000000_phase3_auth_roles.sql
    ├── 20260920000001_phase4_mvp_schema.sql
    ├── ...
    └── <subsequent migrations>
```

The migration directory is the source of truth for database schema changes.

### Applying Migrations

Using the Supabase CLI, after linking and configuring the intended project:

```bash
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
supabase db push
```

Review the target project and migration history before applying changes.

For a new environment, verify that all migrations are present, ordered correctly, and compatible with the target database.

Do not assume that objects created manually in a production database will automatically exist in a newly created staging database.

### Database Responsibilities

The database is responsible for:

- User roles and profile relationships.
- Mentor profiles, segments, topics, and services.
- Recurring availability and date exceptions.
- Booking and slot-hold integrity.
- Payment records and event tracking.
- Notifications and support tickets.
- Row-level access policies.
- Atomic booking operations.
- Scheduled hold-expiration and reconciliation tasks.

**Important:** Review the migration history and environment-specific database configuration before running migrations against a production database.

---

## 📜 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Express development server. |
| `npm start` | Start the application server. |
| `npm run build` | Build the frontend and server, then verify the output. |
| `npm run build:web` | Build the frontend using Vite. |
| `npm run build:server` | Bundle the Express server for deployment. |
| `npm run build:verify` | Verify the production build artifacts. |
| `npm run lint` | Run the configured TypeScript validation. |
| `npm test` | Execute the Node.js test suite through `tsx`. |

Run a command from the project root:

```bash
npm run lint
npm test
npm run build
```

---

## 🧭 Application Routes

### Public Routes

| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/auth/login` | Login |
| `/auth/signup` | Registration |
| `/auth/forgot-password` | Password recovery |
| `/auth/reset-password` | Password reset |
| `/auth/verify` | Email verification |
| `/mentor/signup` | Mentor application |
| `/mentor/verification` | Mentor verification workflow |
| `/mentors` | Mentor directory |

### Seeker Routes

| Route | Purpose |
|---|---|
| `/seeker` | Seeker home |
| `/seeker/mentors` | Mentor discovery |
| `/seeker/mentor-profile` | Mentor profile |
| `/seeker/mentor-detail` | Booking and slot selection |
| `/seeker/bookings` | Booking history |
| `/seeker/booking-detail` | Booking details |
| `/seeker/payment` | Checkout and payment |
| `/seeker/session` | Session access |
| `/seeker/workspace` | Session workspace |
| `/seeker/notifications` | Notifications |
| `/seeker/settings` | Account settings |
| `/seeker/support` | Support tickets |

### Mentor Routes

| Route | Purpose |
|---|---|
| `/mentor` | Mentor home |
| `/mentor/bookings` | Mentor bookings |
| `/mentor/booking-detail` | Booking management |
| `/mentor/availability` | Availability management |
| `/mentor/gigs` | Mentorship services |
| `/mentor/segments` | Segment membership |
| `/mentor/workspace` | Session workspace |
| `/mentor/notifications` | Notifications |
| `/mentor/settings` | Account settings |
| `/mentor/support` | Support tickets |

### Admin Routes

The administrative application includes routes for:

- `/admin` — Dashboard
- `/admin/users` — User management
- `/admin/mentors` — Mentor management
- `/admin/mentor-verification` — Verification queue
- `/admin/segments` — Segment management
- `/admin/bookings` — Booking oversight
- `/admin/workspaces` — Workspace oversight
- `/admin/payments` — Payment verification
- `/admin/coupons` — Coupon management
- `/admin/notifications` — Notification management
- `/admin/system-health` — System monitoring
- `/admin/support` — Support-ticket management
- `/admin/settings` — Platform configuration

The application's `src/routes/Router.tsx` defines the actual route matching and access-control behavior.

---

## 💳 Payment System

Suggest Key supports two payment workflows.

### Manual UPI/QR

```text
Create Booking
      ↓
Hold Slot
      ↓
Pay Through UPI/QR
      ↓
Upload Payment Proof
      ↓
Admin Verifies Payment
      ↓
Booking Moves to Mentor
```

This is the default workflow.

### Razorpay

```text
Create Booking
      ↓
Create Payment Order
      ↓
Razorpay Checkout
      ↓
Server Verifies Payment
      ↓
Booking Moves to Mentor
```

Razorpay must be explicitly enabled through server-side configuration.

Payment processing follows these principles:

- The server determines the payable amount.
- Payment signatures are verified server-side.
- Webhook signatures are validated against the raw request body.
- Repeated payment operations are handled idempotently where implemented.
- The browser cannot independently authorize a booking as paid.

---

## 🛡️ Security

Security is a core architectural requirement.

### Implemented Security Controls

- Role-based authorization.
- Protected application routes.
- Server-side request validation using Zod.
- PostgreSQL Row Level Security.
- Database-enforced booking constraints.
- Server-side payment verification.
- Restricted execution privileges for sensitive database functions.
- Server-only service-role access.
- Request logging and audit facilities.
- Rate limiting on configured endpoints.
- Sanitization of sensitive log data.

### Security Best Practices

- Store production secrets only in secure environment configuration.
- Keep dependencies updated.
- Apply database migrations through a reviewed workflow.
- Test role boundaries using separate seeker, mentor, and admin accounts.
- Verify payment behavior in staging before enabling it in production.
- Never bypass authorization checks to fix frontend access issues.
- Review security audit findings before each production release.

Security controls must be verified against the current code and database configuration; this README is not a substitute for a security audit.

---

## 🧪 Testing

The project uses Node.js's built-in test runner through `tsx`.

Run the full suite:

```bash
npm test
```

Run TypeScript validation:

```bash
npm run lint
```

Run the complete production build:

```bash
npm run build
```

### Recommended Verification Before Deployment

1. TypeScript validation completes successfully.
2. Relevant automated tests pass.
3. Production build verification passes.
4. Authentication and role authorization work correctly.
5. Booking holds and overlapping bookings are tested.
6. Payment verification and failure paths are tested.
7. Database migrations are synchronized.
8. Critical API endpoints return JSON rather than the SPA HTML document.
9. Staging workflows are verified before production release.

Test results can change as the codebase evolves. Always use the latest test output rather than assuming that a previous run passed.

---

## ☁️ Deployment

Suggest Key is configured for deployment on Vercel.

### Deployment Architecture

- Vite produces static frontend assets in `dist/`.
- esbuild bundles the Express application into `api/index.cjs`.
- Vercel runs the backend through `@vercel/node`.
- API requests are routed through the Express handler.
- Non-API application routes fall back to the SPA entry point.

### Production Checklist

- [ ] Configure all required production environment variables.
- [ ] Verify Supabase project credentials.
- [ ] Confirm database migration history is synchronized.
- [ ] Verify RLS policies and database function permissions.
- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Verify the generated `api/index.cjs` artifact.
- [ ] Test API endpoints in the deployed environment.
- [ ] Test authentication, booking, and payment workflows.
- [ ] Verify storage bucket permissions.
- [ ] Review application logs after deployment.

**Critical:** Preserve the existing `vercel.json` function declaration and API rewrite configuration when modifying deployment settings. These settings are part of the application's tested deployment architecture.

---

## 📁 Project Structure

```text
Suggest_key/
├── agent/                  # Security testing skills and resources
├── api/                    # Vercel API entrypoint build artifact
├── docs/                   # Architecture, audits, rules, and specifications
├── public/                 # Static assets, icons, and landing-page media
├── scripts/                # Verification, audit, and operational scripts
├── src/
│   ├── components/         # Shared UI and role-specific components
│   ├── config/             # Application configuration and navigation
│   ├── context/            # React contexts and shared state
│   ├── hooks/              # Application hooks and synchronization
│   ├── lib/                # API clients and domain logic
│   ├── pages/
│   │   ├── admin/          # Admin application
│   │   ├── auth/           # Authentication pages
│   │   ├── mentor/         # Mentor application
│   │   ├── public/         # Public pages
│   │   └── seeker/         # Seeker application
│   ├── routes/             # Application routing
│   ├── types/              # TypeScript definitions
│   ├── App.tsx             # Application composition
│   ├── index.css           # Global styles and design tokens
│   └── main.tsx            # Frontend entry point
├── supabase/
│   └── migrations/         # Database schema and security migrations
├── tests/                  # Automated tests
├── .env.example            # Environment configuration template
├── package.json            # Dependencies and scripts
├── server.ts               # Express application
├── tsconfig.json           # TypeScript configuration
├── vercel.json             # Vercel deployment configuration
└── vite.config.ts          # Vite configuration
```

The structure above is representative; consult the repository for the complete file listing.

---

## 📚 Documentation

Additional project documentation is maintained in `docs/`.

| Document | Purpose |
|---|---|
| `docs/architecture.md` | Current technical architecture |
| `docs/rules.md` | Application and database invariants |
| `docs/prd.md` | Product requirements and implementation status |
| `docs/SUGGEST-KEY-MVP-UPDATED.md` | MVP product and technical specification |
| `docs/technical-audit.md` | Technical findings and unresolved defects |
| `docs/data-source-audit.md` | Data-source classification and fallback audit |
| `docs/payment_audit.md` | Payment-system audit |
| `docs/SUGGEST-KEY-UI-DESIGN-SYSTEM.md` | UI design-system documentation |
| `docs/audit/CRITICAL-01-security-definer-inventory.md` | Database function privilege audit |

Refer to these documents for detailed implementation decisions, database behavior, security constraints, and known technical limitations.

---
<!-- 
## 🤝 Contributing

Contributions should preserve the existing architecture and business invariants.

1. Review the relevant documentation before changing core workflows.
2. Create a dedicated branch for your changes.
3. Keep business logic out of presentation components where practical.
4. Validate API input and enforce authorization server-side.
5. Preserve database constraints and transaction boundaries.
6. Add regression tests for bug fixes.
7. Update documentation whenever behavior or architecture changes.
8. Run the relevant tests and production build before submitting changes.

Changes affecting bookings, payments, authentication, or database security require particular care.

---

## 📄 License

No license has been specified in this README.

Add an appropriate `LICENSE` file and update this section before distributing the project publicly.

--- -->

**Suggest Key — Better guidance. Better decisions. Better outcomes.**
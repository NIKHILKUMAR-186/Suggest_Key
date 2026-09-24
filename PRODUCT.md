# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Seekers looking for one-to-one mentorship, mentors offering approved sessions, and administrators operating the marketplace.

## Product Purpose

Suggest Key helps seekers discover approved mentors, check real availability, hold a session slot, pay for a booking, attend the session, and review the resulting session workspace.

## Positioning

A human mentorship marketplace where discovery, availability, booking, and session follow-through are connected in one role-based product.

## Operating Context

The seeker journey is discover mentor, select date, view available mentors, select slot, hold slot, complete manual QR payment, receive admin payment verification, receive mentor confirmation, join the session, complete it, and open the session workspace.

## Capabilities and Constraints

- Seeker navigation is Home, My Bookings, Notifications, and Settings using top navigation without a seeker sidebar.
- Mentor segments are database-backed and priority ordered; the highest-priority active segment is selected on Home.
- Mentor discovery requires an approved, active mentor, the selected segment, an active gig, and at least one valid bookable slot for the selected date.
- Availability is globally owned by the mentor and is not gig-specific.
- Slots are generated from recurring availability, date exceptions, bookings, active holds, gig duration, current time, and mentor timezone. UTC remains the storage standard.
- A selected slot is held for 15 minutes; the server is authoritative for hold expiration.
- Payment uses the existing manual QR and proof-upload architecture. Payment verification and rejection preserve the existing booking state rules.
- Meeting links remain hidden until five minutes before the session, and join authorization remains server-side.
- Cancellation and rescheduling remain limited by the existing 24-hour rule.
- Production UI must use real Supabase data and must not render fabricated mentors, prices, availability, bookings, notifications, payment states, or metrics.

## Brand Commitments

- Product name: Suggest Key.
- Seeker experience should feel premium, calm, trustworthy, human, editorial, modern, spacious, conversion-focused, and accessible.
- Existing product terminology and business rules in the project documentation are authoritative.

## Evidence on Hand

- `docs/SUGGEST-KEY-MVP-UPDATED.md`
- `docs/architecture.md`
- `docs/prd.md`
- `docs/rules.md`
- `docs/memory.md`
- Existing React, Tailwind, Supabase, Motion, and Lucide implementation in `src`.

## Product Principles

- Discover before booking: help seekers understand the mentor, offer, price, and availability before taking action.
- Backend truth wins: UI represents real data and server-authoritative rules.
- Preserve the journey: discovery, trust, availability, booking, attendance, and follow-through remain connected.
- Keep the interface calm and readable while making the next action obvious.
- Accessibility and authorization are product requirements, not visual enhancements.

## Accessibility & Inclusion

Use semantic HTML, keyboard navigation, visible focus states, accessible labels, sufficient contrast, screen-reader-friendly status messages, non-color status communication, and mobile touch targets.

# Suggest Key — Product Requirements Document

Version: 1.0  
Status: MVP

## 1. Product
Suggest Key is a mentorship marketplace that connects seekers with appropriate mentors for 1:1 mentorship sessions.

## 2. Core MVP Loop
```text
Discover mentor
→ Select slot
→ 15-minute hold
→ Manual QR payment
→ Upload proof
→ Admin verification
→ Mentor confirmation
→ Join at T-5
→ Complete session
→ Session workspace
```

## 3. Roles

### Seeker
- Sign in
- Manage profile
- Discover segments and mentors
- Select date and slot
- Hold and pay
- Upload payment proof
- Track booking/payment
- Receive notifications
- Join eligible sessions
- View history/workspace
- Cancel/reschedule when eligible

### Mentor
- Sign in
- Manage profile
- Manage segments and gigs
- Configure pricing/duration
- Manage global availability
- Manage bookings
- Add meeting links
- Confirm sessions
- Manage session workspace
- Receive notifications

### Admin
- Manage users and mentors
- Approve/deactivate mentors
- Manage segments and gigs
- View availability/bookings
- Approve/reject payments
- Intervene in booking issues
- Manage notifications/settings
- View session workspaces

## 4. Navigation
### Seeker — Top Nav
Home · My Bookings · Notifications · Settings

### Mentor — Top Nav
Home · My Bookings · Availability · Notifications · Settings

### Admin — Sidebar
Dashboard · Users · Mentors · Segments · Bookings · Payments · Notifications · Settings

## 5. Discovery
A mentor is discoverable only if:
1. approved
2. active
3. belongs to selected segment
4. has active gig for selected segment
5. has at least one valid slot on selected date

A mentor with zero valid slots must not appear in available results.

## 6. Gigs
One active gig per mentor per segment.

```text
UNIQUE(mentor_id, segment_id)
```

## 7. Availability
- Global at mentor level.
- Weekly recurring availability.
- Date exceptions.
- Exceptions override recurring availability.
- Slots dynamically generated.
- Past slots never bookable.

## 8. Booking/Hold
- Slot hold: 15 minutes.
- Active hold blocks other seekers.
- Expired hold releases slot.
- Payment rejection releases slot.
- Payment approval keeps the time blocked and moves booking to mentor pending.

## 9. Payment
Manual QR MVP.

Payment screen:
- booking summary
- mentor
- segment
- date/time
- duration
- amount
- QR
- instructions
- deadline
- proof upload

Admin is final payment verifier.

## 10. Mentor Confirmation
After payment approval:
- booking = MENTOR_PENDING
- mentor gets notification
- mentor adds meeting link
- mentor confirms

Meeting link must be HTTPS.

## 11. Session
- Link hidden until T-5 minutes.
- Join denied before T-5.
- Join allowed from T-5 until end.
- Join denied after end.
- Server-side validation required.

## 12. Workspace
Completed sessions have:
- overview
- mentor notes
- key takeaways
- suggestions
- next steps
- optional follow-up recommendation

## 13. Cancellation/Reschedule
Seeker normal cancellation/rescheduling is allowed only at least 24 hours before session start. Admin may intervene.

## 14. Notifications
MVP channel: in-app.

Events include booking creation, payment submission/decision, mentor confirmation, meeting-link availability, reminders, cancellation, rescheduling, completion and workspace updates.

## 15. UX
- Real data only.
- Clear loading/empty/error/success states.
- No fake availability, notifications, charts or business metrics.
- Seeker/mentor UI is focused and uncluttered.
- Admin UI is operational and information-dense.

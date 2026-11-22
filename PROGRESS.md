# Curasys HMS progress

## Stage 1 — audit and plan

Status: complete. Branch: `post-review-fixes`.

| Product rule | Exists? | Files | Missing or follow-up |
|---|---|---|---|
| Administrator only manages accounts | No | `src/App.jsx`, `server/index.js` | Admin UI currently loads/shows beds, bills, appointments, vitals, preliminary checks, and audit records; the server also grants admin access to several operational routes. Reduce admin to account lists, search, active/deactivate, and password reset. |
| Admin creates all account roles | Yes | `src/App.jsx`, `server/index.js`, `shared/constants.js` | Existing unified account form and role dropdown work; add lifecycle actions for every non-public account role. |
| Admin resets/deactivates any account | Partial | `src/App.jsx`, `server/index.js` | Existing reset/deactivate routes are patient-only (`/api/patients/:id/...`); add admin-only role-neutral routes and integration tests. |
| Receptionist registration and booking | Partial | `src/App.jsx`, `server/index.js`, `server/models/Appointment.js` | Patient, department, doctor, date, and hourly time are selects/date controls; patient age is calculated from date of birth. Booking symptoms is still free text, and the booking flow needs the required status workflow. |
| Nurse preliminary checks | Yes | `src/App.jsx`, `server/index.js`, `server/models/Vital.js`, `shared/constants.js` | Existing server permissions, fixed symptom list, numeric validation, and audit coverage are present; connect the appointment workflow states. |
| Doctor edits checks and writes prescriptions | Partial | `src/App.jsx`, `server/index.js`, `server/models/Prescription.js` | Advice and nurse-check editing exist; medicine timing is a free-text route field, not the required fixed `whenToTake` dropdown/list. |
| Patient sees only own prescriptions and bills | Yes | `src/App.jsx`, `server/index.js`, `server/api.integration.test.js` | Existing API ownership filters and 403 protections are covered; re-run after later changes. |
| Receptionist bills from doctor prescription | Partial | `src/App.jsx`, `server/index.js`, `server/models/Billing.js` | Server totals, payment methods, and demo QR exist; line items are currently entered manually and are not generated/populated from prescription medicines. |
| Appointment workflow | No | `server/models/Appointment.js`, `src/App.jsx`, `shared/constants.js` | Current statuses are only `Scheduled`, `Completed`, and `Cancelled`; add `Booked`, `Checked in`, `Vitals done`, `Consulted`, `Billed`, and `Paid` with server validation and role transitions. |
| Staff sign-in role selection | No | `src/App.jsx`, `server/index.js` | Login uses email/password and derives the role from the server; there is no role dropdown. Decide whether to add a non-authoritative role hint or keep server-derived role-only authentication. |

## Configuration audit

- `server/.env` exists and contains an `MONGODB_URI` assignment; its value was not printed.
- `GET http://localhost:3001/api/health` returned HTTP 200 with `{"status":"ok","database":"connected"}`.
- `render.yaml` expects Node 22.12.0, production API secrets, the production client origin, the API base URL, and 24-hour defaults (`CLINIC_START_HOUR=0`, `CLINIC_END_HOUR=24`) for both services.
- No production database was used for testing.

## Stage 2 — administrator accounts only

Status: implemented locally and pushed for CI verification.

- Replaced the admin route with a new account-only workspace in `src/components/AdminAccountsOnlyDashboard.jsx`.
- Reused the existing unified account creation form and added searchable lists for administrators, doctors, medical staff, receptionists, and patients.
- Added active/inactive toggles and one-time generated temporary-password reset dialogs.
- Added admin-only `GET /api/users`, `POST /api/users/:id/reset-password`, and `PATCH /api/users/:id/active`.
- Password resets set `mustChangePassword`, update `passwordChangedAt`, increment `sessionVersion`, audit the action, and return the temporary password once.
- Deactivation increments `sessionVersion`, blocks login, invalidates existing tokens, blocks self-deactivation, and protects the last active administrator.
- Removed administrator access from beds, billing, appointments, prescriptions, vitals, audit, patient listing, and doctor department editing; account creation routes remain available.
- Added integration assertions for all-role admin reset, old-password rejection, token invalidation, non-admin 403 responses, and deactivation.

Verification: lint passed; 39 tests passed; 1 local Mongo integration test skipped because `MONGODB_TEST_URI` is not set; build passed. No production database was used.

## Next stage

Wait for GitHub Actions CI to run the Mongo integration workflow, then proceed to Stage 3: fixed medicine timing dropdown and prescription-linked billing line items.

## Stage 3 — sign-in, receptionist intake, and nurse checks

Status: implemented locally and pushed for CI verification.

- Added the hospital sign-in role dropdown; the server compares the selected role and returns the same generic invalid-credentials response on mismatch. Patient login remains a hidden patient-role request on `/patient-login`.
- Added shared appointment statuses and server-enforced transitions, with new appointments defaulting to `Booked`.
- Receptionist queue now shows today’s appointments and selected patient age/UHID; free hourly slots use the existing clinic-hour conflict logic.
- Nurse preliminary checks now select from today’s awaiting appointments, validate the appointment/patient pairing server-side, and move the appointment to `Vitals done` after saving.
- Added tests for role mismatch, forbidden status transitions, nurse appointment checks, and automatic status movement; existing numeric and symptom validation remains active.

Verification: lint passed; 39 tests passed; 1 local Mongo integration test skipped because `MONGODB_TEST_URI` is not set; build passed. No production database was used.

## Next stage

Wait for GitHub Actions CI, then implement Stage 4: fixed medicine timing (`whenToTake`) and prescription-linked billing line items.

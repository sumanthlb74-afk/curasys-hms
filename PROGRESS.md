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

## Next stage

Implement the admin-only account workspace and role-neutral admin password reset/deactivate API first, with allowed/forbidden integration tests.

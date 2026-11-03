# Curasys HMS

A React (Vite/Tailwind) frontend and Express REST API backed by MongoDB through Mongoose. All records are entered in the UI and fetched from the API; the application does not seed fake patients, appointments, doctors, or bed statistics.

> **Educational project only.** Use fictional data. This application has not been reviewed for real clinical use, privacy-law compliance, or production security.

## Requirements

- Node.js 20.19+ or 22.12+
- A local MongoDB installation or MongoDB Atlas connection string

## Configure MongoDB and secrets

1. Use a local MongoDB server, or create a MongoDB Atlas database user and allow your development machine's IP in Network Access.
2. Copy `server/.env.example` to `server/.env`.
3. Set `MONGODB_URI` to your local MongoDB URI or Atlas connection string. URL-encode special characters in the database username/password.
4. Set `JWT_SECRET` to a unique random value of at least 32 characters.
5. Set `ADMIN_REGISTRATION_KEY` to a private value. Keep `server/.env` private; it is excluded from Git.

No database URI or signing secret is included in this repository. The API will fail with a clear configuration message until these values are provided.

## Run locally

From the repository root in PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the Vite local URL printed by the command (normally `http://localhost:5173/`). Leave the terminal open while using the app. Stop both services with `Ctrl+C`.

Initial administrator setup is available only while no administrator exists, using the private `ADMIN_REGISTRATION_KEY` from `server/.env`. The key must be at least 32 characters. After the first administrator is created, public setup closes by default; temporarily set `ADMIN_SETUP_ENABLED=true` on the API only when you need key-gated public setup for another administrator, then remove the setting. The setup tab is shown only while the API reports setup is open. An administrator can create additional administrator accounts from the dashboard. Each account needs an email address not used by another account. A unique database index protects concurrent bootstrap attempts. Public-route administrators keep the password they choose; administrator-created accounts must change their temporary password at first sign-in. Wrong keys receive a generic error. See [Lost administrator access](#lost-administrator-access) for the offline recovery command.

Administrators create doctor and medical staff accounts. Administrators, doctors, and medical staff can register patients. New staff, doctors, and patients must change their temporary password at first sign-in. Patients can open `/patient-login` directly or use the patient portal link on the sign-in page, then enter the email and temporary password entered by the staff member, doctor, or administrator who registered them; email matching is case-insensitive. The patient-only sign-in page rejects non-patient accounts. No seeded demo login is available.

### Lost administrator access

Run this command only from a trusted machine that can reach the configured MongoDB database. It creates an administrator if the email is unused, or resets the password of an existing administrator with that email. It will not change a non-administrator account. Set `NEW_ADMIN_PASSWORD` in the environment; do not put a password on the command line:

```powershell
$env:NEW_ADMIN_PASSWORD = Read-Host "New temporary administrator password"
npm.cmd run create-admin -- --name "Demo Administrator" --email "admin@example.com"
Remove-Item Env:NEW_ADMIN_PASSWORD
```

The recovery action forces a password change at next sign-in and invalidates existing sessions. Keep MongoDB credentials and the temporary password private. The recovery script reads `MONGODB_URI` from the process environment or `server/.env`.

## Build and deploy

The Render Blueprint creates a static React frontend and a separate Express API. The frontend is configured to call the API origin, and the API allows the frontend origin through CORS.

At API startup, an idempotent migration checks and repairs the UHID index, preserves existing patient UHIDs, clears UHIDs from non-patient accounts, and seeds the per-year counter without lowering it. It replaces a conflicting legacy non-partial index before accepting requests. The same migration is available as `npm.cmd run migrate:uhid`; back up Atlas before manually running migrations or changing production data.

### Free Render web service

The repository includes a Render Blueprint (`render.yaml`) for both free services. Free services can sleep when idle and may take time to wake up.

1. Push this repository to GitHub and sign in to Render with GitHub.
2. Create a MongoDB Atlas M0 cluster and database user. Configure Atlas Network Access to allow the Render service's outbound IP addresses; do not use a public IP allow-all rule for real or sensitive data.
3. In Render, choose **New → Blueprint**, select `sumanthlb74-afk/curasys-hms`, and deploy the Blueprint. Enter the Atlas connection string when prompted for `MONGODB_URI`; Render generates the JWT and admin registration secrets.
4. Wait for both services to finish deploying. The frontend is `https://curasys-hms.onrender.com`; the API health endpoint is `https://curasys-hms-api.onrender.com/api/health`.
5. Confirm the health endpoint returns HTTP 200 with `{"status":"ok"}`. If the database is disconnected, it returns HTTP 503 with `{"status":"degraded"}`.
6. Open the frontend and register the initial administrator using `ADMIN_REGISTRATION_KEY` from the API service environment settings. Keep all secrets in the hosting dashboard, never in GitHub or chat.

Render's free API service spins down after 15 minutes without traffic and can take about one minute to wake. This affects API requests (login and data loading), not the static frontend itself. The frontend allows up to 90 seconds for API requests so a cold start has time to complete. Keep the page open while it connects. While account or billing forms are submitting, do not submit again; if a timeout appears, refresh the dashboard and check for the created record before retrying.

The API service needs `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET` (at least 32 characters), `ADMIN_REGISTRATION_KEY`, and `CLIENT_ORIGIN=https://curasys-hms.onrender.com`. The Blueprint generates values for the two secrets. If the existing Render service has no `ADMIN_REGISTRATION_KEY`, add it under **curasys-hms-api → Environment**, save, and redeploy. Keep it only in the API environment; never put it in `VITE_*` variables or source code. To retrieve a generated key, reveal it in the API service's Environment page and enter it only in Administrator setup. The static service uses `VITE_API_BASE_URL=https://curasys-hms-api.onrender.com/api`. Render supplies `PORT`; clinic hours default to 08:00–20:00, and `HOSPITAL_TZ` defaults to `Asia/Kolkata`.

The live URL is assigned by Render after the Blueprint deploys. Do not enter real patient information; this educational project is not approved for clinical use.

For a manual deployment, configure these settings from the repository root; the project does not have a nested `client` service directory.

1. Provision MongoDB Atlas for a hosted deployment, create a database user, and allow connections from your hosting provider.
2. Configure these environment variables in the hosting provider (do not commit `server/.env`):
   - `MONGODB_URI`: the Atlas connection string.
   - `JWT_SECRET`: a randomly generated secret with at least 32 characters.
   - `ADMIN_REGISTRATION_KEY`: a private key for initial administrator registration.
   - `NODE_ENV`: `production`.
   - `CLIENT_ORIGIN`: the full frontend origin, such as `https://curasys-hms.onrender.com`.
   - `HOSPITAL_TZ`: optional IANA time zone for appointment validation; defaults to `Asia/Kolkata`.
   - `CLINIC_START_HOUR` and `CLINIC_END_HOUR`: optional 24-hour clock range; defaults to `8` and `20` (the end hour is exclusive).
   - For a separately hosted frontend, also set `VITE_CLINIC_START_HOUR` and `VITE_CLINIC_END_HOUR` to the same values at build time.
   - `PORT`: usually supplied automatically by the hosting provider.
3. For the API service, use `npm ci --omit=dev` and `npm start`. For the static frontend, use `npm ci --include=dev`, `npm run build`, and publish `dist`.
4. Open `/api/health` on the deployed host and verify it reports `{"status":"ok"}` before signing in.

For a separate frontend host, set `VITE_API_BASE_URL` to the API's absolute URL including `/api` at frontend build time (for example `https://api.example.com/api`), and set the API's `CLIENT_ORIGIN` to the frontend origin. The local MongoDB service is for local development and is not accessible to a hosted website. Production deployments must configure their own reachable MongoDB URI; no Atlas credentials are stored in this project.

## Features

- JWT sign-in by email and password, with role-guarded patient, doctor, medical staff, and admin workspaces. Public administrator setup requires the private registration key and is open only during first-admin bootstrap or when `ADMIN_SETUP_ENABLED=true`; authenticated administrators can create additional administrators, doctors, and staff.
- Administrators, doctors, and medical staff can register patients. Patient intake includes contact and emergency-contact details, date of birth (age is calculated), blood group, address, allergies, ongoing conditions, current medicines, and optional baseline height and weight.
- Patient temporary passwords are confirmed during entry, must be changed on first sign-in, and can be reset by authorized care-team members. Password changes invalidate existing sessions.
- Doctor access is limited to patients they registered or patients assigned to them through an appointment. Patients can only read their own records.
- Doctor-authored encounter notes include complaint, history, examination, assessment, plan, and follow-up. Doctors can also record a full set of common vital measurements and write multi-medicine prescriptions with route and patient instructions.
- Administrators issue patient bills with an invoice number, total amount, and description, then mark bills Paid or Void. The invoice sequence is atomic per year; void bills do not count toward the patient's billed total. Only admins can issue or update bills; patients can read their own bills from their portal, while doctors and medical staff have no billing access.
- Patients can read their own profile, visit notes, vitals, appointments, prescriptions, and bills. Patient chart data is read-only to patients.
- Medical staff coordinate appointments and bed assignments without access to clinical notes, prescriptions, or detailed medical history. Deactivated patient accounts retain their historical records.
- Appointment scheduling supports every calendar day with configurable one-hour slots, defaulting to 08:00–20:00. Existing bookings are marked when a doctor and date are selected, and a database uniqueness constraint rejects concurrent double-booking. The API evaluates "in the past" in `HOSPITAL_TZ` (default `Asia/Kolkata`).
- Admin live bed counts, patient directory, staff accounts, bed creation/assignment/discharge, and appointment overview.
- Administrator-only audit log records authentication outcomes and key patient, billing, note, prescription, and vital actions. Patient account deactivation retains data and records the administrator and timestamp.
- Patient, appointment, vital, billing, prescription, and visit-note list APIs support `page`, `limit` (maximum 200), and patient search via `q`; the patient directory and pickers expose search and paging.
- Mongoose models for users, appointments, beds, prescriptions, vitals, clinical notes, and bills.
- REST API validation and role checks. Passwords are bcrypt-hashed.

## Roles and data relationships

| Role | Patient records | Appointments | Clinical records | Billing | Administration |
|---|---|---|---|---|---|
| Patient | Read own profile | Read own appointments | Read own chart | Read own bills | None |
| Doctor | Read registered/assigned patients | Read assigned appointments | Create records for registered/assigned patients | None | Register patients |
| Medical staff | Register patients; basic directory details | Book and coordinate | No clinical access | None | Coordinate beds |
| Administrator | Read and manage patient accounts | Manage all appointments | Read all records | Issue and view bills | Create doctors/staff; manage beds |

Users are stored in the `User` collection. `Appointment`, `ClinicalNote`, `Prescription`, `Vital`, `Bed`, and `Billing` documents reference users by MongoDB ObjectId. Patient deactivation blocks sign-in but does not cascade-delete this history.

## API permission summary

| API area | Patient | Doctor | Medical staff | Administrator |
|---|---|---|---|---|
| Public setup/login | Login; initial administrator setup is not available | Login only | Login only | Login; create doctor/staff accounts |
| Patients | Own profile and associated records only | Registered/assigned patients; may register/reset passwords | Basic directory; may register/reset passwords | Manage patient accounts and access directory |
| Appointments | Own appointments only | Assigned appointments only | Book, assign, update, and cancel | Manage all appointments |
| Beds | None | Beds for registered/assigned patients | Create and manage assignments | Create, manage, and remove beds |
| Billing | Own bills only | None | None | Issue, view, pay, or void bills |
| Prescriptions/vitals/notes | Own records read-only | Read records for registered/assigned patients; create/edit own clinical records | No clinical access | Read prescriptions/vitals; clinical-note API is doctor/patient only |
| Audit log | None | None | None | Read audit events |

These are API-side permissions and ownership filters; frontend route guards are additional UI behavior, not the security boundary.

## Checks

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=moderate
```

API integration tests use a disposable local database, never Atlas. The GitHub CI workflow starts a local MongoDB service and sets this variable automatically. To run the same suite locally, start MongoDB and run:

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/curasys_hms_test"
npm.cmd test
Remove-Item Env:MONGODB_TEST_URI
```

The test runner creates a uniquely named database from the `_test` database name and drops only that test database when the suite finishes. Do not set `MONGODB_TEST_URI` to Atlas or a database containing real records.

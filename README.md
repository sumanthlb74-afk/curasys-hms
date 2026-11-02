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

Create the first administrator using **Initial admin setup** and the private key from `server/.env`. This setup closes after the first administrator is created. Administrators create doctor and medical staff accounts. Administrators, doctors, and medical staff can register patients. New staff, doctors, and patients must change their temporary password at first sign-in. Patients sign in with email and password; they do not choose an account type. No seeded demo login is available.

## Build and deploy

The Render Blueprint creates a static React frontend and a separate Express API. The frontend is configured to call the API origin, and the API allows the frontend origin through CORS.

### Free Render web service

The repository includes a Render Blueprint (`render.yaml`) for both free services. Free services can sleep when idle and may take time to wake up.

1. Push this repository to GitHub and sign in to Render with GitHub.
2. Create a MongoDB Atlas M0 cluster and database user. Configure Atlas Network Access to allow the Render service's outbound IP addresses; do not use a public IP allow-all rule for real or sensitive data.
3. In Render, choose **New → Blueprint**, select `sumanthlb74-afk/curasys-hms`, and deploy the Blueprint. Enter the Atlas connection string when prompted for `MONGODB_URI`; Render generates the JWT and admin registration secrets.
4. Wait for both services to finish deploying. The frontend is `https://curasys-hms.onrender.com`; the API health endpoint is `https://curasys-hms-api.onrender.com/api/health`.
5. Confirm the health endpoint returns HTTP 200 with `{"status":"ok"}`. If the database is disconnected, it returns HTTP 503 with `{"status":"degraded"}`.
6. Open the frontend and register the initial administrator using `ADMIN_REGISTRATION_KEY` from the API service environment settings. Keep all secrets in the hosting dashboard, never in GitHub or chat.

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
   - `PORT`: usually supplied automatically by the hosting provider.
3. For the API service, use `npm ci --omit=dev` and `npm start`. For the static frontend, use `npm ci --include=dev`, `npm run build`, and publish `dist`.
4. Open `/api/health` on the deployed host and verify it reports `{"status":"ok"}` before signing in.

For a separate frontend host, set `VITE_API_BASE_URL` to the API's absolute URL including `/api` at frontend build time (for example `https://api.example.com/api`), and set the API's `CLIENT_ORIGIN` to the frontend origin. The local MongoDB service is for local development and is not accessible to a hosted website. Production deployments must configure their own reachable MongoDB URI; no Atlas credentials are stored in this project.

## Features

- JWT sign-in by email and password, with role-guarded patient, doctor, medical staff, and admin workspaces. Public setup can create only the first administrator; administrators provision doctors and staff.
- Administrators, doctors, and medical staff can register patients. Patient intake includes contact and emergency-contact details, date of birth (age is calculated), blood group, address, allergies, ongoing conditions, current medicines, and optional baseline height and weight.
- Patient temporary passwords are confirmed during entry, must be changed on first sign-in, and can be reset by authorized care-team members. Password changes invalidate existing sessions.
- Doctor access is limited to patients they registered or patients assigned to them through an appointment. Patients can only read their own records.
- Doctor-authored encounter notes include complaint, history, examination, assessment, plan, and follow-up. Doctors can also record a full set of common vital measurements and write multi-medicine prescriptions with route and patient instructions.
- Administrators issue patient bills with a total amount and description. The billing form defaults to a ₹500 consultation fee, but this is not saved until an administrator issues the bill. Patients see a total billed of ₹0.00 until bills are issued. Only admins can issue bills; patients can read their own issued bills from their portal, while doctors and medical staff have no billing access.
- Patients can read their own profile, visit notes, vitals, appointments, prescriptions, and bills. Patient chart data is read-only to patients.
- Medical staff coordinate appointments and bed assignments without access to clinical notes, prescriptions, or detailed medical history. Deactivated patient accounts retain their historical records.
- Appointment scheduling supports every calendar day with selectable one-hour slots across all 24 hours. Existing bookings are marked when a doctor and date are selected, and a database uniqueness constraint rejects concurrent double-booking. The API evaluates "in the past" in `HOSPITAL_TZ` (default `Asia/Kolkata`).
- Admin live bed counts, patient directory, staff accounts, bed creation/assignment/discharge, and appointment overview.
- Administrator-only audit log records authentication outcomes and key patient, billing, note, prescription, and vital actions. Patient account deactivation retains data and records the administrator and timestamp.
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

## Checks

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=moderate
```

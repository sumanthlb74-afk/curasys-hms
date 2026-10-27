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

From the `client` folder in PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the Vite local URL printed by the command (normally `http://localhost:5173/`). Leave the terminal open while using the app. Stop both services with `Ctrl+C`.

Create an initial administrator using **Register** and the private key from `server/.env`. Administrators create patient and medical staff accounts; doctors may register through the portal. Patients and staff sign in using credentials supplied by the administrator. No seeded demo login is available.

## Build and deploy

The production Express server serves both the built React app and `/api` from the same origin. This avoids configuring a separate frontend API URL.

1. Provision MongoDB Atlas for a hosted deployment, create a database user, and allow connections from your hosting provider.
2. Configure these environment variables in the hosting provider (do not commit `server/.env`):
   - `MONGODB_URI`: the Atlas connection string.
   - `JWT_SECRET`: a randomly generated secret with at least 32 characters.
   - `ADMIN_REGISTRATION_KEY`: a private key for initial administrator registration.
   - `NODE_ENV`: `production`.
   - `CLIENT_ORIGIN`: optional for same-origin hosting; set it to the full frontend origin if the frontend is hosted separately.
   - `PORT`: usually supplied automatically by the hosting provider.
3. Use `npm install` as the install command, `npm run build` as the build command, and `npm start` as the start command. Set the service root to this `client` directory.
4. Open `/api/health` on the deployed host and verify it reports `"status":"ok"` and `"database":"connected"` before signing in.

For a separate frontend host, set `VITE_API_BASE_URL` to the API's absolute URL including `/api` at frontend build time (for example `https://api.example.com/api`), and set the API's `CLIENT_ORIGIN` to the frontend origin. The local MongoDB service is for local development and is not accessible to a hosted website. Production deployments must configure their own reachable MongoDB URI; no Atlas credentials are stored in this project.

## Features

- JWT sign-in and role-guarded patient, doctor, medical staff, and admin workspaces.
- Administrator patient intake includes contact and emergency-contact details, date of birth (age is calculated), blood group, address, allergies, ongoing conditions, current medicines, and optional baseline height and weight.
- Doctor-authored encounter notes include complaint, history, examination, assessment, plan, and follow-up. Doctors can also record a full set of common vital measurements and write multi-medicine prescriptions with route and patient instructions.
- Administrators issue patient bills with a total amount and description. The billing form defaults to a ₹500 consultation fee, but this is not saved until an administrator issues the bill. Patients see a total billed of ₹0.00 until bills are issued. Only admins can issue bills; patients can read their own issued bills from their portal, while doctors and medical staff have no billing access.
- Patients can read their own profile, visit notes, vitals, appointments, prescriptions, and bills. Patient chart data is read-only to patients.
- Medical staff coordinate appointments and bed assignments without access to clinical notes, prescriptions, or detailed medical history.
- Appointment scheduling supports every calendar day with selectable one-hour slots across all 24 hours. Existing bookings are marked when a doctor and date are selected, and the API rejects attempts to double-book a doctor's slot.
- Admin live bed counts, patient directory, staff accounts, bed creation/assignment/discharge, and appointment overview.
- Mongoose models for users, appointments, beds, prescriptions, vitals, clinical notes, and bills.
- REST API validation and role checks. Passwords are bcrypt-hashed.

## Checks

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd audit --audit-level=moderate
```

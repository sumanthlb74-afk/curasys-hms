import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BedDouble, CalendarDays, Check, ClipboardList, LogOut, Moon, Plus, Receipt, ShieldCheck,
  Stethoscope, Sun, Users, X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import api from './api.js';
import AdminAccountsOnlyDashboard from './components/AdminAccountsOnlyDashboard.jsx';
import {
  bloodGroups,
  appointmentStatuses,
  defaultClinicEndHour,
  defaultClinicStartHour,
  departments,
  paymentMethods,
  preliminaryCheckSymptoms,
  prescriptionAdviceSuggestions,
  prescriptionDurations,
  prescriptionFrequencies,
  prescriptionTimings,
  signInRoles,
  triageLevels,
  wards,
} from '../shared/constants.js';

const rolePaths = {
  patient: '/patient-portal',
  doctor: '/doctor-dashboard',
  staff: '/medical-staff',
  receptionist: '/receptionist-dashboard',
  admin: '/admin-command-center',
};
const configuredClinicStartHour = Number(import.meta.env.VITE_CLINIC_START_HOUR ?? defaultClinicStartHour);
const configuredClinicEndHour = Number(import.meta.env.VITE_CLINIC_END_HOUR ?? defaultClinicEndHour);
const validClinicHours = Number.isInteger(configuredClinicStartHour)
  && Number.isInteger(configuredClinicEndHour)
  && configuredClinicStartHour >= 0
  && configuredClinicStartHour < configuredClinicEndHour
  && configuredClinicEndHour <= 24;
const clinicStartHour = validClinicHours ? configuredClinicStartHour : defaultClinicStartHour;
const clinicEndHour = validClinicHours ? configuredClinicEndHour : defaultClinicEndHour;
const appointmentSlots = Array.from({ length: clinicEndHour - clinicStartHour }, (_, index) => {
  const hour = clinicStartHour + index;
  const endHour = hour + 1;
  const time = `${String(hour).padStart(2, '0')}:00`;
  const endTime = `${String(endHour).padStart(2, '0')}:00`;
  const startLabel = new Date(Date.UTC(2020, 0, 1, hour)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const endLabel = new Date(Date.UTC(2020, 0, 1, endHour)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return { time, label: `${startLabel} – ${endLabel} (${time}–${endTime})` };
});
const activeAppointmentStatuses = appointmentStatuses.filter((status) => !['Cancelled', 'Completed'].includes(status));

let apiWarmupPromise;
let setupStatusPromise;
function wakeApi() {
  if (!apiWarmupPromise) {
    apiWarmupPromise = api.get('/health', { timeout: 60_000 }).catch(() => null);
  }
  return apiWarmupPromise;
}

function getSetupStatus() {
  if (!setupStatusPromise) {
    setupStatusPromise = wakeApi().then(() => api.get('/auth/setup-status'));
  }
  return setupStatusPromise;
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatAppointmentDate(date) {
  return new Date(date).toLocaleDateString(undefined, { timeZone: 'UTC' });
}

function formatAppointmentSlot(time) {
  const slot = appointmentSlots.find((item) => item.time === time);
  return slot?.label || time;
}

function calculateAge(dateOfBirth) {
  if (typeof dateOfBirth !== 'string') return null;
  const [year, month, day] = dateOfBirth.slice(0, 10).split('-').map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    !year || !month || !day
    || Number.isNaN(birthDate.getTime())
    || birthDate.toISOString().slice(0, 10) !== dateOfBirth.slice(0, 10)
  ) return null;
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return age >= 0 ? age : null;
}

function parseList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function filterPatientList(patients, query) {
  const search = query.trim().toLowerCase();
  if (!search) return patients;
  return patients.filter((patient) => [patient.name, patient.uhid, patient.email]
    .some((value) => value?.toLowerCase().includes(search)));
}

function generateTemporaryPassword() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...randomBytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function emptyPatientForm() {
  return {
    name: '', email: '', password: '', confirmPassword: '', phone: '', dateOfBirth: '', sex: '', bloodGroup: '', address: '',
    emergencyContact: { name: '', relationship: '', phone: '' }, allergies: '', chronicConditions: '',
    currentMedications: '', heightCm: '', weightKg: '',
  };
}

function formatCurrency(paise) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR' }).format(paise / 100);
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem('curasys_theme');
    return storedTheme === 'dark' ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('curasys_theme', theme);
  }, [theme]);
  return [theme, () => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))];
}

function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const notify = useCallback((message, kind = 'success') => {
    window.clearTimeout(timer.current);
    setToast({ message, kind });
    timer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);
  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [toast, notify, dismiss];
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div role={toast.kind === 'error' ? 'alert' : 'status'} className={`fixed right-5 top-20 z-50 flex max-w-sm items-start gap-3 rounded-xl border p-4 shadow-xl ${toast.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'}`}>
      {toast.kind === 'error' ? <X className="mt-0.5 h-4 w-4" /> : <Check className="mt-0.5 h-4 w-4" />}
      <p className="flex-1 text-sm">{toast.message}</p>
      <button onClick={onClose} aria-label="Dismiss notification"><X className="h-4 w-4" /></button>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">{label}{children}</label>;
}

function Input(props) {
  return <input {...props} className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${props.className || ''}`} />;
}

function Select({ children, ...props }) {
  return <select {...props} className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${props.className || ''}`}>{children}</select>;
}

function Textarea(props) {
  return <textarea {...props} className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${props.className || ''}`} />;
}

function Card({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">{Icon && <Icon className="h-4 w-4 text-teal-600" />}{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children = 'No records yet. Add a record using the form above.' }) {
  return <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">{children}</p>;
}

function LoadState({ loading, error, onRetry }) {
  if (loading) return <p className="text-sm text-slate-500">Loading records…</p>;
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
        <span>Records could not be loaded. No conclusion about missing records can be made.</span>
        <button onClick={onRetry} className="font-semibold underline">Try again</button>
      </div>
    );
  }
  return null;
}

function PaginationControls({ page, total, limit, onPageChange }) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
      <span>Page {page} of {pageCount} · {total} records</span>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50 dark:border-slate-700">Previous</button>
        <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50 dark:border-slate-700">Next</button>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => {
    void wakeApi();
  }, []);
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(() => Boolean(localStorage.getItem('curasys_token')));
  const [authError, setAuthError] = useState(null);
  const [authCheckRevision, setAuthCheckRevision] = useState(0);
  const [toast, notify, dismissToast] = useToast();
  const [theme, toggleTheme] = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let active = true;
    const handleSessionExpired = () => {
      localStorage.removeItem('curasys_token');
      setUser(null);
      setInitializing(false);
      setAuthError(null);
      notify('Your session expired. Please sign in again.', 'error');
      navigate('/login', { replace: true });
    };
    window.addEventListener('curasys:session-expired', handleSessionExpired);
    const token = localStorage.getItem('curasys_token');
    if (token) {
      api.get('/auth/me')
        .then(({ data }) => {
          if (active) {
            setUser(data.user);
            setAuthError(null);
          }
        })
        .catch(() => {
          if (active) {
            setUser(null);
            if (localStorage.getItem('curasys_token')) {
              setAuthError('Your sign-in could not be verified because the service is unavailable.');
            }
          }
        })
        .finally(() => { if (active) setInitializing(false); });
    }
    return () => {
      active = false;
      window.removeEventListener('curasys:session-expired', handleSessionExpired);
    };
  }, [authCheckRevision, navigate, notify]);

  const onAuth = (auth) => {
    localStorage.setItem('curasys_token', auth.token);
    setAuthError(null);
    setUser(auth.user);
    navigate(rolePaths[auth.user.role], { replace: true });
  };

  const logout = () => {
    localStorage.removeItem('curasys_token');
    setUser(null);
    notify('You have signed out.');
    navigate('/login', { replace: true });
  };

  if (initializing) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Checking your sign-in…</div>;
  }

  if (authError) {
    return (
      <main className="grid min-h-screen place-items-center px-4 py-10">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-xl font-bold">Sign-in service unavailable</h1>
          <p role="alert" className="mt-2 text-sm text-slate-500">{authError} Your saved session has not been removed.</p>
          <div className="mt-5 flex gap-3">
            <button onClick={() => { setAuthError(null); setInitializing(true); setAuthCheckRevision((value) => value + 1); }} className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white">Retry</button>
            <button onClick={logout} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold dark:border-slate-700">Sign in instead</button>
          </div>
        </section>
      </main>
    );
  }

  if (user?.mustChangePassword) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
        <ChangePasswordPage user={user} onAuth={onAuth} notify={notify} required />
        <Toast toast={toast} onClose={dismissToast} />
      </div>
    );
  }

  const path = user ? rolePaths[user.role] : '/login';
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 transition-colors dark:bg-slate-950 dark:text-slate-100">
      {user && (
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
            <Link to={path} className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-600 text-white shadow-lg shadow-teal-600/20"><Activity className="h-5 w-5" /></span>
              <span><span className="block font-bold">Curasys Medical Center</span><span className="block text-xs capitalize text-slate-500">Hospital information system · {user.role}</span></span>
            </Link>
            <div className="flex items-center gap-2 sm:gap-4">
              <span className="hidden text-right sm:block"><span className="block text-sm font-medium">{user.name}</span>{user.role === 'patient' && <span className="block text-xs text-slate-500">{user.uhid}</span>}</span>
              <button onClick={() => navigate('/change-password')} className="rounded-lg border border-slate-200 px-2 py-2 text-xs sm:px-3 sm:text-sm dark:border-slate-700">Password</button>
              <button onClick={toggleTheme} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700" aria-label="Toggle color theme">{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              <button onClick={logout} className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300" aria-label="Sign out"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></button>
            </div>
          </div>
        </header>
      )}
      <Toast toast={toast} onClose={dismissToast} />
      <Routes>
        <Route path="/login" element={user ? <Navigate to={path} replace /> : <AuthPage onAuth={onAuth} notify={notify} />} />
        <Route path="/patient-login" element={user ? <Navigate to={path} replace /> : <AuthPage onAuth={onAuth} notify={notify} patientOnly />} />
        <Route path="/change-password" element={user ? <ChangePasswordPage user={user} onAuth={onAuth} notify={notify} /> : <Navigate to="/login" replace />} />
        <Route path="/patient-portal" element={<Protected user={user} role="patient"><PatientDashboard user={user} notify={notify} /></Protected>} />
        <Route path="/doctor-dashboard" element={<Protected user={user} role="doctor"><DoctorDashboard user={user} notify={notify} /></Protected>} />
        <Route path="/medical-staff" element={<Protected user={user} role="staff"><StaffDashboard notify={notify} /></Protected>} />
        <Route path="/receptionist-dashboard" element={<Protected user={user} role="receptionist"><ReceptionistDashboard notify={notify} /></Protected>} />
        <Route path="/admin-command-center" element={<Protected user={user} role="admin"><AdminAccountsOnlyDashboard user={user} notify={notify} CreateAccountForm={AdminAccountForm} /></Protected>} />
        <Route path="*" element={<Navigate to={user ? path : '/login'} replace state={{ from: location.pathname }} />} />
      </Routes>
    </div>
  );
}

function Protected({ user, role, children }) {
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={rolePaths[user.role]} replace />;
  return children;
}

function ChangePasswordPage({ user, onAuth, notify, required = false }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      notify('The new passwords do not match.', 'error');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      notify('Password updated. Your other sessions have been signed out.');
      onAuth(data);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold">{required ? 'Set your password' : 'Change password'}</h1>
        <p className="mt-2 text-sm text-slate-500">{required ? 'For your security, replace the temporary password before opening your workspace.' : `Signed in as ${user.email}.`}</p>
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm((value) => ({ ...value, currentPassword: event.target.value }))} required /></Field>
          <Field label="New password"><Input type="password" autoComplete="new-password" minLength={8} maxLength={72} value={form.newPassword} onChange={(event) => setForm((value) => ({ ...value, newPassword: event.target.value }))} required /></Field>
          <Field label="Confirm new password"><Input type="password" autoComplete="new-password" minLength={8} maxLength={72} value={form.confirmPassword} onChange={(event) => setForm((value) => ({ ...value, confirmPassword: event.target.value }))} required /></Field>
          <button disabled={loading} className="rounded-xl bg-teal-600 px-4 py-3 font-semibold text-white hover:bg-teal-700 disabled:opacity-60">{loading ? 'Updating…' : 'Update password'}</button>
        </form>
      </section>
    </main>
  );
}

function AuthPage({ onAuth, notify, patientOnly = false }) {
  const [mode, setMode] = useState('login');
  const [setupOpen, setSetupOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showWakeMessage, setShowWakeMessage] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', phone: '', adminRegistrationKey: '', role: 'doctor' });
  const change = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));
  useEffect(() => {
    if (patientOnly) return;
    getSetupStatus()
      .then(({ data }) => setSetupOpen(data.setupOpen))
      .catch(() => setSetupOpen(false));
  }, [patientOnly]);
  useEffect(() => {
    if (!loading) return undefined;
    const timer = window.setTimeout(() => setShowWakeMessage(true), 4000);
    return () => window.clearTimeout(timer);
  }, [loading]);
  const submit = async (event) => {
    event.preventDefault();
    if (mode === 'register' && form.password !== form.confirmPassword) {
      notify('The passwords do not match.', 'error');
      return;
    }
    setShowWakeMessage(false);
    setLoading(true);
    try {
      const isRegister = mode === 'register';
      const payload = isRegister
        ? { name: form.name, email: form.email, password: form.password, phone: form.phone, adminRegistrationKey: form.adminRegistrationKey, role: 'admin' }
        : { email: form.email, password: form.password, role: patientOnly ? 'patient' : form.role };
      const { data } = await api.post(isRegister ? '/auth/register' : '/auth/login', payload);
      if (patientOnly && data.user.role !== 'patient') {
        notify('This sign-in page is for patients. Use the staff and administrator sign-in page for hospital accounts.', 'error');
        return;
      }
      notify(mode === 'login' ? 'Welcome back.' : 'Your account has been created.');
      onAuth(data);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };
  const isRegister = mode === 'register';
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-teal-100 via-slate-50 to-white px-4 py-10 dark:from-teal-950 dark:via-slate-950 dark:to-slate-950">
      <section className="w-full max-w-lg rounded-3xl border border-white/80 bg-white/90 p-7 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/90 sm:p-9">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-teal-600 text-white shadow-lg shadow-teal-600/30"><Activity className="h-7 w-7" /></div>
          <h1 className="text-2xl font-bold tracking-tight">{patientOnly ? 'Patient portal' : 'Curasys Medical Center'}</h1>
          <p className="mt-1 text-sm text-slate-500">{patientOnly ? 'Sign in with the email and temporary password provided by your care team.' : 'Hospital information system'}</p>
        </div>
        {!patientOnly && setupOpen && <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {['login', 'register'].map((item) => <button key={item} onClick={() => setMode(item)} className={`rounded-lg py-2 text-sm font-semibold capitalize ${mode === item ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-700 dark:text-teal-300' : 'text-slate-500'}`}>{item === 'register' ? 'Administrator setup' : 'Sign in'}</button>)}
        </div>}
        <form onSubmit={submit} className="grid gap-4">
          {isRegister && <Field label="Full name"><Input value={form.name} onChange={change('name')} autoComplete="name" required maxLength={100} /></Field>}
          <Field label="Email"><Input type="email" value={form.email} onChange={change('email')} autoComplete="email" required /></Field>
          {!patientOnly && !isRegister && <Field label="Sign in as"><Select value={form.role} onChange={change('role')}>{signInRoles.map((role) => <option key={role} value={role}>{role === 'staff' ? 'Medical Staff' : role[0].toUpperCase() + role.slice(1)}</option>)}</Select></Field>}
          <Field label="Password"><Input type="password" value={form.password} onChange={change('password')} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={isRegister ? 8 : undefined} maxLength={72} required /></Field>
          {isRegister && <Field label="Confirm password"><Input type="password" value={form.confirmPassword} onChange={change('confirmPassword')} autoComplete="new-password" minLength={8} maxLength={72} required /></Field>}
          {isRegister && <Field label="Phone (optional)"><Input value={form.phone} onChange={change('phone')} autoComplete="tel" /></Field>}
          {isRegister && <Field label="Admin registration key"><Input type="password" value={form.adminRegistrationKey} onChange={change('adminRegistrationKey')} required /></Field>}
          {isRegister && <p className="text-xs leading-relaxed text-slate-500">Public administrator setup requires the private key and is available only during bootstrap or an explicitly enabled setup window. You keep the password you choose; accounts created by an administrator must change their temporary password at first sign-in.</p>}
          {loading && showWakeMessage && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">Render's free API may sleep after inactivity and can take about a minute to wake. Keep this page open. If the request times out, try signing in with the same email before submitting again.</p>}
          <button disabled={loading} className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 font-semibold text-white shadow-lg shadow-teal-600/20 hover:bg-teal-700 disabled:opacity-60">{loading ? 'Please wait…' : isRegister ? 'Create account' : patientOnly ? 'Sign in to patient portal' : 'Sign in securely'}</button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          {patientOnly
            ? <>Hospital staff? <Link to="/login" className="font-semibold text-teal-700 hover:underline dark:text-teal-300">Staff sign in</Link></>
            : <>Patient? <Link to="/patient-login" className="font-semibold text-teal-700 hover:underline dark:text-teal-300">Open the patient portal</Link></>}
        </p>
        <p className="mt-5 text-center text-xs text-slate-500">Use fictional information only. This school project is not for real patient data.</p>
      </section>
    </main>
  );
}

function useLoad(notify, requests) {
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailure, setLoadFailure] = useState(null);
  const hasLoaded = useRef(false);
  const refresh = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);
  const requestSignature = JSON.stringify(requests);
  useEffect(() => {
    let active = true;
    const requestList = JSON.parse(requestSignature);
    if (hasLoaded.current) setRefreshing(true);
    else setLoading(true);
    Promise.all(requestList.map((request) => api.get(request.path)))
      .then((responses) => {
        if (active) {
          setData(Object.fromEntries(responses.map((response, index) => [requestList[index].key, response.data])));
          hasLoaded.current = true;
        }
      })
      .catch((loadError) => {
        if (active) {
          setLoadFailure({ message: loadError.message, requestSignature, revision });
          notify(loadError.message, 'error');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => { active = false; };
  }, [revision, notify, requestSignature]);
  const error = loadFailure?.requestSignature === requestSignature
    && loadFailure?.revision === revision
    ? loadFailure.message
    : null;
  return { data, loading, refreshing, error, refresh };
}

function useDebouncedValue(value, delay = 400) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

function PatientRegistrationForm({ notify, onCreated }) {
  const [form, setForm] = useState(emptyPatientForm);
  const [showPassword, setShowPassword] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const copyCredentialsRef = useRef(null);
  useEffect(() => {
    if (createdCredentials) copyCredentialsRef.current?.focus();
  }, [createdCredentials]);
  const change = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));
  const changeEmergencyContact = (key) => (event) => setForm((value) => ({
    ...value,
    emergencyContact: { ...value.emergencyContact, [key]: event.target.value },
  }));
  const submit = async (event) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      notify('The temporary passwords do not match.', 'error');
      return;
    }
    try {
      const patientData = { ...form };
      delete patientData.confirmPassword;
      const { data } = await api.post('/patients', {
        ...patientData,
        allergies: parseList(form.allergies),
        chronicConditions: parseList(form.chronicConditions),
        currentMedications: parseList(form.currentMedications),
      });
      setCreatedCredentials({ email: data.patient.email, password: form.password, uhid: data.patient.uhid });
      notify(`Patient registered with health ID ${data.patient.uhid}.`);
      setForm(emptyPatientForm());
      onCreated();
    } catch (error) {
      notify(error.message, 'error');
    }
  };
  return (
    <Card title="Register a patient" icon={Users}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 sm:col-span-2">Patient identity & contact</p>
        <Field label="Full legal name"><Input autoComplete="name" maxLength="100" value={form.name} onChange={change('name')} required /></Field>
        <Field label="Email / patient login"><Input type="email" autoComplete="email" maxLength="254" value={form.email} onChange={change('email')} required /></Field>
        <Field label="Temporary password"><span className="flex min-w-0 gap-2"><Input className="min-w-0 flex-1" type={showPassword ? 'text' : 'password'} minLength="8" maxLength="72" autoComplete="new-password" value={form.password} onChange={change('password')} required /><button type="button" className="shrink-0 rounded-lg border border-slate-300 px-3 text-xs dark:border-slate-700" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Hide' : 'Show'}</button></span><span className="flex flex-wrap items-center gap-2 text-xs font-normal text-slate-500"><span>The patient must replace it at first sign-in.</span><button type="button" className="font-semibold text-teal-700 underline dark:text-teal-300" onClick={() => { const password = generateTemporaryPassword(); setForm((value) => ({ ...value, password, confirmPassword: password })); setShowPassword(true); }}>Generate strong temporary password</button></span></Field>
        <Field label="Confirm temporary password"><Input type={showPassword ? 'text' : 'password'} minLength="8" maxLength="72" autoComplete="new-password" value={form.confirmPassword} onChange={change('confirmPassword')} required /></Field>
        <Field label="Phone"><Input type="tel" autoComplete="tel" maxLength="30" value={form.phone} onChange={change('phone')} /></Field>
        <Field label="Date of birth"><Input type="date" max={localDateValue()} value={form.dateOfBirth} onChange={change('dateOfBirth')} required />{calculateAge(form.dateOfBirth) !== null && <span className="text-xs font-normal text-slate-500">Age: {calculateAge(form.dateOfBirth)} years (calculated)</span>}</Field>
        <Field label="Sex (optional)"><Select value={form.sex} onChange={change('sex')}><option value="">Not specified</option>{['Female', 'Male', 'Intersex', 'Prefer not to say'].map((value) => <option key={value}>{value}</option>)}</Select></Field>
        <Field label="Blood group (if known)"><Select value={form.bloodGroup} onChange={change('bloodGroup')}><option value="">Not known</option>{bloodGroups.map((value) => <option key={value}>{value}</option>)}</Select></Field>
        <Field label="Home address"><Textarea rows="2" maxLength="500" autoComplete="street-address" value={form.address} onChange={change('address')} /></Field>
        <p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 sm:col-span-2">Emergency contact</p>
        <Field label="Contact name"><Input maxLength="100" value={form.emergencyContact.name} onChange={changeEmergencyContact('name')} /></Field>
        <Field label="Relationship"><Input maxLength="50" value={form.emergencyContact.relationship} onChange={changeEmergencyContact('relationship')} placeholder="e.g. Parent, spouse" /></Field>
        <Field label="Contact phone"><Input type="tel" maxLength="30" value={form.emergencyContact.phone} onChange={changeEmergencyContact('phone')} /></Field>
        <p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 sm:col-span-2">Medical history & baseline measurements</p>
        <Field label="Known allergies"><Input value={form.allergies} onChange={change('allergies')} placeholder="Separate multiple entries with commas" /><span className="text-xs font-normal text-slate-500">Enter “None known” only after confirming with the patient.</span></Field>
        <Field label="Ongoing conditions"><Input value={form.chronicConditions} onChange={change('chronicConditions')} placeholder="e.g. Diabetes, asthma" /></Field>
        <Field label="Current medications"><Input value={form.currentMedications} onChange={change('currentMedications')} placeholder="Separate multiple entries with commas" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Height (cm)"><Input type="number" min="30" max="250" step="0.1" value={form.heightCm} onChange={change('heightCm')} /></Field>
          <Field label="Weight (kg)"><Input type="number" min="1" max="500" step="0.1" value={form.weightKg} onChange={change('weightKg')} /></Field>
        </div>
        <button className="flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 sm:col-span-2"><Plus className="h-4 w-4" />Create patient chart & login</button>
      </form>
      {createdCredentials && createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="created-patient-title" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/60 p-4">
          <section className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h2 id="created-patient-title" className="text-lg font-bold">Patient login created</h2>
            <p className="mt-2 text-sm text-slate-500">Share these credentials securely. This temporary password is shown only once and must be changed at first sign-in.</p>
            <p className="mt-4 break-all text-sm"><strong>Email:</strong> {createdCredentials.email}</p>
            <p className="mt-1 break-all font-mono text-sm"><strong>Temporary password:</strong> {createdCredentials.password}</p>
            <p className="mt-1 text-xs text-slate-500"><strong>UHID:</strong> {createdCredentials.uhid}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button ref={copyCredentialsRef} type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`);
                  notify('Patient email and temporary password copied.');
                } catch {
                  notify('Clipboard access is unavailable. Copy the credentials manually.', 'error');
                }
              }}>Copy email + password</button>
              <button type="button" className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => setCreatedCredentials(null)}>Done</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </Card>
  );
}

function AdminAccountForm({ notify, onCreated }) {
  const [form, setForm] = useState({ ...emptyPatientForm(), role: 'doctor', specialization: departments[0] });
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const copyRef = useRef(null);
  const change = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));
  const changeEmergencyContact = (key) => (event) => setForm((value) => ({
    ...value,
    emergencyContact: { ...value.emergencyContact, [key]: event.target.value },
  }));
  useEffect(() => {
    if (credentials) copyRef.current?.focus();
  }, [credentials]);

  const submit = async (event) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      notify('The temporary passwords do not match.', 'error');
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      const routes = {
        admin: ['/admins', 'administrator'],
        doctor: ['/doctors', 'doctor'],
        staff: ['/staff', 'staff'],
        receptionist: ['/receptionists', 'receptionist'],
        patient: ['/patients', 'patient'],
      };
      const [path, responseKey] = routes[form.role];
      const payload = { ...form };
      delete payload.confirmPassword;
      if (form.role === 'patient') {
        payload.allergies = parseList(form.allergies);
        payload.chronicConditions = parseList(form.chronicConditions);
        payload.currentMedications = parseList(form.currentMedications);
      } else {
        for (const field of [
          'dateOfBirth', 'sex', 'bloodGroup', 'address', 'emergencyContact',
          'allergies', 'chronicConditions', 'currentMedications', 'heightCm', 'weightKg',
        ]) delete payload[field];
      }
      if (form.role !== 'doctor') delete payload.specialization;
      const { data } = await api.post(path, payload);
      const created = data[responseKey];
      setCredentials({ email: created.email, password: form.password, uhid: created.uhid });
      notify(`${form.role === 'patient' ? 'Patient' : form.role === 'staff' ? 'Medical staff' : form.role[0].toUpperCase() + form.role.slice(1)} account created; password change is required at first sign-in.`);
      setForm({ ...emptyPatientForm(), role: form.role, specialization: departments[0] });
      setShowPassword(false);
      onCreated();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card title="Create account" icon={Users}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Role">
          <Select value={form.role} onChange={change('role')}>
            <option value="doctor">Doctor</option>
            <option value="staff">Medical Staff (nurse)</option>
            <option value="receptionist">Receptionist</option>
            <option value="patient">Patient</option>
            <option value="admin">Administrator</option>
          </Select>
        </Field>
        <Field label="Full name"><Input autoComplete="name" maxLength="100" value={form.name} onChange={change('name')} required /></Field>
        <Field label="Email / login ID"><Input type="email" autoComplete="email" maxLength="254" value={form.email} onChange={change('email')} required /></Field>
        <Field label="Phone"><Input type="tel" autoComplete="tel" maxLength="30" value={form.phone} onChange={change('phone')} /></Field>
        <Field label="Temporary password">
          <span className="flex min-w-0 gap-2">
            <Input className="min-w-0 flex-1" type={showPassword ? 'text' : 'password'} minLength="8" maxLength="72" autoComplete="new-password" value={form.password} onChange={change('password')} required />
            <button type="button" className="shrink-0 rounded-lg border border-slate-300 px-3 text-xs dark:border-slate-700" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Hide' : 'Show'}</button>
          </span>
          <span className="flex flex-wrap items-center gap-2 text-xs font-normal text-slate-500">
            <span>Must be changed at first sign-in.</span>
            <button type="button" className="font-semibold text-teal-700 underline dark:text-teal-300" onClick={() => {
              const password = generateTemporaryPassword();
              setForm((value) => ({ ...value, password, confirmPassword: password }));
              setShowPassword(true);
            }}>Generate strong password</button>
          </span>
        </Field>
        <Field label="Confirm temporary password"><Input type={showPassword ? 'text' : 'password'} minLength="8" maxLength="72" autoComplete="new-password" value={form.confirmPassword} onChange={change('confirmPassword')} required /></Field>
        {form.role === 'doctor' && <Field label="Department"><Select value={form.specialization} onChange={change('specialization')}>{departments.map((department) => <option key={department}>{department}</option>)}</Select></Field>}
        {form.role === 'patient' && <>
          <Field label="Date of birth"><Input type="date" max={localDateValue()} value={form.dateOfBirth} onChange={change('dateOfBirth')} required />{calculateAge(form.dateOfBirth) !== null && <span className="text-xs font-normal text-slate-500">Age: {calculateAge(form.dateOfBirth)} years</span>}</Field>
          <Field label="Sex"><Select value={form.sex} onChange={change('sex')}><option value="">Not specified</option>{['Female', 'Male', 'Intersex', 'Prefer not to say'].map((value) => <option key={value}>{value}</option>)}</Select></Field>
          <Field label="Blood group"><Select value={form.bloodGroup} onChange={change('bloodGroup')}><option value="">Not known</option>{bloodGroups.map((value) => <option key={value}>{value}</option>)}</Select></Field>
          <Field label="Home address"><Textarea rows="2" maxLength="500" value={form.address} onChange={change('address')} /></Field>
          <Field label="Emergency contact name"><Input maxLength="100" value={form.emergencyContact.name} onChange={changeEmergencyContact('name')} /></Field>
          <Field label="Emergency contact relationship"><Input maxLength="50" value={form.emergencyContact.relationship} onChange={changeEmergencyContact('relationship')} /></Field>
          <Field label="Emergency contact phone"><Input type="tel" maxLength="30" value={form.emergencyContact.phone} onChange={changeEmergencyContact('phone')} /></Field>
          <Field label="Known allergies"><Input value={form.allergies} onChange={change('allergies')} placeholder="Separate entries with commas" /></Field>
          <Field label="Ongoing conditions"><Input value={form.chronicConditions} onChange={change('chronicConditions')} placeholder="Separate entries with commas" /></Field>
          <Field label="Current medications"><Input value={form.currentMedications} onChange={change('currentMedications')} placeholder="Separate entries with commas" /></Field>
          <Field label="Height (cm)"><Input type="number" min="30" max="250" step="0.1" value={form.heightCm} onChange={change('heightCm')} /></Field>
          <Field label="Weight (kg)"><Input type="number" min="1" max="500" step="0.1" value={form.weightKg} onChange={change('weightKg')} /></Field>
        </>}
        <button disabled={creating} className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2">{creating ? 'Creating account…' : 'Create account'}</button>
      </form>
      {credentials && createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="created-account-title" className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/60 p-3 sm:p-4">
          <div className="grid min-h-full place-items-center">
            <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6 dark:bg-slate-900">
              <h2 id="created-account-title" className="text-lg font-bold">Account created</h2>
              <p className="mt-2 text-sm text-slate-500">Credentials are shown once. Share them securely; the temporary password must be changed at first sign-in.</p>
              <p className="mt-4 break-all text-sm"><strong>Login ID:</strong> {credentials.email}</p>
              <p className="mt-1 break-all font-mono text-sm"><strong>Temporary password:</strong> {credentials.password}</p>
              {credentials.uhid && <p className="mt-1 text-xs text-slate-500"><strong>UHID:</strong> {credentials.uhid}</p>}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button ref={copyRef} type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700" onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`Login ID: ${credentials.email}\nTemporary password: ${credentials.password}`);
                    notify('Login ID and temporary password copied.');
                  } catch {
                    notify('Clipboard access is unavailable. Copy the credentials manually.', 'error');
                  }
                }}>Copy login ID + password</button>
                <button type="button" className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => setCredentials(null)}>Done</button>
              </div>
            </section>
          </div>
        </div>,
        document.body,
      )}
    </Card>
  );
}

function PatientPasswordReset({ patients, notify, onReset }) {
  const [patientId, setPatientId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      notify('The temporary passwords do not match.', 'error');
      return;
    }
    try {
      await api.post(`/patients/${patientId}/reset-password`, { password });
      notify('Temporary password reset. The patient must change it at next sign-in.');
      setPatientId('');
      setPassword('');
      setConfirmPassword('');
      onReset();
    } catch (error) {
      notify(error.message, 'error');
    }
  };
  return (
    <Card title="Reset patient password" icon={ShieldCheck}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Field label="Patient"><Select required value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">Select a patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></Field>
        <Field label="New temporary password"><Input type="password" minLength="8" maxLength="72" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
        <Field label="Confirm temporary password"><Input type="password" minLength="8" maxLength="72" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></Field>
        <button disabled={!patients.length} className="rounded-xl border border-teal-600 px-4 py-2.5 text-sm font-semibold text-teal-700 disabled:opacity-50 dark:text-teal-300 sm:col-span-3">Reset and require password change</button>
      </form>
    </Card>
  );
}

function PageTitle({ eyebrow, title, description, icon: Icon }) {
  return <div className="flex min-w-0 items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-teal-600/10 text-teal-700 dark:text-teal-300">{Icon && <Icon className="h-6 w-6" />}</span><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700 dark:text-teal-300">{eyebrow}</p><h1 className="mt-1 break-words text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1><p className="mt-1 break-words text-sm text-slate-500">{description}</p></div></div>;
}

function PatientDashboard({ user, notify }) {
  const { data, loading, error, refresh } = useLoad(notify, [
    { key: 'billing', path: '/billing' },
    { key: 'prescriptions', path: '/prescriptions' },
  ]);
  const bills = data.billing?.bills || [];
  const prescriptions = data.prescriptions?.prescriptions || [];

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6">
      <PageTitle eyebrow="Patient portal · read-only" title={`Hello, ${user.name}`} description={`UHID: ${user.uhid || 'Not assigned'} · Your prescriptions and bills`} icon={Activity} />
      <Card title="Prescriptions" icon={ClipboardList}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : prescriptions.length === 0 ? <Empty>No prescriptions have been added to your records.</Empty> : <div className="space-y-3">{prescriptions.map((item) => <article key={item._id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><p className="font-semibold">{item.diagnosis}</p><p className="mt-1 text-xs text-slate-500">Prescribed by {item.doctorId?.name || 'Doctor'} · {new Date(item.createdAt).toLocaleDateString()}</p><ul className="mt-3 space-y-2 text-sm">{item.medicines.map((medicine, index) => <li key={`${item._id}-${index}`}><span className="font-medium">{medicine.name}</span> · {medicine.dosage} · {medicine.frequency} · {medicine.duration}{medicine.route && ` · ${medicine.route}`}{medicine.instructions && <span className="block text-xs text-slate-500">{medicine.instructions}</span>}</li>)}</ul>{item.instructions && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Instructions: {item.instructions}</p>}{item.followUp && <p className="mt-2 text-xs font-medium text-teal-700 dark:text-teal-300">Follow-up: {item.followUp}</p>}{item.advice?.suggestions?.length > 0 && <p className="mt-2 text-sm"><span className="font-medium">Lifestyle advice:</span> {item.advice.suggestions.join(' · ')}</p>}{item.advice?.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{item.advice.notes}</p>}</article>)}</div>}
      </Card>
      <Card title="Your bills" icon={Receipt}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : bills.length === 0 ? <Empty>No bills have been issued.</Empty> : <div className="space-y-3">{bills.map((bill) => <article key={bill._id} className="rounded-xl border border-slate-100 p-4 dark:border-slate-800"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{bill.invoiceNumber || 'Legacy invoice'}</p><p className="mt-1 text-xs text-slate-500">{new Date(bill.createdAt).toLocaleDateString()}</p></div><p className="text-lg font-bold">{formatCurrency(bill.totalPaise)}</p></div><ul className="mt-3 space-y-1 text-sm">{bill.lineItems?.length ? bill.lineItems.map((item, index) => <li key={`${bill._id}-${index}`} className="flex justify-between gap-3"><span>{item.description}</span><span>{formatCurrency(item.amountPaise)}</span></li>) : <li>{bill.description}</li>}</ul>{bill.discountPaise > 0 && <p className="mt-2 text-sm">Discount: −{formatCurrency(bill.discountPaise)}</p>}<p className="mt-2 text-sm font-medium">Status: {bill.status || 'Unpaid'}{bill.paymentMethod && ` · ${bill.paymentMethod}`}</p></article>)}</div>}
      </Card>
    </main>
  );
}

function DoctorDashboard({ user, notify }) {
  const [patientSearch, setPatientSearch] = useState('');
  const [patientPage, setPatientPage] = useState(1);
  const debouncedPatientSearch = useDebouncedValue(patientSearch);
  const fixedLoad = useLoad(notify, [
    { key: 'appointments', path: '/appointments' },
    { key: 'prescriptions', path: '/prescriptions' },
    { key: 'vitals', path: '/vitals' },
    { key: 'clinicalNotes', path: '/clinical-notes' },
  ]);
  const patientLoad = useLoad(notify, [
    { key: 'patients', path: `/patients?page=${patientPage}&limit=50&q=${encodeURIComponent(debouncedPatientSearch)}` },
  ]);
  const data = { ...fixedLoad.data, ...patientLoad.data };
  const loading = fixedLoad.loading || patientLoad.loading;
  const refreshing = fixedLoad.refreshing || patientLoad.refreshing;
  const error = fixedLoad.error || patientLoad.error;
  const refreshFixed = fixedLoad.refresh;
  const refreshPatients = patientLoad.refresh;
  const refresh = useCallback(() => {
    refreshFixed();
    refreshPatients();
  }, [refreshFixed, refreshPatients]);
  const appointments = data.appointments?.appointments || [];
  const allPatients = data.patients?.patients || [];
  const patients = filterPatientList(allPatients, debouncedPatientSearch);
  const prescriptions = data.prescriptions?.prescriptions || [];
  const vitals = data.vitals?.vitals || [];
  const clinicalNotes = data.clinicalNotes?.clinicalNotes || [];
  const emptyPrescription = { patientId: '', appointmentId: '', diagnosis: '', instructions: '', followUp: '', advice: { suggestions: [], notes: '' }, medicines: [{ name: '', dosage: '', frequency: '', duration: '', customDuration: '', timing: '', route: '', instructions: '' }] };
  const emptyClinicalNote = { patientId: '', chiefComplaint: '', historyOfPresentIllness: '', examination: '', assessment: '', plan: '', followUp: '' };
  const [prescription, setPrescription] = useState(emptyPrescription);
  const [clinicalNote, setClinicalNote] = useState(emptyClinicalNote);
  const [editingRecord, setEditingRecord] = useState(null);
  const selectedPatientChecks = vitals.filter((record) => String(record.patientId?._id || record.patientId) === prescription.patientId);
  const [filter, setFilter] = useState('All');
  const [profilePatientId, setProfilePatientId] = useState('');
  const profilePatient = patients.find((item) => item._id === profilePatientId);
  const patientChart = [
    ...clinicalNotes.map((record) => ({ record, type: 'Visit note', at: record.createdAt })),
    ...prescriptions.map((record) => ({ record, type: 'Prescription', at: record.createdAt })),
    ...vitals.map((record) => ({ record, type: 'Vitals', at: record.createdAt })),
  ].filter(({ record }) => String(record.patientId?._id || record.patientId) === profilePatientId)
    .sort((left, right) => new Date(right.at) - new Date(left.at));

  const change = (setter, key) => (event) => setter((value) => ({ ...value, [key]: event.target.value }));
  const savePrescription = async (event) => {
    event.preventDefault();
    try {
      await api.post('/prescriptions', {
        patientId: prescription.patientId,
        diagnosis: prescription.diagnosis,
        medicines: prescription.medicines.map((medicine) => ({ ...medicine, duration: medicine.duration === 'Custom' ? medicine.customDuration : medicine.duration })),
        appointmentId: prescription.appointmentId || undefined,
        instructions: prescription.instructions,
        followUp: prescription.followUp,
        advice: prescription.advice,
      });
      notify('Prescription saved to the patient record.');
      setPrescription(emptyPrescription);
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const saveClinicalNote = async (event) => {
    event.preventDefault();
    try {
      await api.post('/clinical-notes', clinicalNote);
      notify('Visit note saved to the patient chart.');
      setClinicalNote(emptyClinicalNote);
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const deleteRecord = async (path, recordId, label) => {
    if (!window.confirm(`Delete this ${label}? This action is recorded in the audit log.`)) return;
    try {
      await api.delete(`${path}/${recordId}`);
      notify(`${label} deleted.`);
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const editClinicalNote = (note) => setEditingRecord({ type: 'clinicalNote', record: note });
  const editPrescription = (record) => setEditingRecord({ type: 'prescription', record });
  const editVital = (record) => setEditingRecord({ type: 'vital', record });
  const updateAppointment = async (id, values) => {
    try {
      await api.put(`/appointments/${id}`, values);
      notify('Appointment updated.');
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const visibleAppointments = appointments.filter((item) => filter === 'All' || item.status === filter);

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6">
      <PageTitle eyebrow="Doctor workspace" title={`Welcome, ${user.name}`} description={`${user.specialization || 'Clinical team'} · live appointments and patient records`} icon={Stethoscope} />
      {refreshing && <p role="status" className="text-xs text-slate-500">Refreshing…</p>}
      <Field label="Search patients by name, UHID, or email"><Input value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setPatientPage(1); }} placeholder="Search patient directory" /></Field>
      <PaginationControls page={data.patients?.page || patientPage} total={data.patients?.total || 0} limit={50} onPageChange={setPatientPage} />
      <PatientRegistrationForm notify={notify} onCreated={refresh} />
      <PatientPasswordReset patients={patients} notify={notify} onReset={refresh} />
      <Card title="OPD appointment queue" icon={CalendarDays} action={<Select className="w-auto" value={filter} onChange={(event) => setFilter(event.target.value)}>{['Scheduled', 'Completed', 'Cancelled', 'All'].map((item) => <option key={item}>{item}</option>)}</Select>}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : visibleAppointments.length === 0 ? <Empty>No appointments match this status.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th scope="col" className="pb-3">Patient</th><th scope="col" className="pb-3">Visit</th><th scope="col" className="pb-3">Symptoms</th><th scope="col" className="pb-3">Triage</th><th scope="col" className="pb-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{visibleAppointments.map((item) => <tr key={item._id}><td className="py-3"><p className="font-medium">{item.patientId?.name}</p><p className="text-xs text-slate-500">{item.patientId?.uhid}</p></td><td>{item.department}<p className="text-xs text-slate-500">{formatAppointmentDate(item.date)} · {formatAppointmentSlot(item.time)}</p></td><td className="max-w-48 truncate">{item.symptoms}</td><td><Select aria-label={`Triage for ${item.patientId?.name || 'patient'}`} className="w-auto" value={item.triage} onChange={(event) => updateAppointment(item._id, { triage: event.target.value })}>{triageLevels.map((value) => <option key={value}>{value}</option>)}</Select></td><td><Select aria-label={`Status for ${item.patientId?.name || 'patient'}`} className="w-auto" value={item.status} onChange={(event) => updateAppointment(item._id, { status: event.target.value })}>{['Scheduled', 'Completed', 'Cancelled'].map((value) => <option key={value}>{value}</option>)}</Select></td></tr>)}</tbody></table></div>}
      </Card>
      <Card title="Patient chart & safety summary" icon={ShieldCheck}>
        <Field label="Select patient"><Select value={profilePatientId} onChange={(event) => setProfilePatientId(event.target.value)}><option value="">Choose a patient to review chart details</option>{patients.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.uhid}</option>)}</Select></Field>
        {profilePatient && <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-slate-500">Age · blood group</p><p className="mt-1 font-medium">{calculateAge(profilePatient.dateOfBirth) ?? 'Age not recorded'}{calculateAge(profilePatient.dateOfBirth) !== null ? ' years' : ''} · {profilePatient.bloodGroup || 'Unknown'}</p></div>
          <div><p className="text-slate-500">Allergies</p><p className="mt-1 font-semibold text-rose-700 dark:text-rose-300">{profilePatient.allergies?.length ? profilePatient.allergies.join(', ') : 'None recorded'}</p></div>
          <div><p className="text-slate-500">Ongoing conditions</p><p className="mt-1">{profilePatient.chronicConditions?.length ? profilePatient.chronicConditions.join(', ') : 'None recorded'}</p></div>
          <div><p className="text-slate-500">Current medications</p><p className="mt-1">{profilePatient.currentMedications?.length ? profilePatient.currentMedications.join(', ') : 'None recorded'}</p></div>
        </div>}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Write prescription" icon={ClipboardList}>
          <form onSubmit={savePrescription} className="grid gap-3 sm:grid-cols-2">
            <Field label="Open appointment"><Select required value={prescription.appointmentId} onChange={(event) => { const selected = appointments.find((appointment) => appointment._id === event.target.value); setPrescription((value) => ({ ...value, appointmentId: event.target.value, patientId: selected?.patientId?._id || value.patientId })); }}><option value="">Select an appointment</option>{appointments.map((appointment) => <option key={appointment._id} value={appointment._id}>{appointment.patientId?.name} · {appointment.department} · {formatAppointmentDate(appointment.date)} {formatAppointmentSlot(appointment.time)} · {appointment.status}</option>)}</Select></Field>
            <Field label="Patient"><Select required value={prescription.patientId} onChange={change(setPrescription, 'patientId')}><option value="">Select a patient</option>{patients.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.uhid}</option>)}</Select></Field>
            <Field label="Diagnosis"><Input required value={prescription.diagnosis} onChange={change(setPrescription, 'diagnosis')} /></Field>
            {prescription.medicines.map((medicine, index) => <div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:col-span-2 sm:grid-cols-2">
              <Field label="Medicine"><Input required maxLength="100" value={medicine.name} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} /></Field>
              <Field label="Dosage"><Input required maxLength="100" value={medicine.dosage} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, dosage: event.target.value } : item) }))} placeholder="e.g. 10 mg" /></Field>
              <Field label="Frequency"><Select required value={medicine.frequency} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, frequency: event.target.value } : item) }))}><option value="">Select frequency</option>{prescriptionFrequencies.map((frequency) => <option key={frequency}>{frequency}</option>)}</Select></Field>
              <Field label="Duration"><Select required value={medicine.duration} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, duration: event.target.value } : item) }))}><option value="">Select duration</option>{prescriptionDurations.map((duration) => <option key={duration}>{duration}</option>)}</Select>{medicine.duration === 'Custom' && <Input required maxLength="100" value={medicine.customDuration || ''} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, customDuration: event.target.value } : item) }))} placeholder="e.g. 21 days" />}</Field>
              <Field label="WHEN to take"><Select required value={medicine.timing} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, timing: event.target.value } : item) }))}><option value="">Select timing</option>{prescriptionTimings.map((timing) => <option key={timing}>{timing}</option>)}</Select></Field>
              <Field label="Route"><Input maxLength="50" value={medicine.route} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, route: event.target.value } : item) }))} placeholder="e.g. Oral" /></Field>
              <Field label="Medicine instructions"><Input maxLength="500" value={medicine.instructions} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, instructions: event.target.value } : item) }))} placeholder="e.g. Take with food" /></Field>
              {prescription.medicines.length > 1 && <button type="button" onClick={() => setPrescription((value) => ({ ...value, medicines: value.medicines.filter((_, itemIndex) => itemIndex !== index) }))} className="justify-self-start text-xs text-rose-600 hover:underline sm:col-span-2">Remove medicine</button>}
            </div>)}
            <button type="button" disabled={prescription.medicines.length >= 30} onClick={() => setPrescription((value) => ({ ...value, medicines: [...value.medicines, { name: '', dosage: '', frequency: '', duration: '', customDuration: '', timing: '', route: '', instructions: '' }] }))} className="text-left text-sm font-medium text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300 sm:col-span-2">+ Add another medicine</button>
            <Field label="Prescription instructions"><Textarea rows="2" maxLength="2000" value={prescription.instructions} onChange={change(setPrescription, 'instructions')} placeholder="Additional guidance for the patient" /></Field>
            <Field label="Prescription follow-up"><Input maxLength="500" value={prescription.followUp} onChange={change(setPrescription, 'followUp')} placeholder="e.g. Review in 2 weeks" /></Field>
            <fieldset className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:col-span-2">
              <legend className="px-1 text-sm font-medium">Lifestyle advice</legend>
              {prescriptionAdviceSuggestions.map((suggestion) => <label key={suggestion} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prescription.advice.suggestions.includes(suggestion)} onChange={(event) => setPrescription((value) => ({ ...value, advice: { ...value.advice, suggestions: event.target.checked ? [...value.advice.suggestions, suggestion] : value.advice.suggestions.filter((item) => item !== suggestion) } }))} />{suggestion}</label>)}
              <Field label="Other advice (max 1000 characters)"><Textarea rows="3" maxLength="1000" value={prescription.advice.notes} onChange={(event) => setPrescription((value) => ({ ...value, advice: { ...value.advice, notes: event.target.value } }))} /></Field>
            </fieldset>
            <button className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 sm:col-span-2">Save prescription</button>
          </form>
        </Card>
        <Card title={`Preliminary checks · ${selectedPatientChecks.length}`} icon={Activity}>
          {!prescription.patientId ? <Empty>Select a patient in the prescription form to view their checks.</Empty>
            : selectedPatientChecks.length === 0 ? <Empty>No preliminary checks recorded for this patient.</Empty>
              : <div className="max-h-[34rem] space-y-3 overflow-y-auto">{selectedPatientChecks.map((item) => <article key={item._id} className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
                <p className="font-semibold">{patients.find((patient) => patient._id === prescription.patientId)?.name} · {new Date(item.createdAt).toLocaleString()}</p>
                <p className="mt-1 text-xs text-slate-500">Recorded by {item.enteredBy?.name || item.recordedBy?.name || 'Medical staff'} ({item.enteredByRole || 'staff'})</p>
                {item.editedBy?.name && <p className="mt-1 text-xs font-medium text-teal-700 dark:text-teal-300">Edited by Dr. {item.editedBy.name} · {item.editedAt ? new Date(item.editedAt).toLocaleString() : ''}</p>}
                <p className="mt-2">{[['Heart rate', item.heartRate && `${item.heartRate} bpm`], ['Temperature', item.temperatureC && `${item.temperatureC} °C`], ['Blood pressure', item.systolic && item.diastolic ? `${item.systolic}/${item.diastolic} mmHg` : null], ['SpO₂', item.oxygenSaturation && `${item.oxygenSaturation}%`], ['Height', item.heightCm && `${item.heightCm} cm`], ['Weight', item.weightKg && `${item.weightKg} kg`]].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(' · ')}</p>
                {item.symptoms?.length > 0 && <p className="mt-1"><strong>Symptoms:</strong> {item.symptoms.map((symptom) => symptom === 'Other' && item.symptomOther ? `Other: ${item.symptomOther}` : symptom).join(' · ')}</p>}
                {item.notes && <p className="mt-1 whitespace-pre-wrap">{item.notes}</p>}
                <button type="button" onClick={() => editVital(item)} className="mt-3 text-xs font-semibold text-teal-700 underline dark:text-teal-300">Edit check</button>
              </article>)}</div>}
        </Card>
      </div>
      <Card title="Document a clinical visit" icon={ClipboardList}>
        <form onSubmit={saveClinicalNote} className="grid gap-3 sm:grid-cols-2">
          <Field label="Patient"><Select required value={clinicalNote.patientId} onChange={change(setClinicalNote, 'patientId')}><option value="">Select a patient</option>{patients.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.uhid}</option>)}</Select></Field>
          <Field label="Chief complaint"><Input required maxLength="1000" value={clinicalNote.chiefComplaint} onChange={change(setClinicalNote, 'chiefComplaint')} placeholder="Primary reason for today's visit" /></Field>
          <Field label="History of present illness"><Textarea rows="3" maxLength="3000" value={clinicalNote.historyOfPresentIllness} onChange={change(setClinicalNote, 'historyOfPresentIllness')} placeholder="Onset, duration, and relevant context" /></Field>
          <Field label="Examination findings"><Textarea rows="3" maxLength="3000" value={clinicalNote.examination} onChange={change(setClinicalNote, 'examination')} /></Field>
          <Field label="Assessment / diagnosis"><Textarea required rows="2" maxLength="2000" value={clinicalNote.assessment} onChange={change(setClinicalNote, 'assessment')} /></Field>
          <Field label="Care plan"><Textarea required rows="2" maxLength="3000" value={clinicalNote.plan} onChange={change(setClinicalNote, 'plan')} placeholder="Document the plan and next steps" /></Field>
          <Field label="Follow-up"><Input maxLength="1000" value={clinicalNote.followUp} onChange={change(setClinicalNote, 'followUp')} placeholder="Recommended follow-up" /></Field>
          <button className="self-end rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700">Save visit note</button>
        </form>
      </Card>
      <Card title="Visit notes authored" icon={ClipboardList}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : clinicalNotes.length === 0 ? <Empty>No clinical visit notes have been added.</Empty> : <div className="grid gap-3 md:grid-cols-2">{clinicalNotes.map((note) => <article key={note._id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><div className="flex justify-between gap-2"><p className="font-semibold">{note.patientId?.name} · {note.patientId?.uhid}</p><time className="text-xs text-slate-500">{new Date(note.createdAt).toLocaleDateString()}</time></div><p className="mt-2 text-sm"><span className="font-medium">Complaint:</span> {note.chiefComplaint}</p><p className="mt-1 text-sm"><span className="font-medium">Assessment:</span> {note.assessment}</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{note.plan}</p>{note.doctorId?._id === user.id && <div className="mt-3 flex gap-3 text-xs"><button type="button" onClick={() => editClinicalNote(note)} className="font-semibold text-teal-700 underline dark:text-teal-300">Edit</button><button type="button" onClick={() => deleteRecord('/clinical-notes', note._id, 'visit note')} className="font-semibold text-rose-700 underline dark:text-rose-300">Delete</button></div>}</article>)}</div>}
      </Card>
      <Card title="Prescriptions authored" icon={ClipboardList}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : prescriptions.length === 0 ? <Empty>No prescriptions have been written yet.</Empty> : <div className="grid gap-3 md:grid-cols-2">{prescriptions.map((item) => <div key={item._id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><p className="font-medium">{item.patientId?.name} · {item.diagnosis}</p><p className="mt-1 text-xs text-slate-500">{item.medicines.map((medicine) => `${medicine.name} ${medicine.dosage} · ${medicine.frequency} · ${medicine.duration}`).join(', ')}</p>{item.instructions && <p className="mt-2 text-sm">{item.instructions}</p>}{item.followUp && <p className="mt-1 text-xs text-teal-700 dark:text-teal-300">Follow-up: {item.followUp}</p>}{item.advice?.suggestions?.length > 0 && <p className="mt-2 text-sm">Advice: {item.advice.suggestions.join(' · ')}</p>}{item.advice?.notes && <p className="mt-1 text-sm">{item.advice.notes}</p>}{item.doctorId?._id === user.id && <div className="mt-3 flex gap-3 text-xs"><button type="button" onClick={() => editPrescription(item)} className="font-semibold text-teal-700 underline dark:text-teal-300">Edit</button><button type="button" onClick={() => deleteRecord('/prescriptions', item._id, 'prescription')} className="font-semibold text-rose-700 underline dark:text-rose-300">Delete</button></div>}</div>)}</div>}
      </Card>
      <Card title="Patient clinical records" icon={Activity}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : vitals.length === 0 ? <Empty>No preliminary checks have been entered.</Empty> : <div className="grid gap-3 md:grid-cols-2">{vitals.map((item) => <div key={item._id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><p className="font-medium">{item.patientId?.name} · {new Date(item.createdAt).toLocaleString()}</p><p className="mt-1 text-xs text-slate-500">Recorded by {item.enteredBy?.name || item.recordedBy?.name || 'Medical staff'} ({item.enteredByRole || 'staff'})</p>{item.editedBy?.name && <p className="mt-1 text-xs font-medium text-teal-700 dark:text-teal-300">Edited by Dr. {item.editedBy.name}</p>}<p className="mt-1 text-xs text-slate-500">{[['HR', item.heartRate && `${item.heartRate} bpm`], ['BP', item.systolic && item.diastolic ? `${item.systolic}/${item.diastolic} mmHg` : null], ['Temp', item.temperatureC && `${item.temperatureC} °C`], ['O₂', item.oxygenSaturation && `${item.oxygenSaturation}%`], ['Height', item.heightCm && `${item.heightCm} cm`], ['Weight', item.weightKg && `${item.weightKg} kg`]].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(' · ')}</p>{item.symptoms?.length > 0 && <p className="mt-1 text-sm">Symptoms: {item.symptoms.join(' · ')}{item.symptomOther && ` · ${item.symptomOther}`}</p>}{item.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{item.notes}</p>}<button type="button" onClick={() => editVital(item)} className="mt-3 text-xs font-semibold text-teal-700 underline dark:text-teal-300">Edit check</button></div>)}</div>}
      </Card>
      <Card title="Patient-centered chart" icon={Activity}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : !profilePatient ? <Empty>Choose a patient above to view their complete recent chart.</Empty> : patientChart.length === 0 ? <Empty>No notes, prescriptions, or vitals are recorded for this patient.</Empty> : <div className="space-y-3">{patientChart.map(({ record, type }) => <article key={`${type}-${record._id}`} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700"><div className="flex justify-between gap-3"><strong>{type}</strong><time className="text-xs text-slate-500">{new Date(record.createdAt).toLocaleString()}</time></div><p className="mt-1">{type === 'Visit note' ? `${record.chiefComplaint} · ${record.assessment} · ${record.plan}` : type === 'Prescription' ? `${record.diagnosis} · ${record.medicines.map((medicine) => medicine.name).join(', ')}` : [['HR', record.heartRate], ['BP', record.systolic && record.diastolic ? `${record.systolic}/${record.diastolic}` : null], ['Temp °C', record.temperatureC], ['O₂ %', record.oxygenSaturation]].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(' · ')}</p></article>)}</div>}
      </Card>
      {editingRecord && <RecordEditDialog editor={editingRecord} notify={notify} onClose={() => setEditingRecord(null)} onSaved={refresh} />}
    </main>
  );
}

function RecordEditDialog({ editor, notify, onClose, onSaved }) {
  const { type, record } = editor;
  const [form, setForm] = useState(() => {
    if (type === 'prescription') {
      return {
        diagnosis: record.diagnosis || '',
        medicines: record.medicines.map((medicine) => ({ ...medicine })),
        instructions: record.instructions || '',
        followUp: record.followUp || '',
        advice: { suggestions: record.advice?.suggestions || [], notes: record.advice?.notes || '' },
      };
    }
    if (type === 'clinicalNote') {
      return Object.fromEntries(['chiefComplaint', 'historyOfPresentIllness', 'examination', 'assessment', 'plan', 'followUp']
        .map((field) => [field, record[field] || '']));
    }
    return {
      ...Object.fromEntries([
        'heartRate', 'systolic', 'diastolic', 'respiratoryRate', 'temperatureC', 'bloodGlucose',
        'oxygenSaturation', 'heightCm', 'weightKg',
      ].map((field) => [field, record[field] ?? ''])),
      notes: record.notes || '',
      symptoms: record.symptoms || [],
      symptomOther: record.symptomOther || '',
    };
  });
  const [saving, setSaving] = useState(false);
  const setField = (field) => (event) => setForm((value) => ({ ...value, [field]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const path = type === 'clinicalNote' ? '/clinical-notes' : type === 'prescription' ? '/prescriptions' : '/vitals';
      let payload = form;
      if (type === 'vital') {
        payload = Object.fromEntries(Object.entries(form).map(([field, value]) => [
          field,
          ['heartRate', 'systolic', 'diastolic', 'respiratoryRate', 'temperatureC', 'bloodGlucose', 'oxygenSaturation', 'heightCm', 'weightKg'].includes(field)
            ? value === '' ? null : Number(value)
            : value,
        ]));
        if (!form.symptoms.includes('Other')) payload.symptomOther = '';
      }
      await api.put(`${path}/${record._id}`, payload);
      notify(type === 'vital' ? 'Preliminary check updated and audited.' : 'Record updated.');
      onSaved();
      onClose();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const title = type === 'prescription' ? 'Edit prescription' : type === 'clinicalNote' ? 'Edit doctor’s note' : 'Edit preliminary check';

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="edit-record-title" className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/60 p-3 sm:p-4">
      <div className="grid min-h-full place-items-center">
        <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6 dark:bg-slate-900">
          <h2 id="edit-record-title" className="text-lg font-bold">{title}</h2>
          <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
            {type === 'clinicalNote' && <>
              <Field label="Chief complaint"><Input required maxLength="1000" value={form.chiefComplaint} onChange={setField('chiefComplaint')} /></Field>
              <Field label="History of present illness"><Textarea rows="3" maxLength="3000" value={form.historyOfPresentIllness} onChange={setField('historyOfPresentIllness')} /></Field>
              <Field label="Examination findings"><Textarea rows="3" maxLength="3000" value={form.examination} onChange={setField('examination')} /></Field>
              <Field label="Assessment / diagnosis"><Textarea required rows="2" maxLength="2000" value={form.assessment} onChange={setField('assessment')} /></Field>
              <Field label="Care plan"><Textarea required rows="2" maxLength="3000" value={form.plan} onChange={setField('plan')} /></Field>
              <Field label="Follow-up"><Input maxLength="1000" value={form.followUp} onChange={setField('followUp')} /></Field>
            </>}
            {type === 'prescription' && <>
              <Field label="Diagnosis"><Input required maxLength="2000" value={form.diagnosis} onChange={setField('diagnosis')} /></Field>
              {form.medicines.map((medicine, index) => <div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:col-span-2 sm:grid-cols-2">
                {['name', 'dosage', 'frequency', 'duration', 'route', 'instructions'].map((field) => <Field key={field} label={`Medicine ${index + 1} ${field}`}><Input maxLength={field === 'instructions' ? 500 : field === 'route' ? 50 : 100} required={['name', 'dosage', 'frequency', 'duration'].includes(field)} value={medicine[field] || ''} onChange={(event) => setForm((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: event.target.value } : item) }))} /></Field>)}
                <Field label={`Medicine ${index + 1} WHEN to take`}><Select value={medicine.timing || ''} onChange={(event) => setForm((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, timing: event.target.value } : item) }))}><option value="">Not specified</option>{prescriptionTimings.map((timing) => <option key={timing}>{timing}</option>)}</Select></Field>
                {form.medicines.length > 1 && <button type="button" className="justify-self-start text-xs text-rose-600 underline sm:col-span-2" onClick={() => setForm((value) => ({ ...value, medicines: value.medicines.filter((_, itemIndex) => itemIndex !== index) }))}>Remove medicine</button>}
              </div>)}
              <button type="button" disabled={form.medicines.length >= 30} className="justify-self-start text-sm font-semibold text-teal-700 underline disabled:opacity-50 dark:text-teal-300 sm:col-span-2" onClick={() => setForm((value) => ({ ...value, medicines: [...value.medicines, { name: '', dosage: '', frequency: '', duration: '', route: '', instructions: '' }] }))}>Add medicine</button>
              <Field label="Prescription instructions"><Textarea rows="2" maxLength="2000" value={form.instructions} onChange={setField('instructions')} /></Field>
              <Field label="Prescription follow-up"><Input maxLength="500" value={form.followUp} onChange={setField('followUp')} /></Field>
              <fieldset className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:col-span-2">
                <legend className="px-1 text-sm font-medium">Lifestyle advice</legend>
                {prescriptionAdviceSuggestions.map((suggestion) => <label key={suggestion} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.advice.suggestions.includes(suggestion)} onChange={(event) => setForm((value) => ({ ...value, advice: { ...value.advice, suggestions: event.target.checked ? [...value.advice.suggestions, suggestion] : value.advice.suggestions.filter((item) => item !== suggestion) } }))} />{suggestion}</label>)}
                <Field label="Other advice"><Textarea rows="3" maxLength="1000" value={form.advice.notes} onChange={(event) => setForm((value) => ({ ...value, advice: { ...value.advice, notes: event.target.value } }))} /></Field>
              </fieldset>
            </>}
            {type === 'vital' && <>
              {[['heartRate', 'Heart rate (bpm)', '20', '300', '1'], ['temperatureC', 'Temperature (°C)', '25', '45', '0.1'], ['systolic', 'Systolic BP (mmHg)', '40', '300', '1'], ['diastolic', 'Diastolic BP (mmHg)', '20', '200', '1'], ['oxygenSaturation', 'SpO₂ (%)', '1', '100', '1'], ['heightCm', 'Height (cm)', '30', '250', '0.1'], ['weightKg', 'Weight (kg)', '1', '500', '0.1'], ['respiratoryRate', 'Respiratory rate (/min)', '1', '100', '1'], ['bloodGlucose', 'Blood glucose (mg/dL)', '1', '2000', '1']].map(([key, label, min, max, step]) => <Field key={key} label={label}><Input type="number" min={min} max={max} step={step} value={form[key]} onChange={setField(key)} /></Field>)}
              <fieldset className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:col-span-2">
                <legend className="px-1 text-sm font-medium">Symptoms</legend>
                <Select multiple size={preliminaryCheckSymptoms.length} value={form.symptoms} onChange={(event) => setForm((value) => ({
                  ...value,
                  symptoms: Array.from(event.target.selectedOptions, (option) => option.value),
                }))}>
                  {preliminaryCheckSymptoms.map((symptom) => <option key={symptom}>{symptom}</option>)}
                </Select>
                {form.symptoms.includes('Other') && <Field label="Other symptom (max 200 characters)"><Input maxLength="200" value={form.symptomOther} onChange={setField('symptomOther')} /></Field>}
              </fieldset>
              <Field label="Note (max 1000 characters)"><Textarea rows="3" maxLength="1000" value={form.notes} onChange={setField('notes')} /></Field>
            </>}
            <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">Cancel</button><button disabled={saving} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save changes'}</button></div>
          </form>
        </section>
      </div>
    </div>,
    document.body,
  );
}

function PreliminaryCheckForm({ patients, appointments = [], notify, onSaved }) {
  const [form, setForm] = useState({
    patientId: '', appointmentId: '',
    heartRate: '',
    temperatureC: '',
    systolic: '',
    diastolic: '',
    oxygenSaturation: '',
    heightCm: '',
    weightKg: '',
    symptoms: [],
    symptomOther: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const change = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/vitals', {
        ...form,
        appointmentId: form.appointmentId,
        symptomOther: form.symptoms.includes('Other') ? form.symptomOther : '',
      });
      notify('Preliminary check recorded.');
      setForm({
        patientId: '', appointmentId: '', heartRate: '', temperatureC: '', systolic: '', diastolic: '',
        oxygenSaturation: '', heightCm: '', weightKg: '', symptoms: [], symptomOther: '', notes: '',
      });
      onSaved();
    } catch (error) {
      setError(error.message);
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Preliminary check" icon={Activity}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Today appointment"><Select required value={form.appointmentId} onChange={(event) => { const selected = appointments.find((appointment) => appointment._id === event.target.value); setForm((value) => ({ ...value, appointmentId: event.target.value, patientId: selected?.patientId?._id || '' })); }}><option value="">Select an appointment</option>{appointments.map((appointment) => <option key={appointment._id} value={appointment._id}>{appointment.patientId?.name} · Age {calculateAge(appointment.patientId?.dateOfBirth) ?? '—'} · {appointment.patientId?.uhid} · {formatAppointmentSlot(appointment.time)}</option>)}</Select></Field>
        <Field label="Patient"><Select required value={form.patientId} onChange={change('patientId')}><option value="">Select a patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></Field>
        {[['heartRate', 'Heart rate (bpm)', '20', '300', '1'], ['temperatureC', 'Temperature (°C)', '25', '45', '0.1'], ['systolic', 'Systolic BP (mmHg)', '40', '300', '1'], ['diastolic', 'Diastolic BP (mmHg)', '20', '200', '1'], ['oxygenSaturation', 'SpO₂ (%)', '1', '100', '1'], ['heightCm', 'Height (cm)', '30', '250', '0.1'], ['weightKg', 'Weight (kg)', '1', '500', '0.1']].map(([key, label, min, max, step]) => <Field key={key} label={label}><Input type="number" min={min} max={max} step={step} value={form[key]} onChange={change(key)} /></Field>)}
        <fieldset className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:col-span-2">
          <legend className="px-1 text-sm font-medium">Symptoms (select all that apply)</legend>
          <Select multiple size={preliminaryCheckSymptoms.length} value={form.symptoms} onChange={(event) => setForm((value) => ({
            ...value,
            symptoms: Array.from(event.target.selectedOptions, (option) => option.value),
          }))}>
            {preliminaryCheckSymptoms.map((symptom) => <option key={symptom}>{symptom}</option>)}
          </Select>
          {form.symptoms.includes('Other') && <Field label="Describe other symptom (max 200 characters)"><Input maxLength="200" value={form.symptomOther} onChange={change('symptomOther')} required /></Field>}
        </fieldset>
        <Field label="Note (max 1000 characters)"><Textarea rows="3" maxLength="1000" value={form.notes} onChange={change('notes')} /></Field>
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300 sm:col-span-2">{error}</p>}
        <button disabled={saving || !patients.length} className="self-end rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save preliminary check'}</button>
      </form>
    </Card>
  );
}

function StaffDashboard({ notify }) {
  const [patientSearch, setPatientSearch] = useState('');
  const [patientPage, setPatientPage] = useState(1);
  const debouncedPatientSearch = useDebouncedValue(patientSearch);
  const fixedLoad = useLoad(notify, [
    { key: 'appointments', path: '/appointments' },
    { key: 'doctors', path: '/doctors' },
    { key: 'beds', path: '/beds' },
    { key: 'vitals', path: '/vitals' },
  ]);
  const patientLoad = useLoad(notify, [
    { key: 'patients', path: `/patients?page=${patientPage}&limit=50&q=${encodeURIComponent(debouncedPatientSearch)}` },
  ]);
  const data = { ...fixedLoad.data, ...patientLoad.data };
  const loading = fixedLoad.loading || patientLoad.loading;
  const refreshing = fixedLoad.refreshing || patientLoad.refreshing;
  const error = fixedLoad.error || patientLoad.error;
  const refreshFixed = fixedLoad.refresh;
  const refreshPatients = patientLoad.refresh;
  const appointments = data.appointments?.appointments || [];
  const allPatients = data.patients?.patients || [];
  const patients = filterPatientList(allPatients, debouncedPatientSearch);
  const doctors = data.doctors?.doctors || [];
  const beds = data.beds?.beds || [];
  const [appointmentForm, setAppointmentForm] = useState({
    patientId: '', doctorId: '', department: departments[0], date: '', time: '', symptoms: '', triage: 'OPD Routine',
  });
  const [assignment, setAssignment] = useState({});
  const refresh = useCallback(() => {
    setAssignment({});
    refreshFixed();
    refreshPatients();
  }, [refreshFixed, refreshPatients]);
  const change = (setter, key) => (event) => setter((value) => ({ ...value, [key]: event.target.value }));
  const bookAppointment = async (event) => {
    event.preventDefault();
    try {
      await api.post('/appointments', appointmentForm);
      notify('Appointment booked and added to the doctor queue.');
      setAppointmentForm((value) => ({ ...value, symptoms: '', date: '', time: '' }));
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const updateAppointment = async (id, values) => {
    try {
      await api.put(`/appointments/${id}`, values);
      notify('Appointment updated.');
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const cancelAppointment = async (id) => {
    if (!window.confirm('Cancel this appointment?')) return;
    try {
      await api.delete(`/appointments/${id}`);
      notify('Appointment cancelled.');
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const updateBed = async (bed, status, patientId) => {
    try {
      const nextStatus = status ?? (patientId ? 'Occupied' : 'Available');
      if (bed.patientId && ['Available', 'Maintenance'].includes(nextStatus)
        && !window.confirm(`Discharge ${bed.patientId.name} from bed ${bed.bedNumber}?`)) return;
      await api.put(`/beds/${bed._id}`, {
        status: nextStatus,
        patientId: nextStatus === 'Occupied' ? patientId ?? bed.patientId?._id : null,
      });
      notify('Bed assignment updated.');
      setAssignment((value) => {
        const next = { ...value };
        delete next[bed._id];
        return next;
      });
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6">
      <PageTitle eyebrow="Medical staff workspace" title="Patient care coordination" description="Register patients, coordinate appointments, and manage bed assignments." icon={Stethoscope} />
      {refreshing && <p role="status" className="text-xs text-slate-500">Refreshing…</p>}
      <Field label="Search patients by name, UHID, or email"><Input value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setPatientPage(1); }} placeholder="Search patient directory" /></Field>
      <PaginationControls page={data.patients?.page || patientPage} total={data.patients?.total || 0} limit={50} onPageChange={setPatientPage} />
      <PatientRegistrationForm notify={notify} onCreated={refresh} />
      <PatientPasswordReset patients={patients} notify={notify} onReset={refresh} />
      <PreliminaryCheckForm patients={patients} appointments={appointments.filter((appointment) => appointment.date?.slice(0, 10) === localDateValue() && ['Booked', 'Scheduled', 'Checked in'].includes(appointment.status))} notify={notify} onSaved={refresh} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Book an appointment" icon={CalendarDays}>
          <form onSubmit={bookAppointment} className="grid gap-3 sm:grid-cols-2">
            <Field label="Patient"><Select required value={appointmentForm.patientId} onChange={change(setAppointmentForm, 'patientId')}><option value="">Select patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></Field>
            <Field label="Department"><Select value={appointmentForm.department} onChange={(event) => setAppointmentForm((value) => ({ ...value, department: event.target.value, doctorId: '' }))}>{departments.map((department) => <option key={department}>{department}</option>)}</Select></Field>
            <Field label="Doctor"><Select value={appointmentForm.doctorId} onChange={change(setAppointmentForm, 'doctorId')}><option value="">Assign later</option>{doctors.filter((doctor) => doctor.specialization === appointmentForm.department).map((doctor) => <option key={doctor._id} value={doctor._id}>{doctor.name}</option>)}</Select></Field>
            <Field label="Triage"><Select value={appointmentForm.triage} onChange={change(setAppointmentForm, 'triage')}>{triageLevels.map((item) => <option key={item}>{item}</option>)}</Select></Field>
            <Field label="Appointment date"><Input type="date" min={localDateValue()} value={appointmentForm.date} onChange={change(setAppointmentForm, 'date')} required /><span className="text-xs font-normal text-slate-500">Appointments are available every day, including weekends and holidays.</span></Field>
            <Field label={`One-hour appointment slot (${String(clinicStartHour).padStart(2, '0')}:00–${String(clinicEndHour).padStart(2, '0')}:00)`}><Select value={appointmentForm.time} onChange={change(setAppointmentForm, 'time')} required><option value="">Select an available time</option>{appointmentSlots.map((slot) => {
              const isBooked = Boolean(appointmentForm.doctorId && appointmentForm.date && appointments.some((appointment) => (
                appointment.doctorId?._id === appointmentForm.doctorId
                && appointment.date.slice(0, 10) === appointmentForm.date
                && appointment.time === slot.time
                && activeAppointmentStatuses.includes(appointment.status)
              )));
              return <option key={slot.time} value={slot.time} disabled={isBooked}>{isBooked ? `${slot.label} · booked` : slot.label}</option>;
            })}</Select><span className="text-xs font-normal text-slate-500">{appointmentForm.doctorId && appointmentForm.date ? 'Booked slots for this doctor and date are disabled.' : 'Select a doctor and date to check for existing bookings.'}</span></Field>
            <Field label="Symptoms"><Textarea rows="2" maxLength="2000" value={appointmentForm.symptoms} onChange={change(setAppointmentForm, 'symptoms')} required /></Field>
            <div className="self-end"><button className="w-full rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700">Book visit</button><p className="mt-1 text-center text-xs text-slate-500">Scheduling hours: {String(clinicStartHour).padStart(2, '0')}:00–{String(clinicEndHour).padStart(2, '0')}:00</p></div>
          </form>
        </Card>
      </div>
      <Card title={`OPD coordination queue · ${appointments.length}`} icon={CalendarDays}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : appointments.length === 0 ? <Empty>No appointments have been booked.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th scope="col" className="pb-3">Patient</th><th scope="col" className="pb-3">Visit</th><th scope="col" className="pb-3">Doctor</th><th scope="col" className="pb-3">Triage</th><th scope="col" className="pb-3">Status</th><th scope="col" className="pb-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{appointments.map((item) => <tr key={item._id}><td className="py-3"><p className="font-medium">{item.patientId?.name}</p><p className="text-xs text-slate-500">{item.patientId?.uhid}</p></td><td>{item.department}<p className="text-xs text-slate-500">{formatAppointmentDate(item.date)} · {formatAppointmentSlot(item.time)}</p><p className="max-w-56 truncate text-xs text-slate-500">{item.symptoms}</p></td><td><Select aria-label={`Doctor for ${item.patientId?.name || 'patient'}`} className="w-auto" value={item.doctorId?._id || ''} onChange={(event) => updateAppointment(item._id, { doctorId: event.target.value })}><option value="">Unassigned</option>{doctors.filter((doctor) => doctor.specialization === item.department).map((doctor) => <option key={doctor._id} value={doctor._id}>{doctor.name}</option>)}</Select></td><td><Select aria-label={`Triage for ${item.patientId?.name || 'patient'}`} className="w-auto" value={item.triage} onChange={(event) => updateAppointment(item._id, { triage: event.target.value })}>{triageLevels.map((value) => <option key={value}>{value}</option>)}</Select></td><td><Select aria-label={`Status for ${item.patientId?.name || 'patient'}`} className="w-auto" value={item.status} onChange={(event) => updateAppointment(item._id, { status: event.target.value })}>{['Scheduled', 'Completed', 'Cancelled'].map((value) => <option key={value}>{value}</option>)}</Select></td><td>{item.status === 'Scheduled' && <button type="button" onClick={() => cancelAppointment(item._id)} className="text-xs font-semibold text-rose-700 underline dark:text-rose-300">Cancel</button>}</td></tr>)}</tbody></table></div>}
      </Card>
      <Card title={`Bed assignments · ${beds.length}`} icon={BedDouble}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : beds.length === 0 ? <Empty>No beds are configured yet.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th scope="col" className="pb-3">Bed</th><th scope="col" className="pb-3">Ward</th><th scope="col" className="pb-3">Patient</th><th scope="col" className="pb-3">Status</th><th scope="col" className="pb-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{beds.map((bed) => <tr key={bed._id}><td className="py-3 font-semibold">{bed.bedNumber}</td><td>{bed.ward}</td><td><Select aria-label={`Patient assigned to bed ${bed.bedNumber}`} value={assignment[bed._id] ?? bed.patientId?._id ?? ''} onChange={(event) => setAssignment((value) => ({ ...value, [bed._id]: event.target.value }))}><option value="">Unassigned</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></td><td><Select aria-label={`Status of bed ${bed.bedNumber}`} value={bed.status} onChange={(event) => updateBed(bed, event.target.value, assignment[bed._id] ?? bed.patientId?._id ?? null)}>{['Available', 'Occupied', 'Maintenance'].map((status) => <option key={status}>{status}</option>)}</Select></td><td><button type="button" onClick={() => updateBed(bed, null, assignment[bed._id] || null)} className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">Save assignment</button></td></tr>)}</tbody></table></div>}
      </Card>
    </main>
  );
}

function ReceptionistDashboard({ notify }) {
  const [patientSearch, setPatientSearch] = useState('');
  const [patientPage, setPatientPage] = useState(1);
  const debouncedPatientSearch = useDebouncedValue(patientSearch);
  const fixedLoad = useLoad(notify, [
    { key: 'appointments', path: '/appointments' },
    { key: 'doctors', path: '/doctors' },
    { key: 'billing', path: `/billing?page=1&limit=100&q=${encodeURIComponent(debouncedPatientSearch)}` },
  ]);
  const patientLoad = useLoad(notify, [
    { key: 'patients', path: `/patients?page=${patientPage}&limit=50&q=${encodeURIComponent(debouncedPatientSearch)}` },
  ]);
  const data = { ...fixedLoad.data, ...patientLoad.data };
  const loading = fixedLoad.loading || patientLoad.loading;
  const error = fixedLoad.error || patientLoad.error;
  const appointments = data.appointments?.appointments || [];
  const patients = data.patients?.patients || [];
  const todaysAppointments = appointments.filter((appointment) => appointment.date?.slice(0, 10) === localDateValue());
  const doctors = data.doctors?.doctors || [];
  const bills = data.billing?.bills || [];
  const refreshFixed = fixedLoad.refresh;
  const refreshPatients = patientLoad.refresh;
  const refresh = useCallback(() => {
    refreshFixed();
    refreshPatients();
  }, [refreshFixed, refreshPatients]);
  const [appointmentForm, setAppointmentForm] = useState({
    patientId: '', doctorId: '', department: departments[0], date: '', time: '', symptoms: '', triage: 'OPD Routine',
  });
  const [reportPatientId, setReportPatientId] = useState('');
  const [report, setReport] = useState({ loading: false, error: '', prescription: null });
  const [billingAppointmentId, setBillingAppointmentId] = useState('');
  const [billingPrescription, setBillingPrescription] = useState(null);
  const reportRequest = useRef(0);
  const [billForm, setBillForm] = useState({
    patientId: '',
    lineItems: [{ description: 'Consultation fee', amount: '500' }],
    discount: '',
    notes: '',
  });
  const [creatingBill, setCreatingBill] = useState(false);
  const [payingBill, setPayingBill] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ paymentMethod: 'Cash', paymentReference: '' });
  const [savingPayment, setSavingPayment] = useState(false);
  const change = (setter, key) => (event) => setter((value) => ({ ...value, [key]: event.target.value }));
  const reportPatient = patients.find((patient) => patient._id === reportPatientId);
  const subtotalPaise = billForm.lineItems.reduce((sum, item) => {
    const amount = Number(item.amount);
    return sum + (Number.isFinite(amount) ? Math.round(amount * 100) : 0);
  }, 0);
  const discountPaise = Number.isFinite(Number(billForm.discount)) ? Math.round(Number(billForm.discount || 0) * 100) : 0;

  const chooseReportPatient = async (patientId) => {
    setReportPatientId(patientId);
    const requestId = reportRequest.current + 1;
    reportRequest.current = requestId;
    if (!patientId) {
      setReport({ loading: false, error: '', prescription: null });
      return;
    }
    setReport({ loading: true, error: '', prescription: null });
    try {
      const { data: result } = await api.get(`/prescriptions?patientId=${encodeURIComponent(patientId)}&limit=20`);
      if (reportRequest.current === requestId) {
        setReport({ loading: false, error: '', prescription: result.prescriptions?.[0] || null });
      }
    } catch (requestError) {
      if (reportRequest.current === requestId) {
        setReport({ loading: false, error: requestError.message, prescription: null });
      }
    }
  };

  const chooseBillingAppointment = async (appointmentId) => {
    setBillingAppointmentId(appointmentId);
    const appointment = appointments.find((item) => item._id === appointmentId);
    if (!appointment) {
      setBillingPrescription(null);
      setBillForm((value) => ({ ...value, patientId: '', lineItems: [{ description: '', amount: '' }] }));
      return;
    }
    try {
      const { data: result } = await api.get(`/prescriptions?patientId=${encodeURIComponent(appointment.patientId?._id)}&limit=20`);
      const prescription = result.prescriptions?.[0] || null;
      setBillingPrescription(prescription);
      setBillForm((value) => ({
        ...value,
        patientId: appointment.patientId?._id || '',
        lineItems: prescription?.medicines?.map((medicine) => ({
          description: `${medicine.name} · ${medicine.dosage} · ${medicine.frequency}${medicine.timing ? ` · ${medicine.timing}` : ''}`,
          amount: '',
        })) || [{ description: '', amount: '' }],
      }));
    } catch (requestError) {
      setBillingPrescription(null);
      notify(requestError.message, 'error');
    }
  };

  const bookAppointment = async (event) => {
    event.preventDefault();
    try {
      await api.post('/appointments', appointmentForm);
      notify('Appointment booked.');
      setAppointmentForm((value) => ({ ...value, symptoms: '', date: '', time: '' }));
      refresh();
    } catch (requestError) {
      notify(requestError.message, 'error');
    }
  };
  const createBill = async (event) => {
    event.preventDefault();
    if (creatingBill) return;
    setCreatingBill(true);
    try {
      await api.post('/billing', {
        patientId: billForm.patientId,
        appointmentId: billingAppointmentId || undefined,
        lineItems: billForm.lineItems.map((item) => ({ ...item, amount: Number(item.amount) })),
        discount: billForm.discount === '' ? undefined : Number(billForm.discount),
        notes: billForm.notes,
      });
      notify('Bill issued. No payment has been processed.');
      setBillingAppointmentId('');
      setBillingPrescription(null);
      setBillForm({ patientId: '', lineItems: [{ description: 'Consultation fee', amount: '' }], discount: '', notes: '' });
      refresh();
    } catch (requestError) {
      notify(requestError.message, 'error');
    } finally {
      setCreatingBill(false);
    }
  };
  const recordPayment = async (event) => {
    event.preventDefault();
    if (!payingBill || savingPayment) return;
    setSavingPayment(true);
    try {
      await api.put(`/billing/${payingBill._id}`, { status: 'Paid', ...paymentForm });
      notify(`Payment method recorded for ${payingBill.invoiceNumber}. This is a demo only.`);
      setPayingBill(null);
      setPaymentForm({ paymentMethod: 'Cash', paymentReference: '' });
      refreshFixed();
    } catch (requestError) {
      notify(requestError.message, 'error');
    } finally {
      setSavingPayment(false);
    }
  };
  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6">
      <PageTitle eyebrow="Receptionist workspace" title="Patient services and billing" description="Register patients, book appointments, view doctor reports, and record simulated payments." icon={Receipt} />
      <Field label="Search patients by name, UHID, or email"><Input value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setPatientPage(1); }} placeholder="Search patient directory" /></Field>
      <PaginationControls page={data.patients?.page || patientPage} total={data.patients?.total || 0} limit={50} onPageChange={setPatientPage} />
      <PatientRegistrationForm notify={notify} onCreated={refresh} />
      <Card title="Book an appointment" icon={CalendarDays}>
        <form onSubmit={bookAppointment} className="grid gap-3 sm:grid-cols-2">
          {patients.find((patient) => patient._id === appointmentForm.patientId) && <p className="text-xs text-slate-500 sm:col-span-2">Selected patient: {patients.find((patient) => patient._id === appointmentForm.patientId).name} · Age {calculateAge(patients.find((patient) => patient._id === appointmentForm.patientId).dateOfBirth) ?? 'not recorded'} · {patients.find((patient) => patient._id === appointmentForm.patientId).uhid}</p>}
          <Field label="Patient"><Select required value={appointmentForm.patientId} onChange={change(setAppointmentForm, 'patientId')}><option value="">Select patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></Field>
          <Field label="Department"><Select value={appointmentForm.department} onChange={(event) => setAppointmentForm((value) => ({ ...value, department: event.target.value, doctorId: '' }))}>{departments.map((department) => <option key={department}>{department}</option>)}</Select></Field>
          <Field label="Doctor"><Select value={appointmentForm.doctorId} onChange={change(setAppointmentForm, 'doctorId')}><option value="">Assign later</option>{doctors.filter((doctor) => doctor.specialization === appointmentForm.department).map((doctor) => <option key={doctor._id} value={doctor._id}>{doctor.name}</option>)}</Select></Field>
          <Field label="Triage"><Select value={appointmentForm.triage} onChange={change(setAppointmentForm, 'triage')}>{triageLevels.map((item) => <option key={item}>{item}</option>)}</Select></Field>
          <Field label="Appointment date"><Input type="date" min={localDateValue()} value={appointmentForm.date} onChange={change(setAppointmentForm, 'date')} required /></Field>
          <Field label="One-hour slot"><Select value={appointmentForm.time} onChange={change(setAppointmentForm, 'time')} required><option value="">Select a time</option>{appointmentSlots.map((slot) => {
            const isBooked = Boolean(appointmentForm.doctorId && appointmentForm.date && appointments.some((appointment) => (
              appointment.doctorId?._id === appointmentForm.doctorId
              && appointment.date.slice(0, 10) === appointmentForm.date
              && appointment.time === slot.time
                && activeAppointmentStatuses.includes(appointment.status)
            )));
            return <option key={slot.time} value={slot.time} disabled={isBooked}>{isBooked ? `${slot.label} · booked` : slot.label}</option>;
          })}</Select></Field>
          <Field label="Symptoms"><Textarea rows="2" maxLength="2000" value={appointmentForm.symptoms} onChange={change(setAppointmentForm, 'symptoms')} required /></Field>
          <button className="self-end rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white">Book visit</button>
        </form>
      </Card>
      <Card title="Doctor's report" icon={ClipboardList}>
        <Field label="Choose patient"><Select value={reportPatientId} onChange={(event) => chooseReportPatient(event.target.value)}><option value="">Select a patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></Field>
        <div className="mt-4">
          {report.loading ? <p className="text-sm text-slate-500">Loading latest prescription…</p>
            : report.error ? <p role="alert" className="text-sm text-rose-700">{report.error}</p>
              : !reportPatientId ? <Empty>Choose a patient to view the latest doctor report.</Empty>
                : !report.prescription ? <Empty>No prescription is available for this patient.</Empty>
                  : <article className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
                    <p className="text-xs text-slate-500">{reportPatient?.name} · {reportPatient?.uhid} · {new Date(report.prescription.createdAt).toLocaleString()}</p>
                    <p className="mt-2 font-semibold">Diagnosis: {report.prescription.diagnosis}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">{report.prescription.medicines.map((medicine, index) => <li key={`${report.prescription._id}-${index}`}>{medicine.name} · {medicine.dosage} · {medicine.frequency} · {medicine.duration}</li>)}</ul>
                    {report.prescription.advice?.suggestions?.length > 0 && <p className="mt-3"><strong>Lifestyle advice:</strong> {report.prescription.advice.suggestions.join(' · ')}</p>}
                    {report.prescription.advice?.notes && <p className="mt-1 whitespace-pre-wrap">{report.prescription.advice.notes}</p>}
                  </article>}
        </div>
      </Card>
      <Card title={`Awaiting billing · ${appointments.filter((appointment) => appointment.status === 'Consulted').length}`} icon={Receipt}>
        <Field label="Consulted appointment"><Select value={billingAppointmentId} onChange={(event) => chooseBillingAppointment(event.target.value)}><option value="">Select an appointment</option>{appointments.filter((appointment) => appointment.status === 'Consulted').map((appointment) => <option key={appointment._id} value={appointment._id}>{appointment.patientId?.name} · {formatAppointmentDate(appointment.date)} · {formatAppointmentSlot(appointment.time)}</option>)}</Select></Field>
        {billingPrescription && <article className="mt-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60"><p className="font-semibold">Prescription (read-only)</p><p className="mt-1">Diagnosis: {billingPrescription.diagnosis}</p><ul className="mt-2 list-disc pl-5">{billingPrescription.medicines.map((medicine, index) => <li key={`${billingPrescription._id}-${index}`}>{medicine.name} · {medicine.dosage} · {medicine.frequency} · {medicine.duration}{medicine.timing ? ` · ${medicine.timing}` : ''}</li>)}</ul>{billingPrescription.advice?.suggestions?.length > 0 && <p className="mt-2">Advice: {billingPrescription.advice.suggestions.join(' · ')}</p>}</article>}
      </Card>
      <Card title="Create bill" icon={Receipt}>
        <form onSubmit={createBill} className="grid gap-3">
          <Field label="Patient"><Select required value={billForm.patientId} onChange={change(setBillForm, 'patientId')}><option value="">Select a patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></Field>
          <div className="grid gap-3">
            {billForm.lineItems.map((item, index) => <div key={index} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
              <Field label={`Line item ${index + 1} description`}><Input maxLength="250" required value={item.description} onChange={(event) => setBillForm((value) => ({ ...value, lineItems: value.lineItems.map((line, lineIndex) => lineIndex === index ? { ...line, description: event.target.value } : line) }))} /></Field>
              <Field label="Amount (INR)"><Input type="number" min="0.01" max="100000000" step="0.01" required value={item.amount} onChange={(event) => setBillForm((value) => ({ ...value, lineItems: value.lineItems.map((line, lineIndex) => lineIndex === index ? { ...line, amount: event.target.value } : line) }))} /></Field>
              <button type="button" disabled={billForm.lineItems.length <= 1} className="self-end rounded-lg border px-3 py-2 text-sm disabled:opacity-40" onClick={() => setBillForm((value) => ({ ...value, lineItems: value.lineItems.filter((_, lineIndex) => lineIndex !== index) }))}>Remove</button>
            </div>)}
          </div>
          <button type="button" disabled={billForm.lineItems.length >= 50} className="justify-self-start text-sm font-semibold text-teal-700 underline dark:text-teal-300" onClick={() => setBillForm((value) => ({ ...value, lineItems: [...value.lineItems, { description: '', amount: '' }] }))}>Add line item</button>
          <Field label="Optional discount (INR)"><Input type="number" min="0" max="100000000" step="0.01" value={billForm.discount} onChange={change(setBillForm, 'discount')} /></Field>
          <Field label="Notes"><Textarea rows="2" maxLength="1000" value={billForm.notes} onChange={change(setBillForm, 'notes')} /></Field>
          <p className="font-semibold">Estimated total: {formatCurrency(Math.max(0, subtotalPaise - discountPaise))} <span className="text-xs font-normal text-slate-500">(server computes the saved total)</span></p>
          <button disabled={creatingBill} className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{creatingBill ? 'Issuing bill…' : 'Issue bill'}</button>
        </form>
      </Card>
      <Card title="Bills and payment" icon={Receipt}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : bills.length === 0 ? <Empty>No bills match this search.</Empty> : <div className="space-y-3">{bills.map((bill) => <article key={bill._id} className="printable-invoice rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700">
          <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{bill.invoiceNumber} · {bill.patientId?.name} · {bill.status}</p><p className="font-bold">{formatCurrency(bill.totalPaise)}</p></div>
          <ul className="mt-2 space-y-1">{bill.lineItems?.length ? bill.lineItems.map((item, index) => <li key={`${bill._id}-${index}`} className="flex justify-between gap-3"><span>{item.description}</span><span>{formatCurrency(item.amountPaise)}</span></li>) : <li>{bill.description}</li>}</ul>
          {bill.discountPaise > 0 && <p className="mt-1">Discount: −{formatCurrency(bill.discountPaise)}</p>}
          {bill.paymentMethod && <p className="mt-2">Payment: {bill.paymentMethod}{bill.paidAt ? ` · ${new Date(bill.paidAt).toLocaleString()}` : ''}</p>}
          {bill.status === 'Unpaid' && <button type="button" className="no-print mt-3 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white" onClick={() => { setPayingBill(bill); setPaymentForm({ paymentMethod: 'Cash', paymentReference: '' }); }}>Record payment</button>}
          <button type="button" className="no-print ml-2 mt-3 rounded-lg border px-3 py-2 text-xs font-semibold" onClick={() => window.print()}>Print invoice</button>
        </article>)}</div>}
      </Card>
      <Card title={`Today's appointment queue · ${todaysAppointments.length}`} icon={CalendarDays}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : todaysAppointments.length === 0 ? <Empty>No appointments are booked for today.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Patient</th><th className="pb-3">Visit</th><th className="pb-3">Doctor</th><th className="pb-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{todaysAppointments.map((item) => <tr key={item._id}><td className="py-3">{item.patientId?.name}<span className="block text-xs text-slate-500">Age {calculateAge(item.patientId?.dateOfBirth) ?? '—'} · {item.patientId?.uhid}</span></td><td>{item.department}<p className="text-xs text-slate-500">{formatAppointmentDate(item.date)} · {formatAppointmentSlot(item.time)}</p></td><td>{item.doctorId?.name || 'Unassigned'}</td><td>{item.status}</td></tr>)}</tbody></table></div>}
      </Card>
      {payingBill && createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="payment-title" className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/60 p-3 sm:p-4">
          <div className="grid min-h-full place-items-center">
            <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6 dark:bg-slate-900">
              <h2 id="payment-title" className="text-lg font-bold">Record simulated payment</h2>
              <p className="mt-1 text-sm text-slate-500">{payingBill.invoiceNumber} · {formatCurrency(payingBill.totalPaise)}</p>
              <form onSubmit={recordPayment} className="mt-4 grid gap-3">
                <Field label="Payment method"><Select value={paymentForm.paymentMethod} onChange={change(setPaymentForm, 'paymentMethod')}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</Select></Field>
                {paymentForm.paymentMethod === 'UPI QR' && <div className="grid justify-items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-center text-amber-950"><p className="font-bold">DEMO ONLY: no real money is moved</p><QRCodeSVG value={`CURASYS DEMO PAYMENT ${payingBill.invoiceNumber}`} size={180} level="M" /></div>}
                <Field label="Optional reference text (no card, CVV, UPI, or bank details)"><Input maxLength="200" value={paymentForm.paymentReference} onChange={change(setPaymentForm, 'paymentReference')} /></Field>
                <div className="flex justify-end gap-2"><button type="button" className="rounded-lg border px-4 py-2 text-sm" onClick={() => setPayingBill(null)}>Cancel</button><button disabled={savingPayment} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{savingPayment ? 'Saving…' : 'Record payment'}</button></div>
              </form>
            </section>
          </div>
        </div>,
        document.body,
      )}
    </main>
  );
}

function EditPatientDialog({ patient, notify, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: patient.name || '',
    email: patient.email || '',
    phone: patient.phone || '',
    address: patient.address || '',
    heightCm: patient.heightCm ?? '',
    weightKg: patient.weightKg ?? '',
  });
  const change = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api.put(`/patients/${patient._id}`, {
        ...form,
        heightCm: form.heightCm === '' ? null : Number(form.heightCm),
        weightKg: form.weightKg === '' ? null : Number(form.weightKg),
      });
      notify('Patient chart updated.');
      onSaved();
      onClose();
    } catch (error) {
      notify(error.message, 'error');
    }
  };
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="edit-patient-title" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/60 p-4">
      <section className="my-auto w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <h2 id="edit-patient-title" className="text-lg font-bold">Edit patient chart · {patient.uhid}</h2>
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Full name"><Input value={form.name} onChange={change('name')} maxLength="100" required /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={change('email')} maxLength="254" required /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={change('phone')} maxLength="30" /></Field>
          <Field label="Address"><Textarea rows="2" value={form.address} onChange={change('address')} maxLength="500" /></Field>
          <Field label="Height (cm) · blank clears value"><Input type="number" min="30" max="250" step="0.1" value={form.heightCm} onChange={change('heightCm')} /></Field>
          <Field label="Weight (kg) · blank clears value"><Input type="number" min="1" max="500" step="0.1" value={form.weightKg} onChange={change('weightKg')} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">Cancel</button><button className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white">Save changes</button></div>
        </form>
      </section>
    </div>,
    document.body,
  );
}

function AdminDashboard({ notify }) {
  const [patientSearch, setPatientSearch] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [patientPage, setPatientPage] = useState(1);
  const debouncedPatientSearch = useDebouncedValue(patientSearch);
  const fixedLoad = useLoad(notify, [
    { key: 'beds', path: '/beds' },
    { key: 'billing', path: '/billing' },
    { key: 'appointments', path: '/appointments' },
    { key: 'administrators', path: '/admins' },
    { key: 'staff', path: '/staff' },
    { key: 'receptionists', path: '/receptionists' },
    { key: 'doctors', path: '/doctors' },
    { key: 'audit', path: '/audit' },
    { key: 'vitals', path: '/vitals' },
  ]);
  const patientLoad = useLoad(notify, [
    { key: 'patients', path: `/patients?page=${patientPage}&limit=50&q=${encodeURIComponent(debouncedPatientSearch)}` },
  ]);
  const data = { ...fixedLoad.data, ...patientLoad.data };
  const loading = fixedLoad.loading || patientLoad.loading;
  const refreshing = fixedLoad.refreshing || patientLoad.refreshing;
  const error = fixedLoad.error || patientLoad.error;
  const refreshFixed = fixedLoad.refresh;
  const refreshPatients = patientLoad.refresh;
  const allPatients = data.patients?.patients || [];
  const patients = filterPatientList(allPatients, debouncedPatientSearch);
  const beds = data.beds?.beds || [];
  const totals = data.beds?.totals || [];
  const appointments = data.appointments?.appointments || [];
  const bills = data.billing?.bills || [];
  const administrators = data.administrators?.administrators || [];
  const doctors = data.doctors?.doctors || [];
  const auditItems = data.audit?.items || [];
  const wardTotals = wards.map((ward) => totals.find((item) => item._id === ward) || {
    _id: ward,
    total: 0,
    occupied: 0,
    available: 0,
  });
  const staffMembers = data.staff?.staff || [];
  const receptionists = data.receptionists?.receptionists || [];
  const matchesAccountSearch = (account) => [account.name, account.email, account.phone]
    .some((value) => value?.toLowerCase().includes(accountSearch.trim().toLowerCase()));
  const visibleDoctors = doctors.filter(matchesAccountSearch);
  const visibleStaff = staffMembers.filter(matchesAccountSearch);
  const visibleReceptionists = receptionists.filter(matchesAccountSearch);
  const visiblePatients = patients.filter(matchesAccountSearch);
  const [bedForm, setBedForm] = useState({ bedNumber: '', ward: wards[0] });
  const [assignment, setAssignment] = useState({});
  const [editingPatient, setEditingPatient] = useState(null);
  const loadData = useCallback(() => {
    refreshFixed();
    refreshPatients();
  }, [refreshFixed, refreshPatients]);
  const refresh = useCallback(() => {
    setAssignment({});
    loadData();
  }, [loadData, setAssignment]);

  const change = (setter, key) => (event) => setter((value) => ({ ...value, [key]: event.target.value }));
  const updateDoctorDepartment = async (doctorId, specialization) => {
    try {
      await api.put(`/doctors/${doctorId}`, { specialization });
      notify('Doctor department updated.');
      refresh();
    } catch (error) {
      notify(error.message, 'error');
      refresh();
    }
  };
  const createBed = async (event) => {
    event.preventDefault();
    try {
      await api.post('/beds', bedForm);
      notify('Bed added.');
      setBedForm({ bedNumber: '', ward: wards[0] });
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const updateBillStatus = async (bill, status) => {
    try {
      await api.put(`/billing/${bill._id}`, { status });
      notify(`Bill ${bill.invoiceNumber} marked ${status.toLowerCase()}.`);
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const updateBed = async (bed, status, patientId) => {
    try {
      const nextStatus = status ?? (patientId ? 'Occupied' : 'Available');
      if (bed.patientId && ['Available', 'Maintenance'].includes(nextStatus)
        && !window.confirm(`Discharge ${bed.patientId.name} from bed ${bed.bedNumber}?`)) return;
      await api.put(`/beds/${bed._id}`, {
        status: nextStatus,
        patientId: nextStatus === 'Occupied' ? patientId ?? bed.patientId?._id : null,
      });
      notify('Bed assignment updated.');
      setAssignment((value) => {
        const next = { ...value };
        delete next[bed._id];
        return next;
      });
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const deleteBed = async (id) => {
    try {
      await api.delete(`/beds/${id}`);
      notify('Bed removed.');
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const deletePatient = async (patient) => {
    const confirmation = window.prompt(`To deactivate ${patient.name}'s account and retain their medical history, type their health ID: ${patient.uhid}`);
    if (confirmation === null) return;
    if (confirmation.trim() !== patient.uhid) {
      notify('The health ID did not match. The patient account was not changed.', 'error');
      return;
    }
    try {
      await api.delete(`/patients/${patient._id}`);
      notify('Patient account deactivated; medical history retained.');
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const resetPatientPassword = async (patient) => {
    const password = window.prompt(`Enter a new temporary password for ${patient.name} (8–72 characters).`);
    if (password === null) return;
    if (new TextEncoder().encode(password).length < 8 || new TextEncoder().encode(password).length > 72) {
      notify('Use a temporary password between 8 and 72 bytes.', 'error');
      return;
    }
    if (window.prompt('Confirm the temporary password by entering it again.') !== password) {
      notify('The passwords did not match. No reset was made.', 'error');
      return;
    }
    try {
      await api.post(`/patients/${patient._id}/reset-password`, { password });
      notify('Password reset. The patient must change it at next sign-in.');
      window.alert(`Share this temporary password securely with ${patient.name}: ${password}`);
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6">
      <PageTitle eyebrow="Administration" title="Hospital command center" description="Register patients and manage beds using live MongoDB records." icon={ShieldCheck} />
      {refreshing && <p role="status" className="text-xs text-slate-500">Refreshing…</p>}
      <LoadState loading={loading} error={error} onRetry={refresh} />
      <Field label="Search patients by name, UHID, or email"><Input value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setPatientPage(1); }} placeholder="Search patient directory and pickers" /></Field>
      <Field label="Search doctors, medical staff, receptionists, and patients"><Input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Search account lists by name, email, or phone" /></Field>
      <PaginationControls page={data.patients?.page || patientPage} total={data.patients?.total || 0} limit={50} onPageChange={setPatientPage} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card title="Registered patients" icon={Users}><p className="text-3xl font-bold">{patients.length}</p><p className="mt-1 text-xs text-slate-500">Active patient charts</p></Card>
        <Card title="Appointments" icon={CalendarDays}><p className="text-3xl font-bold">{appointments.length}</p><p className="mt-1 text-xs text-slate-500">Scheduled and historical visits</p></Card>
        <Card title="Care team" icon={Stethoscope}><p className="text-3xl font-bold">{staffMembers.length + (data.doctors?.doctors?.length || 0) + receptionists.length}</p><p className="mt-1 text-xs text-slate-500">{staffMembers.length} medical staff · {data.doctors?.doctors?.length || 0} doctors · {receptionists.length} receptionists</p></Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {wardTotals.map((item) => <Card key={item._id} title={item._id} icon={BedDouble}><div className="flex items-end justify-between"><p className="text-3xl font-bold">{item.occupied}<span className="text-base font-medium text-slate-400"> / {item.total}</span></p><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{item.available} available</span></div></Card>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <AdminAccountForm notify={notify} onCreated={refresh} />
        <PatientPasswordReset patients={patients} notify={notify} onReset={refresh} />
        <PreliminaryCheckForm patients={patients} notify={notify} onSaved={refresh} />
        <Card title={`Administrators · ${administrators.length}`} icon={ShieldCheck}>
          {administrators.length === 0 ? <Empty>No administrator accounts are registered.</Empty> : <div className="mb-4 space-y-2">{administrators.map((administrator) => <p key={administrator._id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60"><span className="font-semibold">{administrator.name}</span><span className="ml-2 text-slate-500">{administrator.email}</span></p>)}</div>}
        </Card>
        <Card title="Doctor departments" icon={Stethoscope}>
          {visibleDoctors.length === 0 ? <Empty>No doctor accounts match this search.</Empty> : <div className="space-y-3">{visibleDoctors.map((doctor) => <Field key={doctor._id} label={`${doctor.name} · ${doctor.email}`}><Select value={doctor.specialization} onChange={(event) => updateDoctorDepartment(doctor._id, event.target.value)}>{departments.map((department) => <option key={department}>{department}</option>)}</Select></Field>)}</div>}
        </Card>
        <Card title="Add a hospital bed" icon={BedDouble}>
          <form onSubmit={createBed} className="grid gap-3 sm:grid-cols-2">
            <Field label="Bed number"><Input value={bedForm.bedNumber} onChange={change(setBedForm, 'bedNumber')} placeholder="e.g. ICU-01" required /></Field>
            <Field label="Ward"><Select value={bedForm.ward} onChange={change(setBedForm, 'ward')}>{wards.map((item) => <option key={item}>{item}</option>)}</Select></Field>
            <button className="flex items-center justify-center gap-2 rounded-xl border border-teal-600 px-4 py-2.5 text-sm font-semibold text-teal-700 dark:text-teal-300 sm:col-span-2"><Plus className="h-4 w-4" />Add bed</button>
          </form>
        </Card>
      </div>
      <Card title="Bed management" icon={BedDouble}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : beds.length === 0 ? <Empty>No beds are registered yet.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th scope="col" className="pb-3">Bed</th><th scope="col" className="pb-3">Ward</th><th scope="col" className="pb-3">Patient</th><th scope="col" className="pb-3">Status</th><th scope="col" className="pb-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{beds.map((bed) => <tr key={bed._id}><td className="py-3 font-semibold">{bed.bedNumber}</td><td>{bed.ward}</td><td><Select aria-label={`Patient assigned to bed ${bed.bedNumber}`} value={assignment[bed._id] ?? bed.patientId?._id ?? ''} onChange={(event) => setAssignment((value) => ({ ...value, [bed._id]: event.target.value }))}><option value="">Unassigned</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></td><td><Select aria-label={`Status of bed ${bed.bedNumber}`} value={bed.status} onChange={(event) => updateBed(bed, event.target.value, assignment[bed._id] ?? bed.patientId?._id ?? null)}>{['Available', 'Occupied', 'Maintenance'].map((status) => <option key={status}>{status}</option>)}</Select></td><td><div className="flex items-center gap-2"><button type="button" onClick={() => updateBed(bed, null, assignment[bed._id] || null)} className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">Save assignment</button><button type="button" onClick={() => deleteBed(bed._id)} className="text-xs text-rose-600 hover:underline">Remove</button></div></td></tr>)}</tbody></table></div>}
      </Card>
      <Card title={`All bills · ${bills.length}`} icon={Receipt}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : bills.length === 0 ? <Empty>No bills have been issued.</Empty> : <div className="max-h-96 space-y-2 overflow-auto">{bills.map((bill) => <article key={bill._id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold">{bill.patientId?.name} · {bill.patientId?.uhid}</p><p className="font-bold text-teal-700 dark:text-teal-300">{formatCurrency(bill.totalPaise)}</p></div><p className="mt-1">{bill.invoiceNumber} · {bill.status}{bill.paymentMethod && ` · ${bill.paymentMethod}`}</p><p className="mt-1 text-xs text-slate-500">{bill.lineItems?.length ? bill.lineItems.map((item) => `${item.description}: ${formatCurrency(item.amountPaise)}`).join(' · ') : bill.description}</p>{bill.status === 'Unpaid' && <button type="button" onClick={() => updateBillStatus(bill, 'Void')} className="mt-2 text-xs font-semibold text-rose-700 underline dark:text-rose-300">Void bill (admin)</button>}</article>)}</div>}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Doctors · ${visibleDoctors.length}`} icon={Stethoscope}>
          {visibleDoctors.length === 0 ? <Empty>No doctors match this search.</Empty> : <div className="max-h-80 space-y-2 overflow-auto">{visibleDoctors.map((doctor) => <div key={doctor._id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><p className="font-medium">{doctor.name}</p><p className="text-xs text-slate-500">{doctor.email} · {doctor.specialization}</p></div>)}</div>}
        </Card>
        <Card title={`Medical staff · ${visibleStaff.length}`} icon={Stethoscope}>
          {visibleStaff.length === 0 ? <Empty>No medical staff match this search.</Empty> : <div className="max-h-80 space-y-2 overflow-auto">{visibleStaff.map((member) => <div key={member._id} className="flex justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><span className="font-medium">{member.name}<span className="ml-2 block text-xs font-normal text-slate-500">{member.email}</span></span><span className="text-xs text-slate-500">{member.phone || 'No phone'}</span></div>)}</div>}
        </Card>
        <Card title={`Receptionists · ${visibleReceptionists.length}`} icon={Users}>
          {visibleReceptionists.length === 0 ? <Empty>No receptionists match this search.</Empty> : <div className="max-h-80 space-y-2 overflow-auto">{visibleReceptionists.map((member) => <div key={member._id} className="flex justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><span className="font-medium">{member.name}<span className="ml-2 block text-xs font-normal text-slate-500">{member.email}</span></span><span className="text-xs text-slate-500">{member.phone || 'No phone'}</span></div>)}</div>}
        </Card>
        <Card title={`Patient directory · ${data.patients?.total ?? patients.length}`} icon={Users}>{loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : visiblePatients.length === 0 ? <Empty>No patients match this search.</Empty> : <div className="max-h-96 space-y-2 overflow-auto">{visiblePatients.map((patient) => <div key={patient._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><span className="font-medium">{patient.name}<span className="ml-2 text-xs font-normal text-slate-500">{patient.uhid}</span><span className="mt-1 block text-xs font-normal text-slate-500">{patient.email} · {calculateAge(patient.dateOfBirth) ?? 'Age not recorded'}{calculateAge(patient.dateOfBirth) !== null ? ' years' : ''} · {patient.bloodGroup || 'Blood group unknown'}</span><span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-300">Conditions: {patient.chronicConditions?.length ? patient.chronicConditions.join(', ') : 'None recorded'} · Allergies: {patient.allergies?.length ? patient.allergies.join(', ') : 'None recorded'}</span></span><div className="flex gap-3"><button onClick={() => setEditingPatient(patient)} className="text-xs font-semibold text-teal-700 underline dark:text-teal-300">Edit</button><button onClick={() => resetPatientPassword(patient)} className="text-xs font-semibold text-teal-700 underline dark:text-teal-300">Reset password</button><button onClick={() => deletePatient(patient)} className="text-xs text-rose-600 hover:underline">Deactivate</button></div></div>)}</div>}</Card>
        <Card title={`Appointment overview · ${appointments.length}`} icon={CalendarDays}>{appointments.length === 0 ? <Empty>No appointments are booked.</Empty> : <div className="max-h-80 space-y-2 overflow-auto">{appointments.map((item) => <div key={item._id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><p className="font-medium">{item.patientId?.name} · {item.department} · {item.status}</p><p className="mt-1 text-xs text-slate-500">{formatAppointmentDate(item.date)} · {formatAppointmentSlot(item.time)} · {item.triage}</p></div>)}</div>}</Card>
      </div>
      <Card title="Audit log" icon={ShieldCheck}>
        {loading || error ? <LoadState loading={loading} error={error} onRetry={refresh} /> : auditItems.length === 0 ? <Empty>No audited actions have been recorded.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th scope="col" className="pb-3">Time</th><th scope="col" className="pb-3">Actor</th><th scope="col" className="pb-3">Action</th><th scope="col" className="pb-3">Record</th><th scope="col" className="pb-3">Patient</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{auditItems.map((item) => <tr key={item._id}><td className="py-3">{new Date(item.at).toLocaleString()}</td><td>{item.actorId?.name || item.actorRole}</td><td>{item.action}</td><td>{item.entityType}</td><td>{item.patientId?.name || '—'}</td></tr>)}</tbody></table><p className="mt-3 text-xs text-slate-500">Showing the most recent {auditItems.length} of {data.audit.total} recorded actions.</p></div>}
      </Card>
      {editingPatient && <EditPatientDialog key={editingPatient._id} patient={editingPatient} notify={notify} onClose={() => setEditingPatient(null)} onSaved={refresh} />}
    </main>
  );
}

void AdminDashboard;

export default App;

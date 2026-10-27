import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BedDouble, CalendarDays, Check, ClipboardList, LogOut, Moon, Plus, Receipt, ShieldCheck,
  Stethoscope, Sun, Users, X,
} from 'lucide-react';
import api from './api.js';

const rolePaths = {
  patient: '/patient-portal',
  doctor: '/doctor-dashboard',
  staff: '/medical-staff',
  admin: '/admin-command-center',
};
const departments = ['Cardiology', 'Neurology', 'Orthopedics', 'General Medicine', 'Pediatrics', 'Emergency'];
const wards = ['ICU', 'Emergency', 'General Ward', 'Pediatrics'];
const triageLevels = ['Urgent', 'OPD Routine', 'Follow-up'];
const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const appointmentSlots = Array.from({ length: 24 }, (_, hour) => {
  const endHour = (hour + 1) % 24;
  const time = `${String(hour).padStart(2, '0')}:00`;
  const endTime = `${String(endHour).padStart(2, '0')}:00`;
  const startLabel = new Date(Date.UTC(2020, 0, 1, hour)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const endLabel = new Date(Date.UTC(2020, 0, 1, endHour)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return { time, label: `${startLabel} – ${endLabel} (${time}–${endTime})` };
});

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
  if (!dateOfBirth) return null;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  if (today < new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function parseList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function formatCurrency(paise) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR' }).format(paise / 100);
}

function newBillForm() {
  return { patientId: '', totalAmount: '500', description: 'Consultation fee' };
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
  const notify = useCallback((message, kind = 'success') => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 4200);
  }, []);
  return [toast, notify];
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div role={toast.kind === 'error' ? 'alert' : 'status'} className={`fixed right-5 top-20 z-50 flex max-w-sm items-start gap-3 rounded-xl border p-4 shadow-xl ${toast.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
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
    <section className={`rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 ${className}`}>
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

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(() => Boolean(localStorage.getItem('curasys_token')));
  const [toast, notify] = useToast();
  const [theme, toggleTheme] = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const token = localStorage.getItem('curasys_token');
    if (!token) return;
    api.get('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem('curasys_token');
        setUser(null);
      })
      .finally(() => setInitializing(false));
  }, []);

  const onAuth = (auth) => {
    localStorage.setItem('curasys_token', auth.token);
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
              <span className="hidden text-right sm:block"><span className="block text-sm font-medium">{user.name}</span><span className="block text-xs text-slate-500">{user.uhid}</span></span>
              <button onClick={toggleTheme} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700" aria-label="Toggle color theme">{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              <button onClick={logout} className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300" aria-label="Sign out"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></button>
            </div>
          </div>
        </header>
      )}
      <Toast toast={toast} onClose={() => notify('')} />
      <Routes>
        <Route path="/login" element={user ? <Navigate to={path} replace /> : <AuthPage onAuth={onAuth} notify={notify} />} />
        <Route path="/patient-portal" element={<Protected user={user} role="patient"><PatientDashboard user={user} notify={notify} /></Protected>} />
        <Route path="/doctor-dashboard" element={<Protected user={user} role="doctor"><DoctorDashboard user={user} notify={notify} /></Protected>} />
        <Route path="/medical-staff" element={<Protected user={user} role="staff"><StaffDashboard notify={notify} /></Protected>} />
        <Route path="/admin-command-center" element={<Protected user={user} role="admin"><AdminDashboard notify={notify} /></Protected>} />
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

function AuthPage({ onAuth, notify }) {
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('patient');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', specialization: '', adminRegistrationKey: '' });
  const change = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post(mode === 'login' ? '/auth/login' : '/auth/register', { ...form, role });
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
          <h1 className="text-2xl font-bold tracking-tight">Curasys Medical Center</h1>
          <p className="mt-1 text-sm text-slate-500">Hospital information system</p>
        </div>
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {['login', 'register'].map((item) => <button key={item} onClick={() => { setMode(item); if (item === 'register' && role === 'patient') setRole('doctor'); }} className={`rounded-lg py-2 text-sm font-semibold capitalize ${mode === item ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-700 dark:text-teal-300' : 'text-slate-500'}`}>{item}</button>)}
        </div>
        <form onSubmit={submit} className="grid gap-4">
          {isRegister && <Field label="Full name"><Input value={form.name} onChange={change('name')} autoComplete="name" required maxLength={100} /></Field>}
          <Field label="Email"><Input type="email" value={form.email} onChange={change('email')} autoComplete="email" required /></Field>
          <Field label="Password"><Input type="password" value={form.password} onChange={change('password')} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={8} required /></Field>
          {isRegister && <Field label="Phone (optional)"><Input value={form.phone} onChange={change('phone')} autoComplete="tel" /></Field>}
          <Field label="Account type"><Select value={role} onChange={(event) => setRole(event.target.value)}>{(isRegister ? ['doctor', 'admin'] : ['patient', 'doctor', 'staff', 'admin']).map((item) => <option key={item} value={item} className="capitalize">{item}</option>)}</Select></Field>
          {isRegister && role === 'doctor' && <Field label="Specialization"><Input value={form.specialization} onChange={change('specialization')} required /></Field>}
          {isRegister && role === 'admin' && <Field label="Admin registration key"><Input type="password" value={form.adminRegistrationKey} onChange={change('adminRegistrationKey')} required /></Field>}
          {isRegister && <p className="text-xs leading-relaxed text-slate-500">{role === 'admin' ? 'Administrator accounts require a private registration key configured by the project owner.' : 'Patient and medical staff accounts are created by an administrator.'}</p>}
          <button disabled={loading} className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 font-semibold text-white shadow-lg shadow-teal-600/20 hover:bg-teal-700 disabled:opacity-60">{loading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in securely'}</button>
        </form>
        <p className="mt-5 text-center text-xs text-slate-500">Use fictional information only. This school project is not for real patient data.</p>
      </section>
    </main>
  );
}

function useLoad(notify, requests) {
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const requestSignature = JSON.stringify(requests);
  useEffect(() => {
    let active = true;
    const requestList = JSON.parse(requestSignature);
    Promise.all(requestList.map((request) => api.get(request.path)))
      .then((responses) => {
        if (active) setData(Object.fromEntries(responses.map((response, index) => [requestList[index].key, response.data])));
      })
      .catch((error) => { if (active) notify(error.message, 'error'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, notify, requestSignature]);
  return { data, loading, refresh };
}

function PageTitle({ eyebrow, title, description, icon: Icon }) {
  return <div className="flex items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-teal-600/10 text-teal-700 dark:text-teal-300">{Icon && <Icon className="h-6 w-6" />}</span><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700 dark:text-teal-300">{eyebrow}</p><h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1><p className="mt-1 text-sm text-slate-500">{description}</p></div></div>;
}

function PatientDashboard({ user, notify }) {
  const { data, loading } = useLoad(notify, [
    { key: 'appointments', path: '/appointments' },
    { key: 'billing', path: '/billing' },
    { key: 'prescriptions', path: '/prescriptions' },
    { key: 'vitals', path: '/vitals' },
    { key: 'clinicalNotes', path: '/clinical-notes' },
  ]);
  const appointments = data.appointments?.appointments || [];
  const bills = data.billing?.bills || [];
  const totalBilledPaise = bills.reduce((total, bill) => total + bill.totalPaise, 0);
  const prescriptions = data.prescriptions?.prescriptions || [];
  const vitals = data.vitals?.vitals || [];
  const clinicalNotes = data.clinicalNotes?.clinicalNotes || [];
  const age = calculateAge(user.dateOfBirth);

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6">
      <PageTitle eyebrow="Patient portal · read-only" title={`Hello, ${user.name}`} description="Review records and treatment information entered by your care team." icon={Activity} />
      <Card title="Your profile" icon={ShieldCheck}>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[['Unique Health ID', user.uhid], ['Age', age === null ? 'Not recorded' : `${age} years`], ['Date of birth', user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString() : 'Not recorded'], ['Sex', user.sex || 'Not recorded'], ['Blood group', user.bloodGroup || 'Not recorded'], ['Height', user.heightCm ? `${user.heightCm} cm` : 'Not recorded'], ['Weight', user.weightKg ? `${user.weightKg} kg` : 'Not recorded'], ['Phone', user.phone || 'Not added'], ['Email', user.email], ['Address', user.address || 'Not recorded']].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
        </dl>
        <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-2">
          <div><p className="font-semibold">Allergies</p><p className="mt-1 text-slate-500">{user.allergies?.length ? user.allergies.join(', ') : 'None recorded'}</p></div>
          <div><p className="font-semibold">Ongoing conditions</p><p className="mt-1 text-slate-500">{user.chronicConditions?.length ? user.chronicConditions.join(', ') : 'None recorded'}</p></div>
          <div><p className="font-semibold">Current medications</p><p className="mt-1 text-slate-500">{user.currentMedications?.length ? user.currentMedications.join(', ') : 'None recorded'}</p></div>
          <div><p className="font-semibold">Emergency contact</p><p className="mt-1 text-slate-500">{user.emergencyContact?.name ? `${user.emergencyContact.name} · ${user.emergencyContact.relationship || 'Contact'} · ${user.emergencyContact.phone || 'No phone'}` : 'Not recorded'}</p></div>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Your appointments" icon={CalendarDays}>
          {loading ? <p className="text-sm text-slate-500">Loading records…</p> : appointments.length === 0 ? <Empty /> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{appointments.map((item) => <div key={item._id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"><div><p className="font-medium">{item.department} <span className="ml-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">{item.status}</span></p><p className="mt-1 text-xs text-slate-500">{formatAppointmentDate(item.date)} · {formatAppointmentSlot(item.time)} · {item.triage}</p><p className="mt-1 text-xs text-slate-500">Doctor: {item.doctorId?.name || 'To be assigned'}</p><p className="mt-1 text-xs text-slate-500">Symptoms: {item.symptoms}</p></div></div>)}</div>}
        </Card>
        <Card title="Prescriptions" icon={ClipboardList}>
          {prescriptions.length === 0 ? <Empty>No prescriptions have been added to your records.</Empty> : <div className="space-y-3">{prescriptions.map((item) => <article key={item._id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><p className="font-semibold">{item.diagnosis}</p><p className="mt-1 text-xs text-slate-500">Prescribed by {item.doctorId?.name || 'Doctor'} · {new Date(item.createdAt).toLocaleDateString()}</p><ul className="mt-3 space-y-2 text-sm">{item.medicines.map((medicine) => <li key={`${medicine.name}-${medicine.dosage}`}><span className="font-medium">{medicine.name}</span> · {medicine.dosage} · {medicine.frequency} · {medicine.duration}{medicine.route && ` · ${medicine.route}`}{medicine.instructions && <span className="block text-xs text-slate-500">{medicine.instructions}</span>}</li>)}</ul>{item.instructions && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Instructions: {item.instructions}</p>}{item.followUp && <p className="mt-2 text-xs font-medium text-teal-700 dark:text-teal-300">Follow-up: {item.followUp}</p>}</article>)}</div>}
        </Card>
        <Card title="Vital history" icon={Activity}>
          {vitals.length === 0 ? <Empty>No measurements have been logged.</Empty> : <div className="space-y-2">{vitals.map((item) => <div key={item._id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><p className="font-medium">{new Date(item.createdAt).toLocaleString()}</p><p className="mt-1 text-xs text-slate-500">{[['HR', item.heartRate && `${item.heartRate} bpm`], ['BP', item.systolic && item.diastolic ? `${item.systolic}/${item.diastolic} mmHg` : null], ['RR', item.respiratoryRate && `${item.respiratoryRate}/min`], ['Temp', item.temperatureC && `${item.temperatureC} °C`], ['Glucose', item.bloodGlucose && `${item.bloodGlucose} mg/dL`], ['O₂', item.oxygenSaturation && `${item.oxygenSaturation}%`], ['Height', item.heightCm && `${item.heightCm} cm`], ['Weight', item.weightKg && `${item.weightKg} kg`]].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(' · ')}</p>{item.notes && <p className="mt-1 text-xs">{item.notes}</p>}</div>)}</div>}
        </Card>
      </div>
      <Card title="Your bills" icon={Receipt}>
        {loading ? <p className="text-sm text-slate-500">Loading bills…</p> : <div className="space-y-3"><div className="flex items-center justify-between rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><span className="font-medium">Total billed</span><span className="text-lg font-bold text-teal-700 dark:text-teal-300">{formatCurrency(totalBilledPaise)}</span></div>{bills.length === 0 ? <Empty>No bills have been issued.</Empty> : bills.map((bill) => <article key={bill._id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-100 p-4 dark:border-slate-800"><div><p className="font-semibold">{bill.description}</p><p className="mt-1 text-xs text-slate-500">Issued by {bill.createdBy?.name || 'Hospital administration'} · {new Date(bill.createdAt).toLocaleDateString()}</p></div><p className="text-lg font-bold">{formatCurrency(bill.totalPaise)}</p></article>)}</div>}
      </Card>
      <Card title="Doctor visit notes" icon={ClipboardList}>
        {clinicalNotes.length === 0 ? <Empty>No visit notes have been added to your chart.</Empty> : <div className="grid gap-3 md:grid-cols-2">{clinicalNotes.map((note) => <article key={note._id} className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/60"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{note.assessment}</p><time className="text-xs text-slate-500">{new Date(note.createdAt).toLocaleDateString()}</time></div><p className="mt-2 text-sm"><span className="font-medium">Complaint:</span> {note.chiefComplaint}</p>{note.historyOfPresentIllness && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300"><span className="font-medium">History:</span> {note.historyOfPresentIllness}</p>}{note.examination && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300"><span className="font-medium">Examination:</span> {note.examination}</p>}<p className="mt-2 text-sm text-slate-600 dark:text-slate-300"><span className="font-medium">Care plan:</span> {note.plan}</p>{note.followUp && <p className="mt-2 text-xs text-teal-700 dark:text-teal-300"><span className="font-semibold">Follow-up:</span> {note.followUp}</p>}<p className="mt-3 text-xs text-slate-500">Dr. {note.doctorId?.name || 'Care team'}</p></article>)}</div>}
      </Card>
      <p className="text-center text-xs text-slate-500">Your medical records are read-only. Contact your care team if something needs correction.</p>
    </main>
  );
}

function DoctorDashboard({ user, notify }) {
  const { data, loading, refresh } = useLoad(notify, [
    { key: 'appointments', path: '/appointments' },
    { key: 'patients', path: '/patients' },
    { key: 'prescriptions', path: '/prescriptions' },
    { key: 'vitals', path: '/vitals' },
    { key: 'clinicalNotes', path: '/clinical-notes' },
  ]);
  const appointments = data.appointments?.appointments || [];
  const patients = data.patients?.patients || [];
  const prescriptions = data.prescriptions?.prescriptions || [];
  const vitals = data.vitals?.vitals || [];
  const clinicalNotes = data.clinicalNotes?.clinicalNotes || [];
  const emptyPrescription = { patientId: '', diagnosis: '', instructions: '', followUp: '', medicines: [{ name: '', dosage: '', frequency: '', duration: '', route: '', instructions: '' }] };
  const emptyVital = { patientId: '', heartRate: '', systolic: '', diastolic: '', respiratoryRate: '', temperatureC: '', bloodGlucose: '', oxygenSaturation: '', heightCm: '', weightKg: '', notes: '' };
  const emptyClinicalNote = { patientId: '', chiefComplaint: '', historyOfPresentIllness: '', examination: '', assessment: '', plan: '', followUp: '' };
  const [prescription, setPrescription] = useState(emptyPrescription);
  const [vital, setVital] = useState(emptyVital);
  const [clinicalNote, setClinicalNote] = useState(emptyClinicalNote);
  const [filter, setFilter] = useState('Scheduled');
  const [profilePatientId, setProfilePatientId] = useState('');
  const profilePatient = patients.find((item) => item._id === profilePatientId);

  const change = (setter, key) => (event) => setter((value) => ({ ...value, [key]: event.target.value }));
  const savePrescription = async (event) => {
    event.preventDefault();
    try {
      await api.post('/prescriptions', {
        patientId: prescription.patientId,
        diagnosis: prescription.diagnosis,
        medicines: prescription.medicines,
        instructions: prescription.instructions,
        followUp: prescription.followUp,
      });
      notify('Prescription saved to the patient record.');
      setPrescription(emptyPrescription);
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const saveVital = async (event) => {
    event.preventDefault();
    try {
      await api.post('/vitals', vital);
      notify('Vital record saved.');
      setVital(emptyVital);
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
      <Card title="OPD appointment queue" icon={CalendarDays} action={<Select className="w-auto" value={filter} onChange={(event) => setFilter(event.target.value)}>{['Scheduled', 'Completed', 'Cancelled', 'All'].map((item) => <option key={item}>{item}</option>)}</Select>}>
        {loading ? <p className="text-sm text-slate-500">Loading appointments…</p> : visibleAppointments.length === 0 ? <Empty>No appointments match this status.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Patient</th><th className="pb-3">Visit</th><th className="pb-3">Symptoms</th><th className="pb-3">Triage</th><th className="pb-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{visibleAppointments.map((item) => <tr key={item._id}><td className="py-3"><p className="font-medium">{item.patientId?.name}</p><p className="text-xs text-slate-500">{item.patientId?.uhid}</p></td><td>{item.department}<p className="text-xs text-slate-500">{formatAppointmentDate(item.date)} · {formatAppointmentSlot(item.time)}</p></td><td className="max-w-48 truncate">{item.symptoms}</td><td><Select className="w-auto" value={item.triage} onChange={(event) => updateAppointment(item._id, { triage: event.target.value })}>{triageLevels.map((value) => <option key={value}>{value}</option>)}</Select></td><td><Select className="w-auto" value={item.status} onChange={(event) => updateAppointment(item._id, { status: event.target.value })}>{['Scheduled', 'Completed', 'Cancelled'].map((value) => <option key={value}>{value}</option>)}</Select></td></tr>)}</tbody></table></div>}
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
            <Field label="Patient"><Select required value={prescription.patientId} onChange={change(setPrescription, 'patientId')}><option value="">Select a patient</option>{patients.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.uhid}</option>)}</Select></Field>
            <Field label="Diagnosis"><Input required value={prescription.diagnosis} onChange={change(setPrescription, 'diagnosis')} /></Field>
            {prescription.medicines.map((medicine, index) => <div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:col-span-2 sm:grid-cols-2">
              <Field label="Medicine"><Input required maxLength="100" value={medicine.name} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} /></Field>
              <Field label="Dosage"><Input required maxLength="100" value={medicine.dosage} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, dosage: event.target.value } : item) }))} placeholder="e.g. 10 mg" /></Field>
              <Field label="Frequency"><Input required maxLength="100" value={medicine.frequency} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, frequency: event.target.value } : item) }))} placeholder="e.g. Twice daily" /></Field>
              <Field label="Duration"><Input required maxLength="100" value={medicine.duration} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, duration: event.target.value } : item) }))} placeholder="e.g. 7 days" /></Field>
              <Field label="Route"><Input maxLength="50" value={medicine.route} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, route: event.target.value } : item) }))} placeholder="e.g. Oral" /></Field>
              <Field label="Medicine instructions"><Input maxLength="500" value={medicine.instructions} onChange={(event) => setPrescription((value) => ({ ...value, medicines: value.medicines.map((item, itemIndex) => itemIndex === index ? { ...item, instructions: event.target.value } : item) }))} placeholder="e.g. Take with food" /></Field>
              {prescription.medicines.length > 1 && <button type="button" onClick={() => setPrescription((value) => ({ ...value, medicines: value.medicines.filter((_, itemIndex) => itemIndex !== index) }))} className="justify-self-start text-xs text-rose-600 hover:underline sm:col-span-2">Remove medicine</button>}
            </div>)}
            <button type="button" disabled={prescription.medicines.length >= 30} onClick={() => setPrescription((value) => ({ ...value, medicines: [...value.medicines, { name: '', dosage: '', frequency: '', duration: '', route: '', instructions: '' }] }))} className="text-left text-sm font-medium text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300 sm:col-span-2">+ Add another medicine</button>
            <Field label="Prescription instructions"><Textarea rows="2" maxLength="2000" value={prescription.instructions} onChange={change(setPrescription, 'instructions')} placeholder="Additional guidance for the patient" /></Field>
            <Field label="Prescription follow-up"><Input maxLength="500" value={prescription.followUp} onChange={change(setPrescription, 'followUp')} placeholder="e.g. Review in 2 weeks" /></Field>
            <button className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 sm:col-span-2">Save prescription</button>
          </form>
        </Card>
        <Card title="Record patient vitals" icon={Activity}>
          <form onSubmit={saveVital} className="grid gap-3 sm:grid-cols-2">
            <Field label="Patient"><Select required value={vital.patientId} onChange={change(setVital, 'patientId')}><option value="">Select a patient</option>{patients.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.uhid}</option>)}</Select></Field>
            {[['heartRate', 'Heart rate (bpm)', '20', '300', '1'], ['systolic', 'Systolic BP (mmHg)', '40', '300', '1'], ['diastolic', 'Diastolic BP (mmHg)', '20', '200', '1'], ['respiratoryRate', 'Respiratory rate (/min)', '1', '100', '1'], ['temperatureC', 'Temperature (°C)', '25', '45', '0.1'], ['bloodGlucose', 'Blood glucose (mg/dL)', '1', '2000', '1'], ['oxygenSaturation', 'Oxygen saturation (%)', '1', '100', '1'], ['heightCm', 'Height (cm)', '30', '250', '0.1'], ['weightKg', 'Weight (kg)', '1', '500', '0.1']].map(([key, label, min, max, step]) => <Field key={key} label={label}><Input type="number" min={min} max={max} step={step} value={vital[key]} onChange={change(setVital, key)} /></Field>)}
            <Field label="Clinical notes"><Textarea rows="2" maxLength="1000" value={vital.notes} onChange={change(setVital, 'notes')} /></Field>
            <button className="rounded-xl border border-teal-600 px-4 py-2.5 text-sm font-semibold text-teal-700 dark:text-teal-300 sm:col-span-2">Save vital record</button>
          </form>
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
        {clinicalNotes.length === 0 ? <Empty>No clinical visit notes have been added.</Empty> : <div className="grid gap-3 md:grid-cols-2">{clinicalNotes.map((note) => <article key={note._id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><div className="flex justify-between gap-2"><p className="font-semibold">{note.patientId?.name} · {note.patientId?.uhid}</p><time className="text-xs text-slate-500">{new Date(note.createdAt).toLocaleDateString()}</time></div><p className="mt-2 text-sm"><span className="font-medium">Complaint:</span> {note.chiefComplaint}</p><p className="mt-1 text-sm"><span className="font-medium">Assessment:</span> {note.assessment}</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{note.plan}</p></article>)}</div>}
      </Card>
      <Card title="Prescriptions authored" icon={ClipboardList}>
        {prescriptions.length === 0 ? <Empty>No prescriptions have been written yet.</Empty> : <div className="grid gap-3 md:grid-cols-2">{prescriptions.map((item) => <div key={item._id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><p className="font-medium">{item.patientId?.name} · {item.diagnosis}</p><p className="mt-1 text-xs text-slate-500">{item.medicines.map((medicine) => `${medicine.name} ${medicine.dosage} · ${medicine.frequency} · ${medicine.duration}`).join(', ')}</p>{item.instructions && <p className="mt-2 text-sm">{item.instructions}</p>}{item.followUp && <p className="mt-1 text-xs text-teal-700 dark:text-teal-300">Follow-up: {item.followUp}</p>}</div>)}</div>}
      </Card>
      <Card title="Patient clinical records" icon={Activity}>
        {vitals.length === 0 ? <Empty>No clinical measurements have been entered.</Empty> : <div className="grid gap-3 md:grid-cols-2">{vitals.map((item) => <div key={item._id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><p className="font-medium">{item.patientId?.name} · {new Date(item.createdAt).toLocaleString()}</p><p className="mt-1 text-xs text-slate-500">{[['HR', item.heartRate && `${item.heartRate} bpm`], ['BP', item.systolic && item.diastolic ? `${item.systolic}/${item.diastolic} mmHg` : null], ['RR', item.respiratoryRate && `${item.respiratoryRate}/min`], ['Temp', item.temperatureC && `${item.temperatureC} °C`], ['Glucose', item.bloodGlucose && `${item.bloodGlucose} mg/dL`], ['O₂', item.oxygenSaturation && `${item.oxygenSaturation}%`], ['Height', item.heightCm && `${item.heightCm} cm`], ['Weight', item.weightKg && `${item.weightKg} kg`]].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(' · ')}</p>{item.notes && <p className="mt-1 text-sm">{item.notes}</p>}</div>)}</div>}
      </Card>
    </main>
  );
}

function StaffDashboard({ notify }) {
  const { data, loading, refresh } = useLoad(notify, [
    { key: 'appointments', path: '/appointments' },
    { key: 'patients', path: '/patients' },
    { key: 'doctors', path: '/doctors' },
    { key: 'beds', path: '/beds' },
  ]);
  const appointments = data.appointments?.appointments || [];
  const patients = data.patients?.patients || [];
  const doctors = data.doctors?.doctors || [];
  const beds = data.beds?.beds || [];
  const [appointmentForm, setAppointmentForm] = useState({
    patientId: '', doctorId: '', department: departments[0], date: '', time: '', symptoms: '', triage: 'OPD Routine',
  });
  const [assignment, setAssignment] = useState({});
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
  const updateBed = async (bed, status, patientId) => {
    try {
      const nextStatus = status ?? (patientId ? 'Occupied' : 'Available');
      await api.put(`/beds/${bed._id}`, {
        status: nextStatus,
        patientId: patientId ?? (nextStatus === 'Occupied' ? bed.patientId?._id : null),
      });
      notify('Bed assignment updated.');
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6">
      <PageTitle eyebrow="Medical staff workspace" title="Patient care coordination" description="Coordinate appointments and manage bed assignments. Patient and clinical records are entered by administrators and doctors." icon={Stethoscope} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Book an appointment" icon={CalendarDays}>
          <form onSubmit={bookAppointment} className="grid gap-3 sm:grid-cols-2">
            <Field label="Patient"><Select required value={appointmentForm.patientId} onChange={change(setAppointmentForm, 'patientId')}><option value="">Select patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></Field>
            <Field label="Department"><Select value={appointmentForm.department} onChange={change(setAppointmentForm, 'department')}>{departments.map((department) => <option key={department}>{department}</option>)}</Select></Field>
            <Field label="Doctor"><Select value={appointmentForm.doctorId} onChange={change(setAppointmentForm, 'doctorId')}><option value="">Assign later</option>{doctors.map((doctor) => <option key={doctor._id} value={doctor._id}>{doctor.name} · {doctor.specialization}</option>)}</Select></Field>
            <Field label="Triage"><Select value={appointmentForm.triage} onChange={change(setAppointmentForm, 'triage')}>{triageLevels.map((item) => <option key={item}>{item}</option>)}</Select></Field>
            <Field label="Appointment date"><Input type="date" min={localDateValue()} value={appointmentForm.date} onChange={change(setAppointmentForm, 'date')} required /><span className="text-xs font-normal text-slate-500">Appointments are available every day, including weekends and holidays.</span></Field>
            <Field label="One-hour appointment slot (24/7)"><Select value={appointmentForm.time} onChange={change(setAppointmentForm, 'time')} required><option value="">Select an available time</option>{appointmentSlots.map((slot) => {
              const isBooked = Boolean(appointmentForm.doctorId && appointmentForm.date && appointments.some((appointment) => (
                appointment.doctorId?._id === appointmentForm.doctorId
                && appointment.date.slice(0, 10) === appointmentForm.date
                && appointment.time === slot.time
                && appointment.status === 'Scheduled'
              )));
              return <option key={slot.time} value={slot.time} disabled={isBooked}>{isBooked ? `${slot.label} · booked` : slot.label}</option>;
            })}</Select><span className="text-xs font-normal text-slate-500">{appointmentForm.doctorId && appointmentForm.date ? 'Booked slots for this doctor and date are disabled.' : 'Select a doctor and date to check for existing bookings.'}</span></Field>
            <Field label="Symptoms"><Textarea rows="2" maxLength="2000" value={appointmentForm.symptoms} onChange={change(setAppointmentForm, 'symptoms')} required /></Field>
            <div className="self-end"><button className="w-full rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700">Book visit</button><p className="mt-1 text-center text-xs text-slate-500">Hospital appointment desk: open 24 hours</p></div>
          </form>
        </Card>
      </div>
      <Card title={`OPD coordination queue · ${appointments.length}`} icon={CalendarDays}>
        {loading ? <p className="text-sm text-slate-500">Loading appointments…</p> : appointments.length === 0 ? <Empty>No appointments have been booked.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Patient</th><th className="pb-3">Visit</th><th className="pb-3">Doctor</th><th className="pb-3">Triage</th><th className="pb-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{appointments.map((item) => <tr key={item._id}><td className="py-3"><p className="font-medium">{item.patientId?.name}</p><p className="text-xs text-slate-500">{item.patientId?.uhid}</p></td><td>{item.department}<p className="text-xs text-slate-500">{formatAppointmentDate(item.date)} · {formatAppointmentSlot(item.time)}</p><p className="max-w-56 truncate text-xs text-slate-500">{item.symptoms}</p></td><td><Select className="w-auto" value={item.doctorId?._id || ''} onChange={(event) => updateAppointment(item._id, { doctorId: event.target.value })}><option value="">Unassigned</option>{doctors.map((doctor) => <option key={doctor._id} value={doctor._id}>{doctor.name}</option>)}</Select></td><td><Select className="w-auto" value={item.triage} onChange={(event) => updateAppointment(item._id, { triage: event.target.value })}>{triageLevels.map((value) => <option key={value}>{value}</option>)}</Select></td><td><Select className="w-auto" value={item.status} onChange={(event) => updateAppointment(item._id, { status: event.target.value })}>{['Scheduled', 'Completed', 'Cancelled'].map((value) => <option key={value}>{value}</option>)}</Select></td></tr>)}</tbody></table></div>}
      </Card>
      <Card title={`Bed assignments · ${beds.length}`} icon={BedDouble}>
        {beds.length === 0 ? <Empty>No beds are configured yet.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Bed</th><th className="pb-3">Ward</th><th className="pb-3">Patient</th><th className="pb-3">Status</th><th className="pb-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{beds.map((bed) => <tr key={bed._id}><td className="py-3 font-semibold">{bed.bedNumber}</td><td>{bed.ward}</td><td><Select value={assignment[bed._id] ?? bed.patientId?._id ?? ''} onChange={(event) => setAssignment((value) => ({ ...value, [bed._id]: event.target.value }))}><option value="">Unassigned</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></td><td><Select value={bed.status} onChange={(event) => updateBed(bed, event.target.value, assignment[bed._id] ?? bed.patientId?._id ?? null)}>{['Available', 'Occupied', 'Maintenance'].map((status) => <option key={status}>{status}</option>)}</Select></td><td><button onClick={() => updateBed(bed, null, assignment[bed._id] || null)} className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">Save assignment</button></td></tr>)}</tbody></table></div>}
      </Card>
    </main>
  );
}

function AdminDashboard({ notify }) {
  const { data, loading, refresh } = useLoad(notify, [
    { key: 'patients', path: '/patients' },
    { key: 'beds', path: '/beds' },
    { key: 'billing', path: '/billing' },
    { key: 'appointments', path: '/appointments' },
    { key: 'staff', path: '/staff' },
    { key: 'doctors', path: '/doctors' },
  ]);
  const patients = data.patients?.patients || [];
  const beds = data.beds?.beds || [];
  const totals = data.beds?.totals || [];
  const appointments = data.appointments?.appointments || [];
  const bills = data.billing?.bills || [];
  const wardTotals = wards.map((ward) => totals.find((item) => item._id === ward) || {
    _id: ward,
    total: 0,
    occupied: 0,
    available: 0,
  });
  const staffMembers = data.staff?.staff || [];
  const emptyPatientForm = {
    name: '', email: '', password: '', phone: '', dateOfBirth: '', sex: '', bloodGroup: '', address: '',
    emergencyContact: { name: '', relationship: '', phone: '' }, allergies: '', chronicConditions: '',
    currentMedications: '', heightCm: '', weightKg: '',
  };
  const [patientForm, setPatientForm] = useState(emptyPatientForm);
  const [staffForm, setStaffForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [bedForm, setBedForm] = useState({ bedNumber: '', ward: wards[0] });
  const [billForm, setBillForm] = useState(newBillForm);
  const [assignment, setAssignment] = useState({});

  const change = (setter, key) => (event) => setter((value) => ({ ...value, [key]: event.target.value }));
  const changeEmergencyContact = (key) => (event) => setPatientForm((value) => ({
    ...value,
    emergencyContact: { ...value.emergencyContact, [key]: event.target.value },
  }));
  const registerPatient = async (event) => {
    event.preventDefault();
    try {
      const { data: result } = await api.post('/patients', {
        ...patientForm,
        allergies: parseList(patientForm.allergies),
        chronicConditions: parseList(patientForm.chronicConditions),
        currentMedications: parseList(patientForm.currentMedications),
      });
      notify(`Patient registered with health ID ${result.patient.uhid}.`);
      setPatientForm(emptyPatientForm);
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const createStaffAccount = async (event) => {
    event.preventDefault();
    try {
      const { data: result } = await api.post('/staff', staffForm);
      notify(`Medical staff account created for ${result.staff.name}.`);
      setStaffForm({ name: '', email: '', password: '', phone: '' });
      refresh();
    } catch (error) { notify(error.message, 'error'); }
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
  const issueBill = async (event) => {
    event.preventDefault();
    try {
      await api.post('/billing', {
        ...billForm,
        totalAmount: Number(billForm.totalAmount),
      });
      notify('Bill issued and added to the patient portal.');
      setBillForm(newBillForm());
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };
  const updateBed = async (bed, status, patientId) => {
    try {
      const nextStatus = status ?? (patientId ? 'Occupied' : 'Available');
      await api.put(`/beds/${bed._id}`, { status: nextStatus, patientId: patientId ?? (nextStatus === 'Occupied' ? bed.patientId?._id : null) });
      notify('Bed assignment updated.');
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
    if (!window.confirm(`Delete ${patient.name} and their appointments, bills, clinical notes, prescriptions, vitals, and bed assignment?`)) return;
    try {
      await api.delete(`/patients/${patient._id}`);
      notify('Patient and related records deleted.');
      refresh();
    } catch (error) { notify(error.message, 'error'); }
  };

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6">
      <PageTitle eyebrow="Administration" title="Hospital command center" description="Register patients and manage beds using live MongoDB records." icon={ShieldCheck} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card title="Registered patients" icon={Users}><p className="text-3xl font-bold">{patients.length}</p><p className="mt-1 text-xs text-slate-500">Active patient charts</p></Card>
        <Card title="Appointments" icon={CalendarDays}><p className="text-3xl font-bold">{appointments.length}</p><p className="mt-1 text-xs text-slate-500">Scheduled and historical visits</p></Card>
        <Card title="Care team" icon={Stethoscope}><p className="text-3xl font-bold">{staffMembers.length + (data.doctors?.doctors?.length || 0)}</p><p className="mt-1 text-xs text-slate-500">{staffMembers.length} medical staff · {data.doctors?.doctors?.length || 0} doctors</p></Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {wardTotals.map((item) => <Card key={item._id} title={item._id} icon={BedDouble}><div className="flex items-end justify-between"><p className="text-3xl font-bold">{item.occupied}<span className="text-base font-medium text-slate-400"> / {item.total}</span></p><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{item.available} available</span></div></Card>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Register a patient" icon={Users}>
          <form onSubmit={registerPatient} className="grid gap-3 sm:grid-cols-2">
            <p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 sm:col-span-2">Patient identity & contact</p>
            <Field label="Full legal name"><Input autoComplete="name" maxLength="100" value={patientForm.name} onChange={change(setPatientForm, 'name')} required /></Field>
            <Field label="Email / patient login"><Input type="email" autoComplete="email" value={patientForm.email} onChange={change(setPatientForm, 'email')} required /></Field>
            <Field label="Temporary password"><Input type="password" minLength="8" autoComplete="new-password" value={patientForm.password} onChange={change(setPatientForm, 'password')} required /><span className="text-xs font-normal text-slate-500">Share securely; the patient can sign in with this account.</span></Field>
            <Field label="Phone"><Input type="tel" autoComplete="tel" maxLength="30" value={patientForm.phone} onChange={change(setPatientForm, 'phone')} required /></Field>
            <Field label="Date of birth"><Input type="date" max={new Date().toISOString().slice(0, 10)} value={patientForm.dateOfBirth} onChange={change(setPatientForm, 'dateOfBirth')} required />{calculateAge(patientForm.dateOfBirth) !== null && <span className="text-xs font-normal text-slate-500">Age: {calculateAge(patientForm.dateOfBirth)} years (calculated)</span>}</Field>
            <Field label="Sex (optional)"><Select value={patientForm.sex} onChange={change(setPatientForm, 'sex')}><option value="">Not specified</option>{['Female', 'Male', 'Intersex', 'Prefer not to say'].map((value) => <option key={value}>{value}</option>)}</Select></Field>
            <Field label="Blood group (if known)"><Select value={patientForm.bloodGroup} onChange={change(setPatientForm, 'bloodGroup')}><option value="">Not known</option>{bloodGroups.map((value) => <option key={value}>{value}</option>)}</Select></Field>
            <Field label="Home address"><Textarea rows="2" maxLength="500" autoComplete="street-address" value={patientForm.address} onChange={change(setPatientForm, 'address')} /></Field>
            <p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 sm:col-span-2">Emergency contact</p>
            <Field label="Contact name"><Input maxLength="100" value={patientForm.emergencyContact.name} onChange={changeEmergencyContact('name')} /></Field>
            <Field label="Relationship"><Input maxLength="50" value={patientForm.emergencyContact.relationship} onChange={changeEmergencyContact('relationship')} placeholder="e.g. Parent, spouse" /></Field>
            <Field label="Contact phone"><Input type="tel" maxLength="30" value={patientForm.emergencyContact.phone} onChange={changeEmergencyContact('phone')} /></Field>
            <p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300 sm:col-span-2">Medical history & baseline measurements</p>
            <Field label="Known allergies"><Input value={patientForm.allergies} onChange={change(setPatientForm, 'allergies')} placeholder="Separate multiple entries with commas" /><span className="text-xs font-normal text-slate-500">Enter “None known” only after confirming with the patient.</span></Field>
            <Field label="Ongoing conditions"><Input value={patientForm.chronicConditions} onChange={change(setPatientForm, 'chronicConditions')} placeholder="e.g. Diabetes, asthma" /></Field>
            <Field label="Current medications"><Input value={patientForm.currentMedications} onChange={change(setPatientForm, 'currentMedications')} placeholder="Separate multiple entries with commas" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Height (cm)"><Input type="number" min="30" max="250" step="0.1" value={patientForm.heightCm} onChange={change(setPatientForm, 'heightCm')} /></Field>
              <Field label="Weight (kg)"><Input type="number" min="1" max="500" step="0.1" value={patientForm.weightKg} onChange={change(setPatientForm, 'weightKg')} /></Field>
            </div>
            <button className="flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 sm:col-span-2"><Plus className="h-4 w-4" />Create patient chart & login</button>
          </form>
        </Card>
        <Card title="Create medical staff account" icon={Stethoscope}>
          <form onSubmit={createStaffAccount} className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><Input value={staffForm.name} onChange={change(setStaffForm, 'name')} required /></Field>
            <Field label="Email"><Input type="email" value={staffForm.email} onChange={change(setStaffForm, 'email')} required /></Field>
            <Field label="Temporary password"><Input type="password" minLength="8" value={staffForm.password} onChange={change(setStaffForm, 'password')} required /></Field>
            <Field label="Phone"><Input value={staffForm.phone} onChange={change(setStaffForm, 'phone')} /></Field>
            <button className="flex items-center justify-center gap-2 rounded-xl border border-teal-600 px-4 py-2.5 text-sm font-semibold text-teal-700 dark:text-teal-300 sm:col-span-2"><Plus className="h-4 w-4" />Create staff login</button>
          </form>
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
        {loading ? <p className="text-sm text-slate-500">Loading beds…</p> : beds.length === 0 ? <Empty>No beds are registered yet.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Bed</th><th className="pb-3">Ward</th><th className="pb-3">Patient</th><th className="pb-3">Status</th><th className="pb-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{beds.map((bed) => <tr key={bed._id}><td className="py-3 font-semibold">{bed.bedNumber}</td><td>{bed.ward}</td><td><Select value={assignment[bed._id] ?? bed.patientId?._id ?? ''} onChange={(event) => setAssignment((value) => ({ ...value, [bed._id]: event.target.value }))}><option value="">Unassigned</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></td><td><Select value={bed.status} onChange={(event) => updateBed(bed, event.target.value, assignment[bed._id] ?? bed.patientId?._id ?? null)}>{['Available', 'Occupied', 'Maintenance'].map((status) => <option key={status}>{status}</option>)}</Select></td><td><div className="flex items-center gap-2"><button onClick={() => updateBed(bed, null, assignment[bed._id] || null)} className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">Save assignment</button><button onClick={() => deleteBed(bed._id)} className="text-xs text-rose-600 hover:underline">Remove</button></div></td></tr>)}</tbody></table></div>}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Issue a patient bill" icon={Receipt}>
          <form onSubmit={issueBill} className="grid gap-3">
            <Field label="Patient"><Select required value={billForm.patientId} onChange={change(setBillForm, 'patientId')}><option value="">Select a patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.uhid}</option>)}</Select></Field>
            <Field label="Total amount (INR)"><Input type="number" min="0.01" max="100000000" step="0.01" required value={billForm.totalAmount} onChange={change(setBillForm, 'totalAmount')} /></Field>
            <Field label="Bill description"><Textarea rows="2" maxLength="1000" required value={billForm.description} onChange={change(setBillForm, 'description')} /></Field>
            <button className="flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700"><Receipt className="h-4 w-4" />Issue bill</button>
            <p className="text-xs text-slate-500">The standard consultation fee is ₹500 and can be changed before issuing. This default is only a form value; no bill is saved until you issue it. Patients can view issued bills in their read-only portal.</p>
          </form>
        </Card>
        <Card title={`Issued bills · ${bills.length}`} icon={Receipt}>
          {loading ? <p className="text-sm text-slate-500">Loading bills…</p> : bills.length === 0 ? <Empty>No bills have been issued.</Empty> : <div className="max-h-96 space-y-2 overflow-auto">{bills.map((bill) => <article key={bill._id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold">{bill.patientId?.name} · {bill.patientId?.uhid}</p><p className="font-bold text-teal-700 dark:text-teal-300">{formatCurrency(bill.totalPaise)}</p></div><p className="mt-1">{bill.description}</p><p className="mt-1 text-xs text-slate-500">Issued {new Date(bill.createdAt).toLocaleString()}</p></article>)}</div>}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Medical staff · ${staffMembers.length}`} icon={Stethoscope}>
          {staffMembers.length === 0 ? <Empty>No staff accounts have been created.</Empty> : <div className="max-h-80 space-y-2 overflow-auto">{staffMembers.map((member) => <div key={member._id} className="flex justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><span className="font-medium">{member.name}<span className="ml-2 block text-xs font-normal text-slate-500">{member.email}</span></span><span className="text-xs text-slate-500">{member.uhid}</span></div>)}</div>}
        </Card>
        <Card title={`Patient directory · ${patients.length}`} icon={Users}>{patients.length === 0 ? <Empty>No patients are registered.</Empty> : <div className="max-h-96 space-y-2 overflow-auto">{patients.map((patient) => <div key={patient._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><span className="font-medium">{patient.name}<span className="ml-2 text-xs font-normal text-slate-500">{patient.uhid}</span><span className="mt-1 block text-xs font-normal text-slate-500">{patient.email} · {calculateAge(patient.dateOfBirth) ?? 'Age not recorded'}{calculateAge(patient.dateOfBirth) !== null ? ' years' : ''} · {patient.bloodGroup || 'Blood group unknown'}</span><span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-300">Conditions: {patient.chronicConditions?.length ? patient.chronicConditions.join(', ') : 'None recorded'} · Allergies: {patient.allergies?.length ? patient.allergies.join(', ') : 'None recorded'}</span></span><button onClick={() => deletePatient(patient)} className="text-xs text-rose-600 hover:underline">Remove chart</button></div>)}</div>}</Card>
        <Card title={`Appointment overview · ${appointments.length}`} icon={CalendarDays}>{appointments.length === 0 ? <Empty>No appointments are booked.</Empty> : <div className="max-h-80 space-y-2 overflow-auto">{appointments.map((item) => <div key={item._id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><p className="font-medium">{item.patientId?.name} · {item.department} · {item.status}</p><p className="mt-1 text-xs text-slate-500">{formatAppointmentDate(item.date)} · {formatAppointmentSlot(item.time)} · {item.triage}</p></div>)}</div>}</Card>
      </div>
    </main>
  );
}

export default App;

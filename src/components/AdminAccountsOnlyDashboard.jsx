import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';

const roleLabels = {
  admin: 'Administrators',
  doctor: 'Doctors',
  staff: 'Medical staff (nurses)',
  receptionist: 'Receptionists',
  patient: 'Patients',
};

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const values = new Uint32Array(16);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

function AccountGroup({ role, users, currentUserId, notify, onChanged }) {
  const [credentials, setCredentials] = useState(null);
  const accounts = users.filter((user) => user.role === role);
  const resetPassword = async (user) => {
    const password = generateTemporaryPassword();
    try {
      const { data } = await api.post(`/users/${user.id}/reset-password`, { password });
      setCredentials({ email: user.email, password: data.temporaryPassword });
      notify(`Temporary password reset for ${user.name}.`);
      onChanged();
    } catch (error) {
      notify(error.message, 'error');
    }
  };
  const setActive = async (user) => {
    try {
      await api.patch(`/users/${user.id}/active`, { isActive: !user.isActive });
      notify(`${user.name} is now ${user.isActive ? 'inactive' : 'active'}.`);
      onChanged();
    } catch (error) {
      notify(error.message, 'error');
    }
  };
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-bold">{roleLabels[role]} · {accounts.length}</h2>
      {accounts.length === 0 ? <p className="mt-3 text-sm text-slate-500">No accounts in this role.</p> : <div className="mt-4 max-h-96 space-y-2 overflow-auto">{accounts.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><span><span className="font-medium">{account.name}</span><span className="ml-2 text-xs text-slate-500">{account.email}</span><span className="mt-1 block text-xs text-slate-500">{account.specialization || account.uhid || account.phone || 'No additional details'} · {account.isActive ? 'Active' : 'Inactive'}</span></span><span className="flex flex-wrap gap-2"><button type="button" disabled={account.id === currentUserId} onClick={() => setActive(account)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40 dark:border-slate-700">{account.isActive ? 'Deactivate' : 'Activate'}</button><button type="button" disabled={!account.isActive || account.id === currentUserId} onClick={() => resetPassword(account)} className="rounded-lg bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Reset password</button></span></div>)}</div>}
      {credentials && <div role="dialog" aria-modal="true" aria-labelledby={`reset-${role}-title`} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"><section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"><h3 id={`reset-${role}-title`} className="text-lg font-bold">Temporary password reset</h3><p className="mt-2 text-sm text-slate-500">Share this password securely; it is shown only once and must be changed at first sign-in.</p><p className="mt-4 break-all text-sm"><strong>Login ID:</strong> {credentials.email}</p><p className="mt-1 break-all font-mono text-sm"><strong>Temporary password:</strong> {credentials.password}</p><div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700" onClick={async () => { try { await navigator.clipboard.writeText(`Login ID: ${credentials.email}\nTemporary password: ${credentials.password}`); notify('Credentials copied.'); } catch { notify('Clipboard access is unavailable.', 'error'); } }}>Copy</button><button type="button" className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => setCredentials(null)}>Done</button></div></section></div>}
    </section>
  );
}

export default function AdminAccountsOnlyDashboard({ notify, user, CreateAccountForm }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/users?q=${encodeURIComponent(query)}`);
      setUsers(data.users || []);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    const timer = window.setTimeout(loadUsers, 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);
  return <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6"><header><p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">Administration</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Account administration</h1><p className="mt-2 text-sm text-slate-500">Create and manage hospital login accounts.</p></header><CreateAccountForm notify={notify} onCreated={loadUsers} /><label className="grid gap-1 text-sm font-medium">Search accounts by name, email, phone, or role<input className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all accounts" /></label>{loading && <p role="status" className="text-sm text-slate-500">Loading accounts…</p>}{error && <div role="alert" className="flex items-center justify-between rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><span>{error}</span><button type="button" className="font-semibold underline" onClick={loadUsers}>Retry</button></div>}<div className="grid gap-6 lg:grid-cols-2">{Object.keys(roleLabels).map((role) => <AccountGroup key={role} role={role} users={users} currentUserId={user.id} notify={notify} onChanged={loadUsers} />)}</div></main>;
}

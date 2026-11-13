import { useState, type FormEvent } from 'react';
import { Loader2, Save, LockKeyhole } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { authErrorMessage, passwordValidation, PASSWORD_REQUIREMENTS } from '../auth/authFlows';
import { useUnsavedChanges } from '../components/UnsavedChanges';
import AdministratorAccess from '../components/AdministratorAccess';

const panel = 'min-w-0 rounded-[22px] border border-border bg-card p-5 sm:p-6';
const input = 'mt-2 w-full rounded-[12px] border border-border bg-muted px-3 py-3 text-foreground focus:outline-none focus:border-primary disabled:opacity-60';
const button = 'micro-interaction inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-primary bg-primary px-4 py-3 text-[14px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60';

export default function AccountPage() {
  const { user } = useAuth();
  // Remount form state when switching accounts so personal edits never carry over.
  return user ? <AccountSettings key={user.id} /> : null;
}

function AccountSettings() {
  const { user, updateProfile, changePassword } = useAuth();
  const [name, setName] = useState(user?.user_metadata?.name || '');
  const [savedName, setSavedName] = useState(name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const dirtyName = name.trim() !== savedName;
  const dirtyPassword = Boolean(currentPassword || password || confirmation);
  const busy = savingProfile || savingPassword;
  const markClean = useUnsavedChanges(dirtyName || dirtyPassword, busy);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setProfileError(''); setProfileMessage('');
    const nextName = name.trim();
    if (!nextName || nextName.length > 120) { setProfileError('Enter a display name between 1 and 120 characters.'); return; }
    setSavingProfile(true);
    try {
      await updateProfile(nextName);
      setName(nextName); setSavedName(nextName);
      setProfileMessage('Your profile has been updated.');
      if (!dirtyPassword) markClean();
    } catch (error) { setProfileError(authErrorMessage(error)); }
    finally { setSavingProfile(false); }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setPasswordError(''); setPasswordMessage('');
    const validation = passwordValidation(password, confirmation);
    if (!currentPassword || validation || password === currentPassword) {
      setPasswordError(!currentPassword ? 'Enter your current password.' : validation || 'Choose a password different from your current one.');
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, password);
      setCurrentPassword(''); setPassword(''); setConfirmation('');
      setPasswordMessage('Your password has been changed. Other sessions have been signed out.');
      if (!dirtyName) markClean();
    } catch (error) { setPasswordError(authErrorMessage(error)); }
    finally { setSavingPassword(false); }
  }

  return <main className="grid max-w-[900px] gap-6">
    <header><p className="mb-2 text-[12px] uppercase tracking-[0.16em] text-muted-foreground">Your account</p><h1 className="text-[30px] font-bold tracking-tight sm:text-[36px]">Account settings</h1><p className="mt-2 text-muted-foreground">Manage your profile and password.</p></header>
    {user?.app_metadata?.role === 'admin' && <AdministratorAccess />}
    <form className={panel} onSubmit={(event) => void saveProfile(event)} aria-label="Edit profile">
      <h2 className="text-[20px] font-bold">Profile</h2>
      <label className="mt-5 block text-[14px] font-semibold" htmlFor="account-name">Display name</label>
      <input id="account-name" name="name" autoComplete="name" className={input} value={name} maxLength={120} required disabled={busy} onChange={(event) => { setName(event.target.value); setProfileMessage(''); }} />
      <label className="mt-5 block text-[14px] font-semibold" htmlFor="account-email">Sign-in email</label>
      <input id="account-email" type="email" autoComplete="username" className={input} value={user?.email || ''} readOnly />
      <p className="mt-2 text-[12px] text-muted-foreground">Account access: {user?.app_metadata?.role === 'admin' ? 'Administrator' : 'Member'}</p>
      {profileError && <p role="alert" className="mt-4 text-[14px] text-destructive">{profileError}</p>}
      {profileMessage && <p role="status" className="mt-4 text-[14px] text-muted-foreground">{profileMessage}</p>}
      <button type="submit" className={`${button} mt-5`} disabled={busy || !dirtyName}>{savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {savingProfile ? 'Saving profile…' : 'Save profile'}</button>
    </form>
    <form className={panel} onSubmit={(event) => void savePassword(event)} aria-label="Change password">
      <h2 className="text-[20px] font-bold">Change password</h2>
      <p id="password-help" className="mt-2 text-[14px] text-muted-foreground">{PASSWORD_REQUIREMENTS} Other sessions will be signed out after you save.</p>
      <input type="text" autoComplete="username" value={user?.email || ''} readOnly hidden />
      <label className="mt-5 block text-[14px] font-semibold" htmlFor="account-current-password">Current password</label>
      <input id="account-current-password" name="currentPassword" type="password" autoComplete="current-password" className={input} value={currentPassword} required maxLength={256} disabled={busy} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordMessage(''); }} />
      <label className="mt-5 block text-[14px] font-semibold" htmlFor="account-new-password">New password</label>
      <input id="account-new-password" name="password" type="password" autoComplete="new-password" aria-describedby="password-help" className={input} value={password} required maxLength={256} disabled={busy} onChange={(event) => { setPassword(event.target.value); setPasswordMessage(''); }} />
      <label className="mt-5 block text-[14px] font-semibold" htmlFor="account-confirm-password">Confirm new password</label>
      <input id="account-confirm-password" name="confirmation" type="password" autoComplete="new-password" className={input} value={confirmation} required maxLength={256} disabled={busy} onChange={(event) => { setConfirmation(event.target.value); setPasswordMessage(''); }} />
      {passwordError && <p role="alert" className="mt-4 text-[14px] text-destructive">{passwordError}</p>}
      {passwordMessage && <p role="status" className="mt-4 text-[14px] text-muted-foreground">{passwordMessage}</p>}
      <button type="submit" className={`${button} mt-5`} disabled={busy}>{savingPassword ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />} {savingPassword ? 'Changing password…' : 'Change password'}</button>
    </form>
  </main>;
}

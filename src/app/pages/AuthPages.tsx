import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { accountRequest } from '../auth/accountClient';
import {
  authErrorCode,
  authErrorMessage,
  hasAuthLinkError,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  PASSWORD_REQUIREMENTS,
  passwordValidation,
  safeReturnPath,
} from '../auth/authFlows';

const input =
  'min-w-0 w-full border border-ring bg-input text-foreground px-3.5 py-3 rounded-[14px] outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';
const primary =
  'micro-interaction inline-flex items-center justify-center gap-2 border border-primary bg-primary text-primary-foreground px-4 py-3 rounded-[14px] font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed';
const secondary =
  'micro-interaction inline-flex items-center justify-center gap-2 border border-border bg-muted text-foreground px-4 py-3 rounded-[14px] font-semibold hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed';
const textLink =
  'text-foreground font-semibold underline underline-offset-4 hover:opacity-80';

function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="min-w-0 w-full max-w-[460px]">
        <Link
          to="/"
          className="flex items-center justify-center font-bold text-[18px] gap-2 mb-7"
        >
          <img
            src="/own-masters-logo.png"
            alt="Own Masters logo"
            className="w-16 h-auto brightness-0 dark:brightness-100"
          />{' '}
          Own Masters
        </Link>
        <section data-reveal className="min-w-0 border border-border bg-card rounded-[22px] p-5 sm:p-6">
          <h1 className="text-[30px] tracking-[-0.7px] leading-tight">
            {title}
          </h1>
          <p className="mt-2 mb-6 text-muted-foreground leading-relaxed">
            {description}
          </p>
          {children}
        </section>
        <nav aria-label="Information" className="mt-5 flex flex-wrap justify-center gap-5 text-[13px] text-muted-foreground">
          <Link className="inline-flex min-h-11 items-center hover:text-foreground" to="/terms">Terms</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-foreground" to="/privacy">Privacy</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-foreground" to="/contact">Contact</Link>
        </nav>
      </div>
    </main>
  );
}

function Feedback({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-[14px] text-red-700 dark:text-red-200"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-[14px] border border-border bg-muted p-3 text-[14px]"
        >
          {notice}
        </p>
      )}
    </>
  );
}

function PasswordField({
  label = 'Password',
  value,
  onChange,
  disabled,
  newPassword = false,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  newPassword?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="grid gap-2 text-[14px]">
      <label htmlFor={id}>{label}</label>
      <div className="relative min-w-0">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          className={`${input} pr-12`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          minLength={newPassword ? MIN_PASSWORD_LENGTH : undefined}
          maxLength={MAX_PASSWORD_LENGTH}
          required
          disabled={disabled}
        />
        <button
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          aria-controls={id}
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-accent disabled:opacity-50"
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function useEmailCooldown(initialSeconds = 0) {
  const [seconds, setSeconds] = useState(initialSeconds);
  useEffect(() => {
    if (!seconds) return;
    const timer = window.setTimeout(
      () => setSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [seconds]);
  return { seconds, start: () => setSeconds(60) };
}

function useReturnPath() {
  const location = useLocation();
  const [params] = useSearchParams();
  return safeReturnPath(
    (location.state as { from?: string } | null)?.from ?? params.get('next'),
  );
}

function authPath(path: string, returnTo: string) {
  return `${path}?next=${encodeURIComponent(returnTo)}`;
}

type EmailConfiguration = {
  emailDeliveryAvailable: boolean;
  emailPreviewUrl: string | null;
  passwordResetAvailable: boolean;
};
function useEmailConfiguration() {
  const [configuration, setConfiguration] = useState<EmailConfiguration | null>(
    null,
  );
  const [configurationError, setConfigurationError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setConfigurationError('');
    void accountRequest<EmailConfiguration>('config')
      .then((value) => {
        if (active) setConfiguration(value);
      })
      .catch((error) => {
        if (active) setConfigurationError(authErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return { configuration, configurationError, retryConfiguration: () => setAttempt((value) => value + 1) };
}

function EmailPreviewNotice({
  configuration,
}: {
  configuration: EmailConfiguration | null;
}) {
  if (
    !import.meta.env.DEV ||
    configuration?.emailPreviewUrl !== 'http://127.0.0.1:8025'
  )
    return null;
  return (
    <div className="mt-4 border border-border rounded-[14px] p-3 text-[13px]">
      <p className="text-muted-foreground mb-2">
        Local email testing: messages stay on this computer. They are not
        delivered to Gmail or other real inboxes.
      </p>
      <a
        className={textLink}
        href={configuration.emailPreviewUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open local test inbox
      </a>
    </div>
  );
}

function ConfirmationWaiting({
  email,
  returnTo,
  emailSent,
  configuration,
  onBack,
}: {
  email: string;
  returnTo: string;
  emailSent: boolean;
  configuration: EmailConfiguration | null;
  onBack: () => void;
}) {
  const { resendConfirmation } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    emailSent
      ? ''
      : 'Your account is saved, but the confirmation email could not be sent. Request another link or try again later.',
  );
  const [notice, setNotice] = useState('');
  const cooldown = useEmailCooldown(emailSent ? 60 : 0);
  async function resend() {
    if (busy || cooldown.seconds) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await resendConfirmation(email, returnTo);
      setNotice(
        'If this address is awaiting confirmation, a link will arrive shortly. Check your spam folder too.',
      );
      cooldown.start();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame
      title="Check your email."
      description="Confirm your email address before logging in to your workspace."
    >
      <p className="mb-4 text-[14px] break-words">
        If this address needs confirmation, a link will arrive at <strong>{email}</strong>. Open the link
        and select Confirm email. Links expire after one hour. If you already have an account, log in or reset your password.
      </p>
      <Feedback error={error} notice={notice} />
      <details className="rounded-[14px] border border-border p-3">
        <summary className="cursor-pointer text-[14px] font-semibold">Didn’t receive the email?</summary>
        <p className="mt-3 mb-3 text-[13px] text-muted-foreground">Check your spam folder and make sure the address above is correct. You can request another link after one minute.</p>
        <button
          type="button"
          className={`${secondary} w-full`}
          disabled={busy || cooldown.seconds > 0 || !configuration?.emailDeliveryAvailable}
          onClick={() => void resend()}
        >
          {busy ? 'Requesting…' : cooldown.seconds ? `Resend confirmation in ${cooldown.seconds}s` : 'Resend confirmation email'}
        </button>
      </details>
      <EmailPreviewNotice configuration={configuration} />
      <p className="mt-4 text-center text-[14px]"><Link className={textLink} to="/forgot-password">Reset password</Link></p>
      <p className="mt-5 text-center text-[14px]">
        <Link
          className={textLink}
          to={authPath('/login', returnTo)}
          onClick={onBack}
        >
          Back to log in
        </Link>
      </p>
    </AuthFrame>
  );
}

export function LoginPage() {
  return <AccountForm key="login" mode="login" />;
}
export function SignupPage() {
  return <AccountForm key="signup" mode="signup" />;
}

function AccountForm({ mode }: { mode: 'login' | 'signup' }) {
  const { user, loading, sessionError, retrySession, signIn, signUp } = useAuth();
  const returnTo = useReturnPath();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [emailSent, setEmailSent] = useState(true);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState('');
  const { configuration, configurationError, retryConfiguration } = useEmailConfiguration();
  const signup = mode === 'signup';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setUnconfirmedEmail('');
    if (signup) {
      const validation = !name.trim()
        ? 'Enter your name.'
        : passwordValidation(password, confirmation);
      if (validation) {
        setError(validation);
        return;
      }
    }
    setBusy(true);
    try {
      if (signup) {
        const result = await signUp({ name, email, password, returnTo });
        setPendingEmail(email.trim());
        setEmailSent(result.emailSent);
      } else await signIn({ email, password });
      setPassword('');
      setConfirmation('');
    } catch (err) {
      setError(authErrorMessage(err));
      if (authErrorCode(err) === 'email_not_confirmed') {
        setPassword('');
        setUnconfirmedEmail(email.trim());
      }
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <AuthFrame
        title="Opening your account…"
        description="Checking your sign-in."
      >
        <Loader2
          role="status"
          aria-label="Checking sign-in"
          className="size-5 animate-spin"
        />
      </AuthFrame>
    );
  if (user) return <Navigate to={returnTo} replace />;
  if (pendingEmail)
    return (
      <ConfirmationWaiting
        email={pendingEmail}
        returnTo={returnTo}
        emailSent={emailSent}
        configuration={configuration}
        onBack={() => {
          setPendingEmail('');
          setError('');
        }}
      />
    );
  return (
    <AuthFrame
      title={signup ? 'Create your account.' : 'Welcome back.'}
      description={
        signup
          ? 'Keep your songs, contracts, and music projects together.'
          : 'Log in to your Own Masters workspace.'
      }
    >
      <Feedback
        error={error || sessionError || configurationError}
        notice={
          signup && configuration && !configuration.emailDeliveryAvailable
            ? 'Account confirmation emails are not configured yet. Please contact the site owner.'
            : ''
        }
      />
      {(sessionError || configurationError) && <button type="button" className={`${secondary} mb-4 w-full`} onClick={() => { retrySession(); retryConfiguration(); }}>Try again</button>}
      <form
        className="grid grid-cols-1 gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {signup && (
          <label className="grid gap-2 text-[14px]">
            Name
            <input
              name="name"
              autoComplete="name"
              className={input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
              disabled={busy}
            />
          </label>
        )}
        <label className="grid gap-2 text-[14px]">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            autoCapitalize="none"
            spellCheck={false}
            className={input}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (unconfirmedEmail) { setUnconfirmedEmail(''); setError(''); }
            }}
            required
            disabled={busy}
          />
        </label>
        <PasswordField
          value={password}
          onChange={setPassword}
          disabled={busy}
          newPassword={signup}
        />
        {signup && (
          <>
            <p className="text-[12px] text-muted-foreground -mt-2">
              {PASSWORD_REQUIREMENTS}
            </p>
            <PasswordField
              label="Confirm password"
              value={confirmation}
              onChange={setConfirmation}
              disabled={busy}
              newPassword
            />
          </>
        )}
        {!signup && (
          <Link
            className={`${textLink} text-[14px] justify-self-end`}
            to="/forgot-password"
          >
            Forgot password?
          </Link>
        )}
        <button
          className={`${primary} w-full`}
          type="submit"
          disabled={busy || (signup && !configuration?.emailDeliveryAvailable)}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />{' '}
              {signup ? 'Creating account…' : 'Logging in…'}
            </>
          ) : signup ? (
            'Create account'
          ) : (
            'Log in'
          )}
        </button>
      </form>
      <p className="mt-5 text-center text-[14px] text-muted-foreground">
        {signup ? 'Already have an account?' : 'Need an account?'}{' '}
        <Link
          className={textLink}
          to={authPath(signup ? '/login' : '/signup', returnTo)}
        >
          {signup ? 'Log in' : 'Sign up'}
        </Link>
      </p>
      {!signup && unconfirmedEmail && <p className="mt-3 text-center text-[14px]">
        <Link
          className={textLink}
          to={authPath('/resend-confirmation', returnTo)}
          state={{ email: unconfirmedEmail }}
        >
          Resend confirmation email
        </Link>
      </p>}
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const { configuration, configurationError, retryConfiguration } = useEmailConfiguration();
  const available = configuration?.passwordResetAvailable ?? null;
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const cooldown = useEmailCooldown();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || cooldown.seconds || !available) return;
    setBusy(true);
    setError('');
    setSent(false);
    try {
      await requestPasswordReset(email);
      setSent(true);
      cooldown.start();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame
      title="Reset your password."
      description="Enter your account email and we’ll help you get back in."
    >
      <Feedback
        error={error || configurationError}
        notice={
          available === false
            ? 'Password reset emails are not set up yet. Please contact the site owner if you need help accessing your account.'
            : sent
              ? 'If an account matches this email, you’ll receive a password-reset link shortly. Check your spam folder too.'
              : ''
        }
      />
      {available === null && !error && (
        <p role="status" className="mb-4 text-[14px]">
          Checking password recovery…
        </p>
      )}
      {configurationError && <button type="button" className={`${secondary} mb-4 w-full`} onClick={retryConfiguration}>Try again</button>}
      <form
        className="grid grid-cols-1 gap-4"
        onSubmit={(event) => void submit(event)}
      >
        <label className="grid gap-2 text-[14px]">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            className={input}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy || !available}
          />
        </label>
        <button
          type="submit"
          className={primary}
          disabled={busy || cooldown.seconds > 0 || !available}
        >
          {busy
            ? 'Sending…'
            : cooldown.seconds
              ? `Send another link in ${cooldown.seconds}s`
              : 'Send reset link'}
        </button>
      </form>
      <EmailPreviewNotice configuration={configuration} />
      <p className="mt-5 text-center text-[14px]">
        <Link className={textLink} to="/login">
          Back to log in
        </Link>
      </p>
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const { loading, updatePassword } = useAuth();
  const location = useLocation();
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('token') || '',
  );
  const [linkError] = useState(() =>
    hasAuthLinkError(location.search, location.hash),
  );
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token || linkError) return;
    const validation = passwordValidation(password, confirmation);
    setError(validation);
    if (validation) return;
    setBusy(true);
    try {
      await updatePassword(password, token);
      setPassword('');
      setConfirmation('');
      setSaved(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (saved)
    return (
      <AuthFrame
        title="Password updated."
        description="Log in again with your new password."
      >
        <CheckCircle2 className="size-8 mb-4" />
        <Link className={`${primary} w-full`} to="/login">
          Log in
        </Link>
      </AuthFrame>
    );
  if (linkError || !/^[a-f0-9]{64}$/.test(token))
    return (
      <AuthFrame
        title="Request a new reset link."
        description="This link is missing, invalid, or has expired. Open the latest password-reset email to continue."
      >
        <Link className={`${primary} w-full`} to="/forgot-password">
          Get a new reset link
        </Link>
        <p className="mt-5 text-center text-[14px]">
          <Link className={textLink} to="/login">
            Back to log in
          </Link>
        </p>
      </AuthFrame>
    );
  return (
    <AuthFrame
      title="Choose a new password."
      description={PASSWORD_REQUIREMENTS}
    >
      <Feedback error={error} />
      <form
        className="grid grid-cols-1 gap-4"
        onSubmit={(event) => void submit(event)}
      >
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          disabled={busy || loading}
          newPassword
        />
        <PasswordField
          label="Confirm password"
          value={confirmation}
          onChange={setConfirmation}
          disabled={busy || loading}
          newPassword
        />
        <button type="submit" className={primary} disabled={busy || loading}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
      <p className="mt-5 text-center text-[14px]">
        <Link className={textLink} to="/forgot-password">
          Request a new reset link
        </Link>
      </p>
    </AuthFrame>
  );
}

export function ResendConfirmationPage() {
  const { resendConfirmation } = useAuth();
  const location = useLocation();
  const returnTo = useReturnPath();
  const { configuration, configurationError, retryConfiguration } = useEmailConfiguration();
  const [email, setEmail] = useState(() => {
    const value = (location.state as { email?: unknown } | null)?.email;
    return typeof value === 'string' && value.length <= 254 ? value : '';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cooldown = useEmailCooldown();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || cooldown.seconds || !configuration?.emailDeliveryAvailable)
      return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await resendConfirmation(email, returnTo);
      setNotice(
        'If this address is awaiting confirmation, a link will arrive shortly. Check your spam folder too.',
      );
      cooldown.start();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame
      title="Get a confirmation email."
      description="Enter the email address you used to create your account."
    >
      <Feedback
        error={error || configurationError}
        notice={
          notice ||
          (configuration && !configuration.emailDeliveryAvailable
            ? 'Confirmation emails are not configured yet. Please contact the site owner.'
            : '')
        }
      />
      {configurationError && <button type="button" className={`${secondary} mb-4 w-full`} onClick={retryConfiguration}>Try again</button>}
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <label className="grid gap-2 text-[14px]">
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            className={input}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />
        </label>
        <button
          className={primary}
          type="submit"
          disabled={
            busy ||
            cooldown.seconds > 0 ||
            !configuration?.emailDeliveryAvailable
          }
        >
          {busy
            ? 'Requesting…'
            : cooldown.seconds
              ? `Request another link in ${cooldown.seconds}s`
              : 'Send confirmation email'}
        </button>
      </form>
      <EmailPreviewNotice configuration={configuration} />
      <p className="mt-5 text-center text-[14px]">
        <Link className={textLink} to={authPath('/login', returnTo)}>
          Back to log in
        </Link>
      </p>
    </AuthFrame>
  );
}

export function ConfirmEmailPage() {
  const { confirmEmail } = useAuth();
  const location = useLocation();
  const requestedReturn = useReturnPath();
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('token') || '',
  );
  const [returnTo, setReturnTo] = useState(requestedReturn);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (busy || confirmed) return;
    setBusy(true);
    setError('');
    try {
      const result = await confirmEmail(token);
      setReturnTo(safeReturnPath(result.returnTo));
      setConfirmed(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (confirmed)
    return (
      <AuthFrame
        title="Email confirmed."
        description="Your account is ready. Log in to open your workspace."
      >
        <CheckCircle2 className="size-8 mb-4" />
        <Link className={`${primary} w-full`} to={authPath('/login', returnTo)}>
          Go to log in
        </Link>
      </AuthFrame>
    );
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    hasAuthLinkError(location.search, location.hash)
  )
    return (
      <AuthFrame
        title="Request a new confirmation link."
        description="This link is missing, invalid, or has expired."
      >
        <Link
          className={`${primary} w-full`}
          to={authPath('/resend-confirmation', returnTo)}
        >
          Get a new confirmation email
        </Link>
      </AuthFrame>
    );
  return (
    <AuthFrame
      title="Confirm your email."
      description="If you created this Own Masters account, confirm your email address to activate it."
    >
      <Feedback error={error} />
      <button
        className={`${primary} w-full`}
        type="button"
        disabled={busy}
        onClick={() => void confirm()}
      >
        {busy ? 'Confirming…' : 'Confirm email'}
      </button>
      <p className="mt-5 text-center text-[14px]">
        <Link
          className={textLink}
          to={authPath('/resend-confirmation', returnTo)}
        >
          Get a new confirmation email
        </Link>
      </p>
    </AuthFrame>
  );
}

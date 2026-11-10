import { renderOwnMastersLetter } from '../mail/letterTemplate.mjs';
export { ownMastersMailLogo as accountMailLogo } from '../mail/letterTemplate.mjs';

export function renderAccountMail({ kind, name, link, supportEmail = '' }) {
  if (!['confirmation', 'reset'].includes(kind)) throw new Error('Unknown account email type.');
  const destination = new URL(link);
  const confirmation = kind === 'confirmation';
  return renderOwnMastersLetter({
    subject: confirmation ? 'Confirm your Own Masters email' : 'Reset your Own Masters password',
    name,
    titleLines: confirmation ? ['Make your next', 'move official.'] : ['Back to your', 'next move.'],
    eyebrow: confirmation ? 'YOUR MUSIC. YOUR BUSINESS.' : 'YOUR WORKSPACE IS WAITING.',
    subtitle: confirmation ? 'One last step to your Own Masters workspace.' : 'Let’s get you back to the work that matters.',
    preheader: confirmation ? 'One last step. Confirm your email and make room for your music business.' : 'Reset your password and get back to your Own Masters workspace.',
    body: confirmation
      ? 'Your songs, agreements and ideas deserve a place of their own. Confirm your email to get your Own Masters workspace started.'
      : 'A fresh password gets you back to your songs, agreements and projects. Use the button below to choose a new one.',
    button: { label: confirmation ? 'Confirm email' : 'Reset password', url: destination.href },
    instruction: confirmation
      ? 'The button opens Own Masters. Select Confirm email on that page, then log in to your workspace.'
      : 'The button opens Own Masters, where you can choose a new password. You will then return to login.',
    notice: { title: 'Just for you.', body: 'This link expires in ' + (confirmation ? '1 hour' : '30 minutes') + ' and can only be used once.' },
    footnote: confirmation
      ? 'Didn’t create an Own Masters account? You can ignore this email.'
      : 'Didn’t request a password reset? You can ignore this email. Your password will stay the same.',
    securityNote: 'Keep this link private. We will never ask you to share it or your password.',
    appOrigin: destination.origin,
    supportEmail,
  });
}

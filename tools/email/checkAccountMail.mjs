import { loadEnv } from '../../server/lib/env.mjs';
import { accountMailConfiguration, createAccountMailTransport } from '../../server/lib/auth/accountMail.mjs';
import { publicSiteConfiguration } from '../../server/lib/deployment/siteConfiguration.mjs';
import { renderDeliveryTestMail } from '../../server/lib/mail/letterTemplate.mjs';

loadEnv();
const configuration = accountMailConfiguration();
if (!configuration.available) {
  console.error('Account email delivery is not configured. See docs/account-email-setup.md.');
  process.exitCode = 1;
} else {
  let transport;
  try {
    transport = await createAccountMailTransport();
    await transport.verify();
    const args = process.argv.slice(2);
    const recipient = args.length === 2 && args[0] === '--to' ? args[1].trim() : '';
    if (args.length && !/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(recipient))
      throw Object.assign(new Error('Use --to followed by one test inbox address.'), { safeMessage: true });
    if (recipient) {
      if (configuration.previewUrl)
        throw Object.assign(new Error('Email is still in local preview mode. Configure real SMTP delivery before testing an external inbox.'), { safeMessage: true });
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: { address: recipient },
        ...renderDeliveryTestMail({ appOrigin: process.env.APP_ORIGIN, supportEmail: publicSiteConfiguration().supportEmail }),
      });
      console.log('The SMTP provider accepted the test email. Check the chosen inbox and spam folder to confirm delivery.');
    } else console.log(configuration.previewUrl
      ? 'The local preview inbox is reachable. No email was sent; external delivery is not enabled.'
      : 'The real SMTP connection and authentication passed. No email was sent.');
  } catch (error) {
    // Provider errors can include credentials or message content. Do not print them.
    console.error(error.safeMessage ? error.message : 'Email verification failed. Check SMTP settings, credentials, and the provider’s account/security settings.');
    process.exitCode = 1;
  } finally { transport?.close(); }
}

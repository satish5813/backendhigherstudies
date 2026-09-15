/**
 * Checks the SMTP settings in .env and optionally sends a real test message.
 *
 *   node server/src/db/test-mail.js                 # connect + authenticate only
 *   node server/src/db/test-mail.js you@klu.ac.in   # ...and send a test email
 *
 * Reads the credentials from .env — nothing is typed on the command line, so
 * the password never lands in your shell history.
 */
import { env } from '../config/env.js';
import { explainSmtpError, sendMail, verifyMailer } from '../services/mailer.js';

const recipient = process.argv.slice(2).find((a) => a.includes('@'));

const mask = (value) => {
  if (!value) return '(not set)';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 2, 12))}`;
};

function guessProvider(host) {
  if (/office365|outlook|microsoft/i.test(host)) return 'Microsoft 365 / Outlook';
  if (/hostinger/i.test(host)) return 'Hostinger';
  if (/gmail|google/i.test(host)) return 'Gmail / Google Workspace';
  if (/brevo|sendinblue/i.test(host)) return 'Brevo';
  if (/resend/i.test(host)) return 'Resend';
  if (/amazonaws/i.test(host)) return 'Amazon SES';
  return host ? 'custom' : 'none';
}

async function main() {
  console.log('\nSMTP configuration');
  console.log('─'.repeat(62));
  console.log(`  host         ${env.mail.host || '(not set)'}`);
  console.log(`  port         ${env.mail.port}`);
  console.log(`  secure       ${env.mail.secure}   ${env.mail.secure ? '(implicit TLS — correct for 465)' : '(STARTTLS — correct for 587)'}`);
  console.log(`  username     ${env.mail.user || '(not set)'}`);
  console.log(`  password     ${mask(env.mail.pass)}`);
  console.log(`  from         "${env.mail.fromName}" <${env.mail.fromAddress}>`);
  console.log(`  provider     ${guessProvider(env.mail.host)}`);
  console.log('─'.repeat(62));

  /* ---- configuration sanity, before we even dial out ------------------- */
  const warnings = [];
  if (!env.mail.host) warnings.push('SMTP_HOST is empty — mail is disabled entirely.');
  if (env.mail.port === 587 && env.mail.secure) warnings.push('Port 587 needs SMTP_SECURE=false (STARTTLS).');
  if (env.mail.port === 465 && !env.mail.secure) warnings.push('Port 465 needs SMTP_SECURE=true (implicit TLS).');
  if (env.mail.port === 25) warnings.push('Port 25 is blocked by almost every cloud provider, Hostinger included. Use 587.');
  if (env.mail.user && env.mail.fromAddress && env.mail.user.toLowerCase() !== env.mail.fromAddress.toLowerCase()) {
    warnings.push(`MAIL_FROM_ADDRESS (${env.mail.fromAddress}) differs from SMTP_USER (${env.mail.user}). Most providers reject that unless it is a verified alias.`);
  }
  if (/office365|outlook/i.test(env.mail.host)) {
    warnings.push('Microsoft 365: SMTP AUTH is disabled tenant-wide by default. If you get a 535, it is a policy block, not a wrong password — see docs/EMAIL-SETUP.md.');
  }

  if (warnings.length) {
    console.log('\nBefore we start:');
    for (const w of warnings) console.log(`  !  ${w}`);
  }

  if (!env.mail.host) {
    console.log('\nNothing to test. Fill in the SMTP block in server/.env first.\n');
    process.exit(1);
  }

  /* ---- connect + authenticate ------------------------------------------ */
  console.log('\nConnecting…');
  const ok = await verifyMailer();
  if (!ok) {
    console.log('\nCould not authenticate. Nothing was sent.\n');
    process.exit(1);
  }
  console.log('  Connected and authenticated.');

  if (!recipient) {
    console.log('\nConnection works. To send a real test message:');
    console.log('  node server/src/db/test-mail.js you@kluniversity.in\n');
    process.exit(0);
  }

  /* ---- send ------------------------------------------------------------ */
  console.log(`\nSending a test message to ${recipient}…`);
  const result = await sendMail({
    to: recipient,
    subject: `${env.appName} SMTP test — ${new Date().toLocaleTimeString('en-IN')}`,
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px">
        <h2 style="margin:0 0 8px">SMTP is working</h2>
        <p style="color:#475569;line-height:1.6">
          If you are reading this, ${env.appName} can send mail through
          <b>${env.mail.host}</b> as <b>${env.mail.user}</b>.
          Student verification codes and daily job alerts will be delivered.
        </p>
        <p style="color:#94a3b8;font-size:12px">
          Sent ${new Date().toString()}
        </p>
      </div>`,
  });

  if (result.sent) {
    console.log(`  Sent. Message id: ${result.messageId}`);
    console.log('\n  Check the inbox — and the spam folder. If it landed in spam,');
    console.log('  add SPF and DKIM records for the sending domain.\n');
    process.exit(0);
  }

  console.log(`  FAILED: ${result.error}`);
  console.log(`\n  ${explainSmtpError({ message: result.error })}\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\ntest-mail crashed:', err.message);
  console.error(explainSmtpError(err), '\n');
  process.exit(1);
});

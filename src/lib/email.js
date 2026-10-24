import dns from 'node:dns/promises';

// Real-address validation for admin accounts: syntax + proof the domain can
// actually receive mail (DNS MX records, e.g. gmail.com -> gmail-smtp-in).
// This cannot prove the individual mailbox exists without sending an email;
// full mailbox verification would need a confirmation-mail flow (not configured).
export function emailFormatOk(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

export async function emailDomainCanReceiveMail(email) {
  const domain = String(email).trim().split('@').pop().toLowerCase();
  if (!domain || domain.includes(' ') || !domain.includes('.')) {
    return { ok: false, reason: 'Email domain is invalid.' };
  }
  try {
    const records = await dns.resolveMx(domain);
    if (records && records.length > 0) return { ok: true };
    return { ok: false, reason: `The domain ${domain} cannot receive email (no mail servers).` };
  } catch (err) {
    const code = err?.code ?? '';
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ENOTIMP' || code === 'ESERVFAIL') {
      return { ok: false, reason: `The domain ${domain} does not exist or cannot receive email.` };
    }
    // No DNS (offline dev machine, blocked resolver): fail closed with a clear message.
    return { ok: false, reason: 'Could not verify the email domain (DNS unavailable). Try again with network access.' };
  }
}

export async function validateAdminEmail(email) {
  if (!emailFormatOk(email)) {
    return { ok: false, reason: 'Enter a valid email address.' };
  }
  return emailDomainCanReceiveMail(email);
}

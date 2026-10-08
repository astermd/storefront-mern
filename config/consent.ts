/**
 * Ported from storefront-lamp/config/consent.php. Client-owned, not `src/` — a real deployment may
 * edit this file directly.
 *
 * Consent controls shown at checkout. Every one of these is the deployment's to change — wording,
 * links, and which consents appear — because jurisdiction and counsel differ. The defaults are
 * drafted to industry convention so a deployment that customises nothing still asks for consent in
 * a legally-shaped way; they are a starting point, not legal advice.
 *
 * `blocking` decides whether the order can be placed without it. Exactly the terms/privacy/
 * telehealth consent is blocking by default; marketing and transactional messaging never block
 * anything — a visitor who declines marketing must still receive their shipping notification,
 * which is why the two are separate entries rather than one bundled checkbox.
 *
 * Changing any `html` below changes the version stamp recorded against every later order
 * (`Consents.version()` hashes the copy), and existing records keep pointing at the wording they
 * were shown.
 */
export interface ConsentDefinitionRow {
  key: string;
  label: string;
  html: string;
  blocking: boolean;
  links: string[];
}

export interface ConsentConfig {
  consents: ConsentDefinitionRow[];
}

export function loadConsentConfig(): ConsentConfig {
  return {
    consents: [
      {
        key: 'terms',
        label: 'Terms, privacy, and telehealth consent',
        html: 'I agree to the <a href="/terms/" class="underline">Terms of Service</a>, <a href="/privacy/" class="underline">Privacy Policy</a>, and <a href="/telehealth-consent/" class="underline">Telehealth Consent</a>.',
        blocking: true,
        links: ['/terms/', '/privacy/', '/telehealth-consent/'],
      },
      {
        key: 'marketing',
        label: 'Marketing communications',
        html: 'I agree to receive marketing emails about products and offers.',
        blocking: false,
        links: [],
      },
      {
        key: 'transactional_sms',
        label: 'Transactional messaging',
        html: 'I agree to receive order and care messages by SMS. Message and data rates may apply.',
        blocking: false,
        links: [],
      },
    ],
  };
}

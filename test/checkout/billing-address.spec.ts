import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ejs from 'ejs';
import { BuyerDetails } from '../../src/checkout/buyer-details';
import { BuyerValidator } from '../../src/checkout/buyer-validator';
import { CheckoutViewModel } from '../../src/checkout/checkout-view-model';
import { Totals } from '../../src/checkout/totals';
import { Receipt } from '../../src/completion/receipt';
import { ReceiptViewModel } from '../../src/completion/receipt-view-model';
import { AdapterCapabilities, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_THEME_FIELDS } from '../../src/payment/adapter-capabilities';
import { CheckoutChampPayload } from '../../src/payment/checkout-champ/checkout-champ-payload';
import { OrderEnvelope } from '../../src/payment/order-envelope';
import { OrderLine } from '../../src/payment/order-line';
import { PaymentCredential } from '../../src/payment/payment-credential';
import { VrioPayload } from '../../src/payment/vrio/vrio-payload';
import type { VerificationGateway } from '../../src/emr/verification-gateway';

/**
 * The separate billing address: billing is the delivery address
 * (`[13.2]`) unless "Use a different billing address" is ticked, and only then is a `billing_*`
 * field read, validated, sent to a provider or shown on the receipt.
 */
const DELIVERY = {
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  phone: '(555) 123-4567',
  address_line: '1 Main St',
  city: 'Metropolis',
  territory: 'ny',
  postal_code: '10001',
};

const BILLING = {
  billing_first_name: ' John ',
  billing_last_name: 'Payer',
  billing_address_line: '9 Card Ave',
  billing_city: 'Gotham',
  billing_territory: 'nj',
  billing_postal_code: '07001',
};

const ticked = (): BuyerDetails => BuyerDetails.fromSubmitted({ ...DELIVERY, billing_different: 'on', ...BILLING });
const unticked = (): BuyerDetails => BuyerDetails.fromSubmitted({ ...DELIVERY, ...BILLING });

const noVerification: VerificationGateway = {
  isEnabled: () => false,
  emailIsDeliverable: jest.fn(),
  normaliseAddress: jest.fn(),
} as unknown as VerificationGateway;

function envelope(details: BuyerDetails): OrderEnvelope {
  const lines = [new OrderLine('a', 'A', '7', '11', 5000, 1)];
  return new OrderEnvelope(lines, details.toBuyer(), 5000, 0, 5000, 'USD', null, {}, null, null, null, 'idem-1', 'a');
}

describe('BuyerDetails billing', () => {
  it('reads the billing fields only when the box is ticked', () => {
    const details = ticked();

    expect(details.billingDifferent).toBe(true);
    expect(details.billingFirstName).toBe('John');
    expect(details.billingTerritory).toBe('NJ');
    expect(details.toBuyer().billing).toMatchObject({ firstName: 'John', lastName: 'Payer', addressLine: '9 Card Ave', city: 'Gotham', territory: 'NJ', postalCode: '07001', country: 'US' });

    // Hidden fields still post their values; unticked they are ignored, never billed.
    const plain = unticked();
    expect(plain.billingDifferent).toBe(false);
    expect(plain.billingFirstName).toBe('');
    expect(plain.toBuyer().billing).toBeNull();
  });

  it('keeps an unticked field set (and the idempotency key built from it) exactly as before', () => {
    expect(Object.keys(unticked().toArray()).sort()).toEqual(Object.keys(DELIVERY).sort());
    expect(ticked().toArray()).toMatchObject({ billing_different: 'on', billing_first_name: 'John', billing_territory: 'NJ' });
  });

  it('round-trips through journey state', () => {
    const stored = ticked().toArray();
    expect(BuyerDetails.fromStored(stored).toArray()).toEqual(stored);
    expect(BuyerDetails.fromStored(unticked().toArray()).billingDifferent).toBe(false);
  });
});

describe('BuyerValidator billing', () => {
  it('asks for nothing extra when unticked', async () => {
    const errors = await BuyerValidator.validate(BuyerDetails.fromSubmitted({ ...DELIVERY, billing_city: '' }), noVerification);

    expect(Object.keys(errors).filter((field) => field.startsWith('billing_'))).toEqual([]);
  });

  it('requires and shape-checks the billing address when ticked', async () => {
    const errors = await BuyerValidator.validate(
      BuyerDetails.fromSubmitted({ ...DELIVERY, billing_different: 'on', ...BILLING, billing_city: '', billing_territory: 'zz', billing_postal_code: '123' }),
      noVerification,
    );

    expect(errors.billing_city).toBe('Enter your billing city.');
    expect(errors.billing_territory).toBe('We ship within the United States only, so this must be a US state or territory.');
    expect(errors.billing_postal_code).toBe('Enter a ZIP code as five digits, or five plus four.');
  });

  it('accepts a valid billing address in another state', async () => {
    expect(await BuyerValidator.validate(ticked(), noVerification)).toEqual({});
  });
});

describe('provider payloads', () => {
  const credentials = { campaignId: 1, connectionId: 2 } as never;
  const card = PaymentCredential.card('4111111111111111', '01', '2030', '123');

  it('Vrio bills the separate address and says shipping is not the same', () => {
    const body = VrioPayload.forOrder(envelope(ticked()), card, credentials, 3);

    expect(body).toMatchObject({
      ship_fname: 'Jane',
      ship_address1: '1 Main St',
      shipping_same: false,
      bill_fname: 'John',
      bill_lname: 'Payer',
      bill_address1: '9 Card Ave',
      bill_city: 'Gotham',
      bill_state: 'NJ',
      bill_zipcode: '07001',
      bill_country: 'US',
    });
  });

  it('Vrio bills the delivery address when unticked', () => {
    const body = VrioPayload.forOrder(envelope(unticked()), card, credentials, 3);

    expect(body).toMatchObject({ shipping_same: true, bill_fname: 'Jane', bill_address1: '1 Main St', bill_state: 'NY', bill_zipcode: '10001' });
  });

  it('CheckoutChamp sends the billing contact unprefixed and keeps the delivery name on ship*', () => {
    const body = CheckoutChampPayload.forLead(envelope(ticked()));

    expect(body).toMatchObject({
      firstName: 'John',
      lastName: 'Payer',
      address1: '9 Card Ave',
      city: 'Gotham',
      state: 'NJ',
      postalCode: '07001',
      shipFirstName: 'Jane',
      shipLastName: 'Doe',
      shipAddress1: '1 Main St',
      shipState: 'NY',
    });
    expect(body).not.toHaveProperty('billFirstName');
  });

  it('CheckoutChamp bills the delivery address when unticked', () => {
    expect(CheckoutChampPayload.forLead(envelope(unticked()))).toMatchObject({ firstName: 'Jane', address1: '1 Main St', state: 'NY', shipFirstName: 'Jane' });
  });
});

describe('receipt billing', () => {
  it('keeps the separate billing address, and none when billing was the delivery address', () => {
    const billed = Receipt.fromOrderRows([], ticked().toArray(), 'USD');
    expect(billed.billing).toEqual({ name: 'John Payer', address_line: '9 Card Ave', city: 'Gotham', territory: 'NJ', postal_code: '07001', country: '' });
    expect(Receipt.fromArray(billed.toArray()).billing).toEqual(billed.billing);

    expect(Receipt.fromOrderRows([], unticked().toArray(), 'USD').billing).toBeNull();
  });

  it('reads a receipt stored before billing existed as billed to the delivery address', () => {
    const stored = Receipt.fromOrderRows([], unticked().toArray(), 'USD').toArray();
    delete stored.billing;

    const view = ReceiptViewModel.fromReceipt(Receipt.fromArray(stored));
    expect(view.billing).toBeNull();
    expect(view.billingName()).toBe('Jane Doe');
    expect(view.billingAddress()).toBe(view.shippingAddress);
  });

  it('shows the separate billing address on the view model', () => {
    const view = ReceiptViewModel.fromReceipt(Receipt.fromOrderRows([], ticked().toArray(), 'USD'));

    expect(view.billingName()).toBe('John Payer');
    expect(view.billingAddress()).toBe('9 Card Ave, Gotham, NJ, 07001');
  });
});

describe('checkout page billing section', () => {
  const viewsDir = join(process.cwd(), 'views');
  const capabilities = new AdapterCapabilities('none', false, SCOPE_LINE_ITEM, STRATEGY_TOKENIZATION, SURFACE_THEME_FIELDS, [], [], 'No provider configured.', false, false, false, false, []);

  function render(prefill: Record<string, string>, errors: Record<string, string> = {}): string {
    const checkout = new CheckoutViewModel(prefill, errors, null, Totals.of(2000, null), [], [], null, [], capabilities, null, 'USD', 1);

    return ejs.render(
      readFileSync(join(viewsDir, 'pages/checkout.ejs'), 'utf8'),
      {
        csrf_token: null,
        url: (p: string) => p,
        asset: (n: string) => '/assets/build/' + n,
        money: (c: number) => '$' + (c / 100).toFixed(2),
        site: { name: 'AsterMD', url: 'http://localhost' },
        app_env: 'test',
        maps_api_key: null,
        portal_url: null,
        footer_products: [],
        current_path: '/checkout/',
        cart: { count: 1, subtotal_cents: 2000, notice: null, lines: [], actions: { assessment: null, checkout: null, terminal: null } },
        noindex: true,
        checkout,
      },
      { views: [viewsDir], filename: join(viewsDir, 'pages/checkout.ejs') },
    );
  }

  it('renders the box unticked, with editable billing name fields', () => {
    const html = render(unticked().toArray());

    expect(html).toMatch(/<input type="checkbox" id="checkout-billing-different" name="billing_different" value="on" \/>/);
    for (const name of ['billing_first_name', 'billing_last_name']) {
      const input = new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html);
      expect(input).not.toBeNull();
      expect(input![0]).not.toMatch(/\s(readonly|disabled)[\s=>]/);
    }
  });

  it('re-renders a ticked box with what the buyer typed and the error beside its field', () => {
    const html = render(ticked().toArray(), { billing_postal_code: 'Enter your billing ZIP code.' });

    expect(html).toMatch(/name="billing_different" value="on" checked/);
    expect(html).toContain('value="9 Card Ave"');
    expect(html).toContain('Enter your billing ZIP code.');
  });
});

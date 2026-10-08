import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ejs from 'ejs';
import { Definition } from '../../src/forms/definition';
import { Field } from '../../src/forms/field';
import { FieldViewModel } from '../../src/forms/field-view-model';
import { ProgressSteps } from '../../src/forms/progress-steps';
import { RuleEvaluator } from '../../src/forms/rule-evaluator';

/**
 * Renders every intake field-type partial (through the real `field.ejs` dispatcher, driven by
 * real `FieldViewModel`/`RuleEvaluator` output — not hand-typed locals) plus the two page
 * templates that assemble them, against one representative definition covering every field type.
 * This is what proves the templates are runtime-safe, not just EJS-syntax-valid: the field-type
 * partials, `field.ejs`'s dispatcher, and `pages/intake/{form,form-js-engine}.ejs` currently have
 * no automated exerciser other than this — see STATUS.md's Phase 6 section on why (this port's
 * example catalog has no teleform id the real EMR channel recognises, so the live route never
 * reaches a populated form).
 */
describe('intake templates render for every field type', () => {
  const viewsDir = join(process.cwd(), 'views');
  const evaluator = new RuleEvaluator();

  const rawFields: Record<string, unknown>[] = [
    { fieldId: 'header1', name: 'header1', type: 'form-header', label: 'Tell us about yourself', order: 1 },
    { fieldId: 'progress1', name: 'progress1', type: 'form-progress', label: '', order: 2, properties: {} },
    { fieldId: 'para1', name: 'para1', type: 'paragraph', label: 'Intro copy', description: 'A few quick questions.', order: 3 },
    { fieldId: 'div1', name: 'div1', type: 'divider', label: '', order: 4 },
    {
      fieldId: 'alert1',
      name: 'alert1',
      type: 'alert',
      label: 'Notice',
      order: 5,
      properties: { alertType: 'warning', alertText: 'Please answer honestly.' },
    },
    { fieldId: 'img1', name: 'img1', type: 'image', label: 'Logo', order: 6, properties: { imageUrl: '/assets/build/logo.png' } },
    { fieldId: 'first_name', name: 'first_name', type: 'text', label: 'First name', order: 7, required: true },
    { fieldId: 'notes', name: 'notes', type: 'textarea', label: 'Additional notes', order: 7.5 },
    { fieldId: 'id_photo', name: 'id_photo', type: 'file-upload', label: 'Photo ID', order: 7.6 },
    { fieldId: 'email', name: 'email', type: 'email', label: 'Email', order: 8, required: true },
    { fieldId: 'phone', name: 'phone', type: 'phone', label: 'Phone', order: 9 },
    { fieldId: 'dob', name: 'dob', type: 'picker-date', label: 'Date of birth', order: 10 },
    {
      fieldId: 'sex',
      name: 'sex',
      type: 'choice-single',
      label: 'Sex assigned at birth',
      order: 11,
      properties: { options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] },
    },
    {
      fieldId: 'conditions',
      name: 'conditions',
      type: 'choice-multi',
      label: 'Do any of these apply?',
      order: 12,
      properties: {
        multiSelect: true,
        options: [{ value: 'none', label: 'None of the above' }, { value: 'diabetes', label: 'Diabetes' }],
      },
    },
    {
      fieldId: 'state',
      name: 'state',
      type: 'dropdown',
      label: 'State',
      order: 13,
      properties: { options: [{ value: 'CA', label: 'California' }] },
    },
    { fieldId: 'weight_goal', name: 'weight_goal', type: 'number', label: 'Goal weight (lbs)', order: 14 },
    { fieldId: 'consent', name: 'consent', type: 'terms', label: 'I agree to the terms', order: 15, required: true },
    { fieldId: 'referral', name: 'referral', type: 'hidden', label: '', order: 16 },
    {
      fieldId: 'bmi1',
      name: 'bmi1',
      type: 'bmi',
      label: 'Height & weight',
      order: 17,
      subfields: [
        { fieldId: 'height', name: 'height', type: 'number', label: 'Height (in inches)' },
        { fieldId: 'weight', name: 'weight', type: 'number', label: 'Weight (in lbs)' },
      ],
    },
    { fieldId: 'weird_widget', name: 'weird_widget', type: 'some-future-type', label: 'Unsupported', order: 18 },
    { fieldId: 'next_btn', name: 'next_btn', type: 'button', label: 'Continue', order: 19, properties: { buttonAction: 'next_page' } },
    {
      fieldId: 'two_btn',
      name: 'two_btn',
      type: 'button',
      label: 'Back',
      order: 20,
      properties: { buttonAction: 'previous_page', buttonCount: 2, secondaryButtonLabel: 'Next', secondaryButtonAction: 'next_page' },
    },
  ];

  const definition = Definition.fromArray({ pages: [{ pageId: 'p1', order: 1, fields: rawFields }] });

  const answers = { first_name: 'Jane', height: '68', weight: '160' };

  const fieldsForPage: Record<string, unknown>[] = definition
    .pages()[0]
    .fields.map((field: Field) => FieldViewModel.for(field, evaluator.state(field, answers, definition), answers[field.name as keyof typeof answers] ?? (field.type === 'bmi' ? answers : null), null));

  const locals = {
    noindex: true,
    csrf_token: 'csrf-token',
    url: (p: string) => p,
    asset: (n: string) => '/assets/build/' + n,
    money: (c: number) => '$' + (c / 100).toFixed(2),
    site: { name: 'AsterMD', url: 'http://localhost' },
    app_env: 'test',
    maps_api_key: null,
    portal_url: null,
    footer_products: [],
    current_path: '/intake/medical/',
    cart: { count: 0, subtotal_cents: 0, notice: null, lines: [], actions: { assessment: null, checkout: null, terminal: null } },
    definition,
    form_title: 'Medical intake',
    form_step: 'intake',
    unsupported_types: definition.unsupportedTypes(),
    termination_message: null,
    injected_css: null,
    stepper_steps: ProgressSteps.from(definition),
    stepper_active: 1,
    intake_engine: { css: 'https://cdn.astermd.com/js-engine/form.min.css', js: 'https://cdn.astermd.com/js-engine/form.min.js' },
    definition_json: '{}',
    initial_values_json: '{}',
    rules_json: '[]',
    form_errors: {},
    fields: [fieldsForPage],
    definition_has_buttons: true,
    // A rejected submit used to always reopen on page 0 regardless of which page's field actually
    // failed -- `intake.js` discarded the response and did a blind `window.location.reload()`, a
    // real bug found live on the Rameltion Health History page. `IntakeController.payload()` now
    // computes this as the index of the first page holding an errored field; `form.ejs` must
    // expose it so `intake.js` can open there instead of defaulting to page 0.
    error_page: 0,
  };

  function render(templatePath: string): string {
    return ejs.render(readFileSync(join(viewsDir, templatePath), 'utf8'), locals, {
      views: [join(viewsDir, 'pages/intake'), viewsDir],
      filename: join(viewsDir, templatePath),
    });
  }

  it('renders pages/intake/form.ejs with every field type present', () => {
    const html = render('pages/intake/form.ejs');
    expect(html).toContain('Medical intake');
    expect(html).toContain('First name');
    expect(html).toContain('cannot display');
    // Found missing (`Could not find the include file "field-textarea"`) only once a real,
    // live EMR questionnaire happened to carry a textarea field — no example catalog teleform
    // ever exercised this type before. Locked down here so it can't regress silently again.
    expect(html).toContain('<textarea');
    expect(html).toContain('Additional notes');
    // `file-upload` has no PHP equivalent (see field-types.ts) — a real live teleform (Rameltion's)
    // turned out to need three of them, which this port now supports for real.
    expect(html).toContain('type="file"');
    expect(html).toContain('data-intake-file-upload');
    expect(html).toContain('Photo ID');
    expect(html).not.toContain('(file-upload)');
    // field-button.ejs emitted `data-button-action` instead of `data-intake-action` — a real,
    // previously-invisible bug, since intake.js's click handler only ever queries the latter, so
    // clicking an authored Continue/Next/Submit button did nothing at all. This fixture's own
    // button field existed the whole time without this assertion ever catching it. Confirmed live:
    // a real teleform (Rameltion's) whose pages are entirely authored-button-driven had every
    // "Continue" click be inert until this was fixed.
    expect(html).toContain('data-intake-action="next_page"');
    expect(html).not.toContain('data-button-action');
    // A `buttonCount: 2` field authors two buttons in one slot (a real, live-authored pattern —
    // confirmed on Rameltion's own real teleform) — PHP's own renderer drops the second one
    // entirely too (see field-button.ejs's doc comment); this port renders both.
    const backCount = (html.match(/data-intake-action="previous_page"/g) || []).length;
    expect(backCount).toBeGreaterThanOrEqual(1);
    expect(html).toContain('>Back</button>');
    expect(html).toContain('>Next</button>');
    expect(html).toContain('data-intake-error-page="0"');
  });

  it('renders pages/intake/form-js-engine.ejs', () => {
    const html = render('pages/intake/form-js-engine.ejs');
    expect(html).toContain('intake-engine-root');
  });
});

/**
 * The server-rendered intake stepper.
 *
 * Every page of the questionnaire is already in the document ([10.6a]); this
 * script decides which one is visible, keeps conditional questions in step
 * with the answers ([10.17]), computes the BMI composite, and posts each
 * advance so a half-finished form is not lost.
 *
 * It holds no authority. Every gate it appears to enforce -- a required
 * question, a page boundary, an eligibility rule -- is evaluated again on the
 * server on each save and on submit ([10.45]), because a visitor with scripts
 * disabled or tampered with must not be able to reach a step the server would
 * refuse. Treat anything here as presentation: if this file and the server
 * ever disagree, the server is right.
 *
 * The conditional-logic rules it evaluates are the same ones the server reads
 * out of the form definition, embedded per field as `data-intake-conditions`.
 * They are duplicated here rather than fetched because a round trip per
 * keystroke would make a follow-up question feel broken.
 */
(function () {
  'use strict';

  var form = document.querySelector('[data-intake-form]');
  if (!form) return;

  var pages = Array.prototype.slice.call(form.querySelectorAll('[data-intake-page]'));
  if (!pages.length) return;

  var wrappers = Array.prototype.slice.call(form.querySelectorAll('[data-intake-field]'));
  var pageInput = form.querySelector('[data-intake-page-input]');
  var nav = form.querySelector('[data-intake-nav]');
  var interstitial = form.querySelector('[data-intake-interstitial]');
  var interstitialText = form.querySelector('[data-intake-interstitial-text]');
  var blocked = form.getAttribute('data-intake-blocked') === '1';
  var current = 0;
  var terminated = false;

  // ---- reading and writing answers ---------------------------------------

  function wrapperFor(name) {
    for (var i = 0; i < wrappers.length; i++) {
      if (wrappers[i].getAttribute('data-intake-field') === name) return wrappers[i];
    }
    return null;
  }

  function valueOf(name) {
    var wrapper = wrapperFor(name);
    if (!wrapper) return null;

    var checkboxes = wrapper.querySelectorAll('input[type="checkbox"][name$="[]"]');
    if (checkboxes.length) {
      return Array.prototype.filter.call(checkboxes, function (box) { return box.checked; })
        .map(function (box) { return box.value; });
    }

    var radio = wrapper.querySelector('input[type="radio"]:checked');
    if (radio) return radio.value;
    if (wrapper.querySelector('input[type="radio"]')) return '';

    var single = wrapper.querySelector('input[type="checkbox"]');
    if (single) return single.checked;

    var control = wrapper.querySelector('input, select, textarea');
    return control ? control.value : null;
  }

  function answers() {
    var state = {};
    wrappers.forEach(function (wrapper) {
      var name = wrapper.getAttribute('data-intake-field');
      if (name) state[name] = valueOf(name);
    });
    return state;
  }

  // ---- rule evaluation ----------------------------------------------------
  // Mirrors the server's operator set. An unrecognised operator evaluates
  // false rather than throwing ([10.18]), which is what keeps a form authored
  // against a newer vocabulary usable rather than broken.

  var ALIASES = {
    notEquals: 'not_equals', notContains: 'not_contains',
    isEmpty: 'is_empty', isNotEmpty: 'is_not_empty', notIn: 'not_in'
  };

  function isEmptyValue(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  function comparands(raw) {
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === 'string') return raw.split(',').map(function (part) { return part.trim(); });
    if (raw === null || raw === undefined) return [];
    return [String(raw)];
  }

  function numeric(value) {
    if (typeof value === 'number') return isNaN(value) ? null : value;
    if (typeof value !== 'string') return null;
    var text = value.trim();
    if (text === '') return null;
    if (text !== '' && !isNaN(Number(text))) return Number(text);
    if (/[-/:Ta-zA-Z]/.test(text)) {
      var parsed = Date.parse(text);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  function evaluateRule(rule, state) {
    var operator = ALIASES[rule.operator] || rule.operator || 'equals';
    var answer = state[rule.field];

    if (operator === 'is_empty') return isEmptyValue(answer);
    if (operator === 'is_not_empty') return !isEmptyValue(answer);

    var wanted = comparands(rule.value);

    if (Array.isArray(answer)) {
      var present = wanted.some(function (one) { return answer.map(String).indexOf(String(one)) !== -1; });
      if (operator === 'equals' || operator === 'contains' || operator === 'in') return present;
      if (operator === 'not_equals' || operator === 'not_contains' || operator === 'not_in') return !present;
      return false;
    }

    var text = answer === null || answer === undefined ? '' : String(answer);

    switch (operator) {
      case 'equals': return wanted.indexOf(text) !== -1;
      case 'not_equals': return wanted.indexOf(text) === -1;
      case 'contains': return wanted.some(function (one) { return text.indexOf(one) !== -1; });
      case 'not_contains': return !wanted.some(function (one) { return text.indexOf(one) !== -1; });
      case 'in': return wanted.indexOf(text) !== -1;
      case 'not_in': return wanted.indexOf(text) === -1;
      case 'greater_than':
      case 'less_than':
      case 'greater_than_or_equal':
      case 'less_than_or_equal': {
        var left = numeric(answer);
        var right = numeric(wanted[0]);
        if (left === null || right === null) return false;
        if (operator === 'greater_than') return left > right;
        if (operator === 'less_than') return left < right;
        if (operator === 'greater_than_or_equal') return left >= right;
        return left <= right;
      }
      default: return false;
    }
  }

  function evaluateGroup(condition, state) {
    var rules = condition.rules || [];
    if (!rules.length) return false;

    var logic = condition.logic;
    var result = evaluateRule(rules[0], state);
    for (var i = 1; i < rules.length; i++) {
      // logic[i-1] joins the accumulated result with rule i: the combinator
      // list is one shorter than the rule list.
      var joiner = (Array.isArray(logic) ? logic[i - 1] : logic) || 'and';
      var next = evaluateRule(rules[i], state);
      result = joiner === 'or' ? (result || next) : (result && next);
    }
    return result;
  }

  // ---- applying field state ----------------------------------------------

  function conditionsFor(wrapper) {
    var raw = wrapper.getAttribute('data-intake-conditions');
    if (!raw) return [];
    try { return JSON.parse(raw) || []; } catch (e) { return []; }
  }

  function applyConditions() {
    var state = answers();

    wrappers.forEach(function (wrapper) {
      var conditions = conditionsFor(wrapper);
      if (!conditions.length) return;

      var visible = wrapper.getAttribute('data-intake-hidden') !== '1';
      var disabled = false;
      var required = wrapper.getAttribute('data-intake-required') === '1';

      // Inverted defaults, matching the server: a field carrying any `show`
      // condition starts hidden, and any `enable` condition starts disabled.
      if (conditions.some(function (c) { return c.action === 'show'; })) visible = false;
      if (conditions.some(function (c) { return c.action === 'enable'; })) disabled = true;

      conditions.forEach(function (condition) {
        if (!evaluateGroup(condition, state)) return;
        switch (condition.action) {
          case 'show': visible = true; break;
          case 'hide': visible = false; break;
          case 'enable': disabled = false; break;
          case 'disable': disabled = true; break;
          case 'require': case 'make_required': required = true; break;
          case 'optional': case 'make_optional': required = false; break;
          default: break;
        }
      });

      wrapper.hidden = !visible;
      Array.prototype.forEach.call(wrapper.querySelectorAll('input, select, textarea'), function (control) {
        control.disabled = disabled;
        // The required marker has to track visibility ([10.19]): a required
        // control on a hidden branch is unfocusable, and native validation
        // would block the submit with nothing on screen to explain it.
        if (visible && !disabled && required) {
          control.setAttribute('required', '');
        } else {
          control.removeAttribute('required');
        }
      });
    });

    computeBmi(state);
    checkTermination(state);
  }

  // ---- the BMI composite -------------------------------------------------

  function computeBmi(state) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-intake-bmi]'), function (composite) {
      var target = composite.getAttribute('data-intake-bmi-target');
      var scoreField = composite.querySelector('[data-intake-bmi-score]');
      var result = composite.querySelector('[data-intake-bmi-result]');
      var unit = String(state[target + '_unit_system'] || state['bmi_unit_system'] || '').toLowerCase();
      var metric = /metric|kg|cm/.test(unit);
      var height = numeric(state[target === 'bmi_measurement' ? 'bmi_height' : target + '_height'] || state['bmi_height']);
      var weight = numeric(state[target === 'bmi_measurement' ? 'bmi_weight' : target + '_weight'] || state['bmi_weight']);

      if (height === null || weight === null || height <= 0) {
        // Absent, never zero: a zero score would satisfy a "below 27"
        // eligibility rule and stop someone who is still typing.
        if (scoreField) scoreField.value = '';
        if (result) { result.textContent = ''; result.hidden = true; }
        state[target] = null;
        return;
      }

      var score = metric
        ? weight / Math.pow(height / 100, 2)
        : (weight / Math.pow(height, 2)) * 703;
      score = Math.round(score * 10) / 10;

      var band = score < 18.5 ? 'Underweight' : score < 25 ? 'Normal' : score < 30 ? 'Overweight' : 'Obese';
      if (scoreField) scoreField.value = String(score);
      if (result) { result.textContent = 'BMI ' + score + ' · ' + band; result.hidden = false; }
      state[target] = score;
    });
  }

  // ---- eligibility -------------------------------------------------------

  function checkTermination(state) {
    var rules = [];
    try { rules = JSON.parse(form.getAttribute('data-intake-rules') || '[]') || []; } catch (e) { rules = []; }

    var fired = null;
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].mode !== 'hard') continue;
      if ((rules[i].conditions || []).some(function (c) { return evaluateGroup(c, state); })) {
        fired = rules[i];
        break;
      }
    }

    terminated = fired !== null;
    if (interstitial) {
      interstitial.hidden = !terminated;
      if (terminated && interstitialText) interstitialText.textContent = fired.message || '';
    }
    setAdvanceEnabled(!terminated && !blocked && pageAnswered(pages[current]));
  }

  function setAdvanceEnabled(enabled) {
    Array.prototype.forEach.call(
      form.querySelectorAll('[data-intake-action="next_page"], [data-intake-action="submit"]'),
      function (button) { button.disabled = !enabled; }
    );
  }

  // ---- navigation --------------------------------------------------------

  function visibleFieldsOf(page) {
    return Array.prototype.slice.call(page.querySelectorAll('[data-intake-field]'))
      .filter(function (wrapper) { return !wrapper.hidden; });
  }

  // A `type="hidden"` control is exempt from constraint validation by spec -- `checkValidity()`
  // always reports it valid, `required` or not. `field-file-upload.ejs`'s real answer lives in
  // exactly such a hidden input (the visible <input type="file"> submits nothing itself), so a
  // required file-upload silently passed every client-side check here regardless of whether
  // anything was actually uploaded -- real Health History teleform data authors two required
  // file-upload questions, so this was reachable, not theoretical: the page would let a visitor
  // through with Next/Submit enabled and no visible error, only to have the server reject it.
  function isControlAnswered(control) {
    if (control.type === 'hidden') return control.value.trim() !== '';
    return control.checkValidity();
  }

  // Whether one field wrapper's own answer already satisfies its requiredness. `data-intake-required`
  // (set by field.ejs for every field, of every type) is the source of truth here -- not a bare
  // `[required]` lookup, because `field-choice-multi.ejs`'s checkboxes never carry `required` at
  // all: HTML has no native "at least one of these N checkboxes" constraint the way it does for a
  // same-named radio group (field-choice-single.ejs puts `required` on every radio for exactly
  // that reason -- it works there). Without this, a required multi-select's own Next/Submit button
  // either never enabled (nothing here ever detected an answer) or never disabled (nothing here
  // ever detected its absence), depending on which page it shared with other real `[required]`
  // controls -- confirmed live on a real teleform's "Do you have any of the following symptoms?"
  // question.
  function isWrapperAnswered(wrapper) {
    if (wrapper.getAttribute('data-intake-required') !== '1') return true;

    var checkboxes = wrapper.querySelectorAll('input[type="checkbox"]');
    if (checkboxes.length > 0) {
      return Array.prototype.some.call(checkboxes, function (cb) { return cb.checked; });
    }

    var control = wrapper.querySelector('[required]');
    return !control || isControlAnswered(control);
  }

  // Whether every visible required field on this page already has a valid answer -- the same
  // check validatePage() uses, but without showing or clearing errors, since this runs on every
  // keystroke to gate the Next/Submit button rather than at a click.
  function pageAnswered(page) {
    return visibleFieldsOf(page).every(isWrapperAnswered);
  }

  function validatePage(page) {
    var ok = true;
    visibleFieldsOf(page).forEach(function (wrapper) {
      if (isWrapperAnswered(wrapper)) {
        clearError(wrapper);
        return;
      }
      var control = wrapper.querySelector('[required]');
      showError(wrapper, (control && control.validationMessage) || 'This is required.');
      ok = false;
    });
    return ok;
  }

  function showError(wrapper, message) {
    var node = wrapper.querySelector('[data-intake-error]');
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    node.classList.remove('hidden');
  }

  function clearError(wrapper) {
    var node = wrapper.querySelector('[data-intake-error]');
    if (!node) return;
    node.textContent = '';
    node.hidden = true;
    node.classList.add('hidden');
  }

  function goToPage(index) {
    current = Math.max(0, Math.min(pages.length - 1, index));
    pages.forEach(function (page, i) { page.hidden = i !== current; });
    if (pageInput) pageInput.value = String(current);
    // Re-evaluates conditions and the Next/Submit button's enabled state for the page just
    // entered -- without this, arriving on a page with its own required fields still empty would
    // leave the button showing whatever state the *previous* page left it in, until the visitor
    // touches something here.
    applyConditions();
    updateProgress();
    // A client-side step change is invisible to a screen reader unless it is
    // announced ([25.14]), and the new step's heading is what the visitor
    // needs read to them.
    var heading = pages[current].querySelector('h1, h2, legend, label');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateProgress() {
    var percent = Math.round(((current + 1) / pages.length) * 100);
    var fill = document.getElementById('intake-progress-fill');
    var label = document.getElementById('intake-progress-label');
    if (fill) fill.style.width = percent + '%';
    if (label) label.textContent = 'Question ' + (current + 1) + ' of ' + pages.length;
    Array.prototype.forEach.call(form.querySelectorAll('[data-intake-progress-fill]'), function (node) {
      node.style.width = percent + '%';
    });
    Array.prototype.forEach.call(form.querySelectorAll('[data-intake-progress-label]'), function (node) {
      node.textContent = 'Question ' + (current + 1) + ' of ' + pages.length;
    });
    updateStepper();
  }

  // The three visual states a step can be in, kept in step with
  // partials/stepper.twig -- which renders the same class strings server-side,
  // so the first paint and every later one agree.
  var STEP_CIRCLE = {
    done: 'bg-secondary text-secondary-foreground',
    active: 'bg-primary text-primary-foreground',
    upcoming: 'bg-divider text-muted'
  };
  var STEP_LABEL = {
    done: 'font-medium text-heading',
    active: 'font-medium text-primary',
    upcoming: 'text-muted'
  };

  function restyle(node, states, state) {
    if (!node) return;
    Object.keys(states).forEach(function (key) {
      states[key].split(' ').forEach(function (cls) { node.classList.remove(cls); });
    });
    states[state].split(' ').forEach(function (cls) { node.classList.add(cls); });
  }

  /**
   * Re-points the stepper at the page on screen.
   *
   * The stepper draws one step per page of the form, so leaving it where the
   * server rendered it would show five steps with the first one lit for the
   * whole questionnaire -- which is the fixed four-step row it replaced,
   * wearing different labels. Nothing happens when the page count and the
   * step count disagree: the steps were authored on a `form-progress` field
   * and describe something other than the pages, and moving them by page
   * index would light the wrong one.
   */
  function updateStepper() {
    var stepper = document.querySelector('[data-funnel-stepper]');
    if (!stepper) return;

    var steps = stepper.querySelectorAll('[data-stepper-step]');
    if (steps.length !== pages.length) return;

    Array.prototype.forEach.call(steps, function (step, i) {
      var state = i < current ? 'done' : (i === current ? 'active' : 'upcoming');
      restyle(step.querySelector('[data-stepper-circle]'), STEP_CIRCLE, state);
      restyle(step.querySelector('[data-stepper-label]'), STEP_LABEL, state);
    });

    Array.prototype.forEach.call(stepper.querySelectorAll('[data-stepper-connector]'), function (connector, i) {
      var done = i < current;
      connector.classList.toggle('bg-secondary', done);
      connector.classList.toggle('bg-border', !done);
      var tick = connector.querySelector('[data-stepper-tick]');
      if (tick) tick.classList.toggle('hidden', !done);
    });
  }

  function csrfToken() {
    var field = form.querySelector('[name="_csrf"]');
    return field ? field.value : '';
  }

  function post(url, extra) {
    var data = new FormData(form);
    Object.keys(extra || {}).forEach(function (key) { data.set(key, extra[key]); });
    return fetch(url, {
      method: 'POST',
      body: data,
      // `fetch` with a FormData body always sends multipart/form-data regardless of the
      // <form>'s own enctype, and this app parses no multipart bodies -- so `_csrf` inside
      // `data` never reaches `req.body` on the server, and every one of these calls (save,
      // submit, early capture) was silently rejected with 419 in a real browser. The server's
      // CsrfMiddleware already accepts the token as a header for exactly this reason.
      headers: { 'X-Requested-With': 'fetch', 'X-CSRF-Token': csrfToken() },
      credentials: 'same-origin'
    });
  }

  function save(pageIndex) {
    // A failed save must never stop the visitor ([10.26]): losing a save is
    // recoverable, trapping someone in a medical questionnaire is not. So the
    // advance happens regardless of what this returns.
    return post(form.getAttribute('data-save-url'), { page: String(pageIndex) })
      .then(function (response) {
        // A save that trips a hard rule answers with a redirect to the
        // terminal page. `fetch` follows it, so the final URL is what says so.
        if (response && response.redirected && response.url.indexOf(window.location.pathname) === -1) {
          window.location.href = response.url;
        }
        return null;
      })
      .catch(function () { return null; });
  }

  form.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-intake-action]') : null;
    if (!button || !form.contains(button)) return;
    var action = button.getAttribute('data-intake-action');

    if (action === 'previous_page') {
      event.preventDefault();
      goToPage(current - 1);
      return;
    }

    if (action === 'next_page') {
      event.preventDefault();
      if (terminated || blocked || form.hasAttribute('aria-busy')) return;
      if (!validatePage(pages[current])) return;
      // The server validates the page this names and reports the position of
      // the one after it, so this is the page being left rather than the one
      // being entered. Posting the destination instead validated an empty
      // page, which failed and silently suppressed both the progress event
      // and the lead write.
      var leavingPage = current;
      // `save()` used to be fired without waiting for it, so clicking through pages quickly (a
      // real visitor filling the form at a normal pace, not just a scripted test) could have two
      // or more of its POSTs in flight at once against the same session row -- each one reads the
      // stored answers, merges its own page's fields in, and writes the whole set back, with no
      // ordering between them. Whichever finished last won, silently discarding whatever an
      // earlier, slower save had just added -- confirmed live: the exact same page-by-page fill
      // sequence lost an earlier page's answers on some runs and not others, purely on timing.
      // Awaiting it here serialises saves per visitor without changing save()'s own contract that
      // a failed save must never trap anyone (it already resolves, never rejects, regardless of
      // outcome) -- `aria-busy` above stops a rapid double-click from creating the same race again.
      form.setAttribute('aria-busy', 'true');
      save(leavingPage).then(function () {
        form.removeAttribute('aria-busy');
        var advancingTo = leavingPage + 1;
        if (advancingTo >= pages.length) {
          submit();
        } else {
          goToPage(advancingTo);
        }
      });
      return;
    }

    if (action === 'submit') {
      event.preventDefault();
      submit();
    }
  });

  function submit() {
    if (terminated || blocked) return;
    for (var i = 0; i < pages.length; i++) {
      if (!validatePage(pages[i])) { goToPage(i); return; }
    }
    form.setAttribute('aria-busy', 'true');
    post(form.getAttribute('data-submit-url'), {}).then(function (response) {
      form.removeAttribute('aria-busy');
      if (response && response.redirected) { window.location.href = response.url; return; }
      // Not a redirect means the server refused and re-rendered with the real errors and the
      // page they belong to (`data-intake-error-page`). A plain `reload()` throws that response
      // away and does a fresh GET instead -- which carries no errors at all and always opens on
      // page 0, so a rejection on any later page looked exactly like "thrown back to the start"
      // with no explanation, even though every answer was still saved. Writing the response body
      // in place keeps the same errors this POST actually returned and re-runs this script fresh,
      // so it opens on the page named by that attribute instead of defaulting to page 0.
      return response.text().then(function (html) {
        document.open();
        document.write(html);
        document.close();
      });
    }).catch(function () {
      form.removeAttribute('aria-busy');
    });
  }

  // ---- early lead capture -------------------------------------------------

  var captured = false;
  function attemptCapture() {
    // Fires at most once per page load, and re-arms on failure so a network
    // blip does not permanently lose the lead ([9.5]).
    if (captured) return;
    var state = answers();
    var first = String(state.first_name || '').trim();
    var email = String(state.email || '').trim();
    if (!first || !email) return;

    captured = true;
    post(form.getAttribute('data-capture-url'), {}).then(function (response) {
      if (!response || !response.ok) captured = false;
    }).catch(function () { captured = false; });
  }

  // ---- file uploads --------------------------------------------------------
  // No PHP equivalent (see src/forms/field-types.ts's doc comment on `file-upload`). The visible
  // <input type="file"> never submits anything itself -- the bytes already left the browser the
  // moment a file was chosen -- so this uploads immediately on change and writes the server's
  // returned reference into the hidden input the field's real answer is read from.

  function uploadUrl() {
    return form.getAttribute('data-upload-url') || '/intake/upload';
  }

  Array.prototype.forEach.call(form.querySelectorAll('[data-intake-file-upload]'), function (container) {
    var input = container.querySelector('[data-intake-file-input]');
    var reference = container.querySelector('[data-intake-file-reference]');
    var status = container.querySelector('[data-intake-file-status]');
    if (!input || !reference) return;

    var wrapper = container.closest('[data-intake-field]');

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;

      reference.value = '';
      if (status) status.textContent = 'Uploading ' + file.name + '…';
      if (wrapper) clearError(wrapper);
      input.disabled = true;

      var data = new FormData();
      data.set('file', file);

      fetch(uploadUrl(), {
        method: 'POST',
        body: data,
        headers: { 'X-Requested-With': 'fetch', 'X-CSRF-Token': csrfToken() },
        credentials: 'same-origin'
      }).then(function (response) {
        return response.ok ? response.json() : null;
      }).then(function (body) {
        input.disabled = false;
        if (body && body.reference) {
          reference.value = body.reference;
          if (status) status.textContent = 'Uploaded ' + file.name + '.';
          applyConditions();
          return;
        }
        if (status) status.textContent = '';
        if (wrapper) showError(wrapper, 'That file could not be uploaded. Please try again.');
      }).catch(function () {
        input.disabled = false;
        if (status) status.textContent = '';
        if (wrapper) showError(wrapper, 'That file could not be uploaded. Please try again.');
      });
    });
  });

  // Next/Submit disables silently the moment a field is unanswered or invalid ([pageAnswered()]),
  // with no message anywhere -- fine for a field nobody has touched yet, but a real dead end for
  // one the visitor DID answer with something the server-side-authored min/max or format rejects:
  // the button just never enables and nothing ever explains why, since a disabled button can never
  // be clicked to trigger validatePage()'s own error display. Confirmed live: a real teleform's
  // Weight question authors a max of 100 with no visible unit hint on the field itself, so a
  // visitor typing 120 got silently stuck. This shows/clears one field's own error the moment it
  // is touched, independent of the rest of the page's "stay silent until Next is attempted"
  // behaviour for fields nobody has reached yet.
  function revalidateTouchedField(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var wrapper = target.closest('[data-intake-field]');
    if (!wrapper) return;

    if (isWrapperAnswered(wrapper)) {
      clearError(wrapper);
      return;
    }

    // An empty, still-untouched field (nothing typed, nothing picked) stays silent here too --
    // validatePage() covers that case on an actual Next/Submit attempt, same as for every other
    // field type.
    if (target.type !== 'checkbox' && target.value === '') return;

    var control = wrapper.querySelector('[required]') || target;
    showError(wrapper, control.validationMessage || 'This is required.');
  }

  form.addEventListener('input', applyConditions);
  form.addEventListener('change', applyConditions);
  form.addEventListener('input', revalidateTouchedField);
  form.addEventListener('change', revalidateTouchedField);
  form.addEventListener('blur', attemptCapture, true);

  applyConditions();
  // On an ordinary load there's no error page, so this is page 0. After a rejected submit
  // (see submit()'s failure branch above) the server names the page the real error is on --
  // opening there instead of always page 0 is what actually shows the visitor what went wrong.
  var errorPageAttr = form.getAttribute('data-intake-error-page');
  var errorPageIndex = errorPageAttr === null ? NaN : parseInt(errorPageAttr, 10);
  goToPage(isNaN(errorPageIndex) ? 0 : errorPageIndex);
})();

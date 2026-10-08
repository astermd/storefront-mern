import { RobotsPolicy } from '../../src/seo/robots-policy';

describe('RobotsPolicy', () => {
  it('returns null (indexable) for a path matching no rule', () => {
    const policy = new RobotsPolicy({}, false);
    expect(policy.directiveFor('/anything/')).toBeNull();
    expect(policy.isIndexable('/anything/')).toBe(true);
  });

  it('matches an exact path and a prefix rule', () => {
    const policy = new RobotsPolicy({ '/checkout/*': 'noindex, nofollow', '/intake/*': 'noindex, nofollow' }, false);

    expect(policy.directiveFor('/checkout/')).toBe('noindex, nofollow');
    expect(policy.directiveFor('/checkout/promo/')).toBe('noindex, nofollow');
    expect(policy.directiveFor('/other/')).toBeNull();
  });

  it('an exact rule outranks a same-length prefix rule regardless of object key order', () => {
    const exactFirst = new RobotsPolicy({ '/faq/': 'noarchive', '/faq/*': 'noindex, nofollow' }, false);
    const prefixFirst = new RobotsPolicy({ '/faq/*': 'noindex, nofollow', '/faq/': 'noarchive' }, false);

    expect(exactFirst.directiveFor('/faq/')).toBe('noarchive');
    expect(prefixFirst.directiveFor('/faq/')).toBe('noarchive');
  });

  it('a longer prefix rule outranks a shorter one', () => {
    const policy = new RobotsPolicy({ '/checkout/*': 'noindex, nofollow', '/checkout/promo/*': 'noarchive' }, false);

    expect(policy.directiveFor('/checkout/promo/apply/')).toBe('noarchive');
    expect(policy.directiveFor('/checkout/')).toBe('noindex, nofollow');
  });

  it('refusesIndexing() is true only for a directive actually containing noindex — noarchive/nosnippet index the page', () => {
    const policy = new RobotsPolicy({ '/faq/': 'noarchive', '/checkout/*': 'noindex, nofollow' }, false);

    expect(policy.refusesIndexing('/faq/')).toBe(false);
    expect(policy.isIndexable('/faq/')).toBe(true);
    expect(policy.refusesIndexing('/checkout/')).toBe(true);
    expect(policy.isIndexable('/checkout/')).toBe(false);
  });

  it('discourageIndexing refuses every path regardless of any per-route rule', () => {
    const policy = new RobotsPolicy({ '/faq/': 'noarchive' }, true);

    expect(policy.directiveFor('/faq/')).toBe(RobotsPolicy.REFUSED);
    expect(policy.directiveFor('/anything/')).toBe(RobotsPolicy.REFUSED);
    expect(policy.indexingDiscouraged()).toBe(true);
  });

  it('isIndexable() is the exact negation of refusesIndexing(), not of "has a directive at all"', () => {
    const policy = new RobotsPolicy({ '/faq/': 'noarchive' }, false);

    // Has a directive (noarchive) but is still indexable — isIndexable must not be `directiveFor() === null`.
    expect(policy.directiveFor('/faq/')).not.toBeNull();
    expect(policy.isIndexable('/faq/')).toBe(true);
  });
});

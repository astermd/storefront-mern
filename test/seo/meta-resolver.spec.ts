import { MetaResolver } from '../../src/seo/meta-resolver';
import { ConfigService } from '../../src/support/config';

describe('MetaResolver', () => {
  let config: ConfigService;
  let meta: MetaResolver;

  beforeEach(() => {
    config = new ConfigService();
    meta = new MetaResolver(config);
  });

  it('title() returns the default title verbatim, without the template, when the page supplies nothing', () => {
    expect(meta.title(null)).toBe(config.app.seo.defaultTitle);
    expect(meta.title(null)).not.toContain(config.app.seo.titleTemplate.replace('%s', ''));
  });

  it('title() wraps a supplied page title in the configured template', () => {
    expect(meta.title('Treatments')).toBe(config.app.seo.titleTemplate.replace('%s', 'Treatments'));
  });

  it('title() substitutes %s literally rather than treating the template as a format string — a stray % must not throw', () => {
    const resolver = new MetaResolver({
      app: { ...config.app, seo: { ...config.app.seo, titleTemplate: '%s | 50% off' } },
    } as unknown as ConfigService);

    expect(resolver.title('Sale')).toBe('Sale | 50% off');
  });

  it('description() tries candidates in order and skips blank ones before falling back to the default', () => {
    expect(meta.description(null, '  ', 'Real description')).toBe('Real description');
    expect(meta.description(null, '  ')).toBe(config.app.seo.defaultDescription);
  });

  it('canonical() builds an absolute URL from app.url and the canonicalised path', () => {
    const resolver = new MetaResolver({ app: { ...config.app, url: 'https://example.com' } } as unknown as ConfigService);

    expect(resolver.canonical('/treatments')).toBe('https://example.com/treatments/');
    expect(resolver.canonical('/')).toBe('https://example.com/');
  });

  it('social() shares the resolved title/description rather than re-resolving them', () => {
    const resolver = new MetaResolver({ app: { ...config.app, url: 'https://example.com' } } as unknown as ConfigService);
    const card = resolver.social('/treatments/', 'My Title', 'My Description');

    expect(card.title).toBe('My Title');
    expect(card.description).toBe('My Description');
    expect(card.url).toBe('https://example.com/treatments/');
    expect(card.image).toBeNull();
  });
});

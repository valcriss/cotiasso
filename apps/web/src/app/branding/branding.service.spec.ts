import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BrandingService, DEFAULT_BRANDING } from './branding.service';
import { MIN_TEXT_CONTRAST, contrastRatio } from './contrast';

describe('BrandingService', () => {
  let service: BrandingService;
  let http: HttpTestingController;

  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(BrandingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it("applique le nom et les couleurs de l'association à l'interface", async () => {
    const loading = service.load();
    http.expectOne('/api/branding').flush({ appName: 'Mon Asso', sidebarBackground: '#0b2a55', sidebarText: '#ffffff', accentColor: '#005cbb' });
    await loading;

    expect(service.branding().appName).toBe('Mon Asso');
    expect(document.documentElement.style.getPropertyValue('--app-sidebar-bg')).toBe('#0b2a55');
    expect(document.documentElement.style.getPropertyValue('--app-sidebar-text')).toBe('#ffffff');
    expect(document.title).toBe('Mon Asso');
  });

  it("donne le nom d'association à l'icône d'écran d'accueil et sa couleur à la barre du navigateur", () => {
    for (const name of ['apple-mobile-web-app-title', 'theme-color']) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', name);
      document.head.appendChild(meta);
    }
    service.apply({ ...DEFAULT_BRANDING, appName: 'Mon Asso', sidebarBackground: '#0b2a55' });
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('Mon Asso');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0b2a55');
    document.querySelectorAll('meta[name="apple-mobile-web-app-title"], meta[name="theme-color"]').forEach((meta) => meta.remove());
  });

  it("applique un accent personnalisé et revient au thème d'origine avec l'accent par défaut", async () => {
    const html = document.documentElement;
    service.apply({ ...DEFAULT_BRANDING, accentColor: '#7a1f4d' });
    expect(html.classList.contains('has-accent')).toBe(true);
    expect(html.style.getPropertyValue('--app-accent')).toBe('#7a1f4d');

    service.apply({ ...DEFAULT_BRANDING, accentColor: '#005CBB' });
    expect(html.classList.contains('has-accent')).toBe(false);
    expect(html.style.getPropertyValue('--app-accent')).toBe('');
  });

  it('garde les valeurs par défaut quand le serveur ne répond pas', async () => {
    const loading = service.load();
    http.expectOne('/api/branding').error(new ProgressEvent('error'));
    await loading;
    expect(service.branding()).toEqual(DEFAULT_BRANDING);
    expect(document.documentElement.style.getPropertyValue('--app-sidebar-bg')).toBe(DEFAULT_BRANDING.sidebarBackground);
  });
});

describe('contrastRatio', () => {
  it('reproduit les valeurs WCAG de référence', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('accepte les couleurs par défaut et refuse un couple illisible', () => {
    expect(contrastRatio(DEFAULT_BRANDING.sidebarText, DEFAULT_BRANDING.sidebarBackground)!).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio('#f4f4f4', '#ffffff')!).toBeLessThan(MIN_TEXT_CONTRAST);
  });

  it("renvoie null pour une couleur invalide", () => {
    expect(contrastRatio('rouge', '#ffffff')).toBeNull();
    expect(contrastRatio('#fff', '#ffffff')).toBeNull();
  });
});

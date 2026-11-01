import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const html = document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    html.classList.remove('theme-light', 'theme-dark', 'density-compact');
  });

  it('démarre selon le système, en densité confortable', () => {
    const service = TestBed.inject(ThemeService);
    service.init();
    expect(service.mode()).toBe('system');
    expect(service.density()).toBe('comfortable');
    expect(html.classList.contains('theme-light')).toBe(false);
    expect(html.classList.contains('theme-dark')).toBe(false);
    expect(html.classList.contains('density-compact')).toBe(false);
  });

  it('applique et conserve le mode et la densité choisis', () => {
    const service = TestBed.inject(ThemeService);
    service.init();
    service.setMode('dark');
    service.setDensity('compact');
    expect(html.classList.contains('theme-dark')).toBe(true);
    expect(html.classList.contains('density-compact')).toBe(true);
    expect(localStorage.getItem('cotiasso.theme.mode')).toBe('dark');
    expect(localStorage.getItem('cotiasso.theme.density')).toBe('compact');

    service.setMode('light');
    expect(html.classList.contains('theme-dark')).toBe(false);
    expect(html.classList.contains('theme-light')).toBe(true);
  });

  it('retrouve le choix au chargement suivant', () => {
    localStorage.setItem('cotiasso.theme.mode', 'dark');
    localStorage.setItem('cotiasso.theme.density', 'compact');
    const service = TestBed.inject(ThemeService);
    service.init();
    expect(service.mode()).toBe('dark');
    expect(service.density()).toBe('compact');
    expect(html.classList.contains('theme-dark')).toBe(true);
  });

  it('ignore une valeur conservée invalide', () => {
    localStorage.setItem('cotiasso.theme.mode', 'rose');
    localStorage.setItem('cotiasso.theme.density', '<script>');
    const service = TestBed.inject(ThemeService);
    service.init();
    expect(service.mode()).toBe('system');
    expect(service.density()).toBe('comfortable');
  });

  it("fonctionne sans stockage local (accès refusé par le navigateur)", () => {
    const service = TestBed.inject(ThemeService);
    const failing = () => {
      throw new Error('stockage bloqué');
    };
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(failing);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(failing);
    try {
      service.init();
      expect(service.mode()).toBe('system');
      expect(() => service.setMode('dark')).not.toThrow();
      expect(service.mode()).toBe('dark');
      expect(html.classList.contains('theme-dark')).toBe(true);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

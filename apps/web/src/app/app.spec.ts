import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { NAVIGATION } from './navigation';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('affiche la navigation du cadrage et les paramètres', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) =>
      a.textContent?.trim(),
    );
    expect(labels).toEqual([...NAVIGATION.map((item) => item.label), 'Paramètres'].map((l) => expect.stringContaining(l)));
  });

  it('replie le menu en conservant des libellés accessibles', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('button.toggle')!.click();
    await fixture.whenStable();
    expect(root.querySelector('.shell')!.classList).toContain('collapsed');
    expect(root.querySelector('button.toggle')!.getAttribute('aria-label')).toBe('Déplier le menu');
    expect(root.querySelectorAll('a.item span').length).toBe(0);
  });
});

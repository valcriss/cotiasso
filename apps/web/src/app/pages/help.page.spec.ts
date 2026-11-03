import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { GLOSSARY } from '../ui/glossary';
import { HelpHint } from '../ui/help-hint';
import { HelpPage } from './help.page';

describe('Aide et lexique (#12)', () => {
  const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('chaque mot du lexique a une définition, un exemple et son mot comptable quand il en existe un', () => {
    const entries = Object.entries(GLOSSARY);
    expect(entries.length).toBeGreaterThanOrEqual(15);
    for (const [key, entry] of entries) {
      expect(entry.simple.length, key).toBeGreaterThan(2);
      expect(entry.definition.length, key).toBeGreaterThan(30);
      expect(entry.example.length, key).toBeGreaterThan(10);
    }
  });

  it('affiche les gestes courants et tous les mots, puis filtre la recherche sans tenir compte de la casse ni des accents', async () => {
    await TestBed.configureTestingModule({ imports: [HelpPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(HelpPage);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Enregistrer une dépense');
    expect(root.textContent).toContain('Clôturer la période');
    expect(root.querySelectorAll('dl.glossary dt').length).toBe(Object.keys(GLOSSARY).length);

    const input = root.querySelector<HTMLInputElement>('input')!;
    input.value = 'EXERCICE';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    const found = Array.from(root.querySelectorAll('dl.glossary dt')).map((dt) => dt.textContent!.replace(/\s+/g, ' ').trim());
    expect(found.some((t) => t.startsWith('Période'))).toBe(true);
    expect(found.length).toBeLessThan(Object.keys(GLOSSARY).length);

    input.value = 'zzzzzz';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(root.textContent).toContain('Aucun mot ne correspond à « zzzzzz »');
  });

  it('l’aide contextuelle se déplie au clic, donne le mot comptable et se referme avec Échap', async () => {
    await TestBed.configureTestingModule({ imports: [HelpHint], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(HelpHint);
    fixture.componentRef.setInput('term', 'verifie');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-label')).toBe('Aide : Vérifié avec la banque');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[role="note"]')).toBeNull();

    button.click();
    await settle(fixture);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const note = root.querySelector('[role="note"]')!;
    expect(note.textContent).toContain('en comptabilité : Rapprochement bancaire');
    expect(note.textContent).toContain('Exemple :');
    expect(note.querySelector('a')!.getAttribute('href')).toBe('/aide#verifie');

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(root.querySelector('[role="note"]')).toBeNull();
  });
});

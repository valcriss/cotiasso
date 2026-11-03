import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './skeleton';

describe('Skeleton (#28)', () => {
  const render = async (variant: 'table' | 'cards' | 'text', rows?: number) => {
    await TestBed.configureTestingModule({ imports: [Skeleton] }).compileComponents();
    const fixture = TestBed.createComponent(Skeleton);
    fixture.componentRef.setInput('variant', variant);
    if (rows !== undefined) fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('annonce « Chargement… » aux lecteurs d’écran et cache les formes décoratives', async () => {
    const root = await render('table');
    const status = root.querySelector('[role="status"]')!;
    expect(status.querySelector('.sr-only')!.textContent).toBe('Chargement…');
    expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('dessine la forme annoncée : lignes de tableau, cartes ou lignes de texte, en nombre demandé', async () => {
    expect((await render('table', 6)).querySelectorAll('.row').length).toBe(6);
    TestBed.resetTestingModule();
    expect((await render('cards', 3)).querySelectorAll('.card').length).toBe(3);
    TestBed.resetTestingModule();
    expect((await render('text', 2)).querySelectorAll('p.bar').length).toBe(2);
  });
});

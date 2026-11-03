import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabsMenu } from './tabs-menu';

@Component({
  imports: [TabsMenu],
  template: `<nav class="tabs" appTabsMenu><a href="#a"><span>Écritures</span></a><a href="#b" class="active"><span>Balance</span></a></nav>`,
})
class Host {}

describe('TabsMenu', () => {
  it('ajoute un bouton « Rubrique : … » qui nomme la rubrique courante et déplie la liste', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const nav = (fixture.nativeElement as HTMLElement).querySelector('nav')!;
    const button = nav.querySelector<HTMLButtonElement>('.tabs-toggle')!;
    expect(button.textContent).toContain('Rubrique : Balance');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    expect(nav.classList).toContain('open');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    nav.querySelector<HTMLAnchorElement>('a')!.click();
    expect(nav.classList).not.toContain('open');
  });
});

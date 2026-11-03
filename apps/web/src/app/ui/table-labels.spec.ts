import { labelTable } from './table-labels';

function build(html: string): HTMLTableElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.querySelector('table')!;
}

describe('labelTable', () => {
  it("pose le libellé de la colonne sur chaque cellule, sauf l'en-tête de ligne et les cellules fusionnées", () => {
    const table = build(`
      <table class="table">
        <thead><tr><th>Nom</th><th><span class="sr-only">Invisible</span>Montant</th><th>Actions</th></tr></thead>
        <tbody>
          <tr><th scope="row">Cotisation</th><td>10,00 €</td><td></td></tr>
          <tr><td colspan="3">Rien à afficher</td></tr>
        </tbody>
      </table>`);
    labelTable(table);
    const cells = Array.from(table.querySelectorAll('tbody td, tbody th'));
    expect(cells[0].hasAttribute('data-label')).toBe(false);
    expect(cells[1].getAttribute('data-label')).toBe('Montant');
    expect(cells[2].getAttribute('data-label')).toBe('Actions');
    expect(cells[3].hasAttribute('data-label')).toBe(false);
  });

  it('suit les cellules fusionnées de l’en-tête et reste idempotent', () => {
    const table = build(`
      <table class="table">
        <thead><tr><th colspan="2">Identité</th><th>Total</th></tr></thead>
        <tbody><tr><td>a</td><td>b</td><td>c</td></tr></tbody>
      </table>`);
    labelTable(table);
    labelTable(table);
    const labels = Array.from(table.querySelectorAll('td')).map((cell) => cell.getAttribute('data-label'));
    expect(labels).toEqual(['Identité', 'Identité', 'Total']);
  });
});

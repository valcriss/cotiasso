import { Component, ElementRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  AdminApiService,
  type AccountInfo,
  type AllocationInfo,
  type EntryDraftBody,
  type EntryInfo,
  type JournalInfo,
  type ProjectInfo,
  type ThirdPartyInfo,
} from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { centsToApi, formatApiAmount, formatCents, parseAmountToCents } from './amount';
import { ThirdPartyDialog } from './third-party-dialog';

/** Valeur du sélecteur de projet pour une ligne déjà ventilée entre plusieurs projets : la ventilation est conservée. */
export const MULTI_PROJECT = '__multi';

export const ENTRY_STATUS_LABELS = {
  DRAFT: 'Brouillon',
  POSTED: 'Comptabilisée',
  REVERSED: 'Contrepassée',
} as const;

/**
 * Saisie, comptabilisation et contrepassation d'une écriture. Un brouillon est éditable avec totaux en direct ; une
 * écriture comptabilisée est en lecture seule (la base la rend immuable) et se contrepasse.
 */
@Component({
  selector: 'app-entry-editor',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .hint-panel {
      background: var(--app-surface-variant, var(--mat-sys-surface-container));
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0 0 16px;
      padding: 12px 16px;
    }
    .hint-panel p {
      margin: 0;
    }
    .hint-panel button {
      align-self: flex-start;
    }
    .amount {
      text-align: right;
      white-space: nowrap;
    }
    .balance {
      font-weight: 500;
      margin: 8px 0;
    }
    .num {
      font-variant-numeric: tabular-nums;
    }
    .lines {
      table-layout: fixed;
    }
    .lines th:nth-child(1),
    .lines td:nth-child(1) {
      width: 25%;
    }
    .lines th:nth-child(2),
    .lines td:nth-child(2) {
      width: 17%;
    }
    .lines th:nth-child(3),
    .lines td:nth-child(3) {
      width: 19%;
    }
    .lines th:nth-child(4),
    .lines td:nth-child(4),
    .lines th:nth-child(5),
    .lines td:nth-child(5) {
      width: 14%;
    }
    .lines th:nth-child(6),
    .lines td:nth-child(6) {
      width: 56px;
    }
    .lines mat-form-field {
      width: 100%;
    }
  `,
  template: `
    <section class="panel" aria-label="Écriture">
      <div class="head">
        <h3>
          @if (entry(); as e) {
            {{ e.label }}
            <span class="chip">{{ statusLabel(e.status) }}</span>
            @if (e.number !== null) {
              <span class="muted"> · {{ e.journalCode }} n° {{ e.number }}</span>
            }
          } @else {
            Nouvelle écriture
          }
        </h3>
        <button mat-button type="button" (click)="closed.emit()">Retour à la liste</button>
      </div>

      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
        @if (details().length > 0) {
          <ul>
            @for (detail of details(); track detail) {
              <li>{{ detail }}</li>
            }
          </ul>
        }
      }

      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (editable()) {
        <form [formGroup]="form" (ngSubmit)="save()" novalidate>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Journal</mat-label>
              <mat-select formControlName="journalId" required>
                @for (journal of journals(); track journal.id) {
                  <mat-option [value]="journal.id">{{ journal.code }} — {{ journal.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Date</mat-label>
              <input matInput type="date" formControlName="date" required />
            </mat-form-field>
            <mat-form-field appearance="outline" class="grow">
              <mat-label>Libellé</mat-label>
              <input matInput formControlName="label" required />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Référence</mat-label>
              <input matInput formControlName="reference" />
            </mat-form-field>
          </div>

          @if (missingProject().length > 0) {
            <section class="hint-panel" aria-label="Projet manquant">
              <strong>
                {{ missingProject().length === 1 ? 'Une ligne de dépense ou de recette n’a pas de projet' : missingProject().length + ' lignes de dépense ou de recette n’ont pas de projet' }}
              </strong>
              <p>
                Vous pouvez enregistrer en brouillon, mais pour comptabiliser, chaque dépense ou recette doit être rattachée à une activité (un projet) :
                c’est ce qui permet de savoir ce que chaque activité coûte et rapporte.
              </p>
              <p>
                À faire : choisissez le projet dans la colonne « Projet »
                @if (permanentProject(); as permanent) {
                  ou, pour les dépenses et recettes courantes de l’association, rattachez-les d’un clic à « {{ permanent.name }} ».
                } @else {
                  de chaque ligne concernée (lignes {{ missingLines() }}).
                }
              </p>
              @if (permanentProject(); as permanent) {
                <button mat-stroked-button type="button" (click)="attachToPermanent()">
                  Rattacher {{ missingProject().length === 1 ? 'cette ligne' : 'ces lignes' }} à « {{ permanent.name }} »
                </button>
              }
            </section>
          }

          <table class="table lines">
            <caption class="sr-only">Lignes de l'écriture</caption>
            <thead>
              <tr>
                <th scope="col">Compte</th>
                <th scope="col">Libellé de ligne</th>
                <th scope="col">Projet</th>
                <th scope="col">Qui ?</th>
                <th scope="col" class="amount">Débit</th>
                <th scope="col" class="amount">Crédit</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody formArrayName="lines">
              @for (line of lines.controls; track line; let i = $index) {
                <tr [formGroupName]="i">
                  <td>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>Compte</mat-label>
                      <mat-select formControlName="accountId" [attr.aria-label]="'Compte de la ligne ' + (i + 1)">
                        @for (account of accounts(); track account.id) {
                          <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                  </td>
                  <td>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>Libellé</mat-label>
                      <input matInput formControlName="label" />
                    </mat-form-field>
                  </td>
                  <td>
                    @if (needsProject(i)) {
                      <mat-form-field appearance="outline" subscriptSizing="dynamic">
                        <mat-label>Projet</mat-label>
                        <mat-select formControlName="projectId" [attr.aria-label]="'Projet de la ligne ' + (i + 1)">
                          <mat-option value="">Aucun</mat-option>
                          @if (isSplit(i)) {
                            <mat-option [value]="multi">Plusieurs projets</mat-option>
                          }
                          @for (project of projects(); track project.id) {
                            <mat-option [value]="project.id">{{ project.code }} — {{ project.name }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td>
                    @if (needsParty(i)) {
                      <mat-form-field appearance="outline" subscriptSizing="dynamic">
                        <mat-label>Qui ?</mat-label>
                        <mat-select formControlName="thirdPartyId" [attr.aria-label]="'Tiers de la ligne ' + (i + 1)">
                          <mat-option value="">Personne en particulier</mat-option>
                          @for (party of partyOptions(); track party.id) {
                            <mat-option [value]="party.id">{{ party.name }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>Débit</mat-label>
                      <input matInput class="amount" inputmode="decimal" formControlName="debit" />
                    </mat-form-field>
                  </td>
                  <td>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>Crédit</mat-label>
                      <input matInput class="amount" inputmode="decimal" formControlName="credit" />
                    </mat-form-field>
                  </td>
                  <td class="row-actions">
                    <button
                      mat-icon-button
                      type="button"
                      [attr.aria-label]="'Retirer la ligne ' + (i + 1)"
                      [disabled]="lines.length <= 2"
                      (click)="removeLine(i)"
                    >
                      <mat-icon fontSet="material-icons-outlined">delete</mat-icon>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4">
                  <button mat-button type="button" (click)="addLine()">+ Ajouter une ligne</button>
                  @if (canAddParty()) {
                    <button mat-button type="button" (click)="addParty()">+ Ajouter un tiers (adhérent, financeur, fournisseur…)</button>
                  }
                </td>
                <td class="amount num">{{ totals().debit }}</td>
                <td class="amount num">{{ totals().credit }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          @if (totals().invalid) {
            <p class="alert" role="alert">Un montant est invalide ou une ligne porte à la fois un débit et un crédit.</p>
          } @else if (totals().balanced) {
            <p class="balance success" role="status">Écriture équilibrée.</p>
          } @else {
            <p class="balance" role="status">Écart à équilibrer : {{ totals().gap }}</p>
          }

          <div class="actions">
            <button mat-flat-button type="submit" [disabled]="busy()"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">save</mat-icon> Enregistrer le brouillon</button>
            @if (canPost() && entry()) {
              <button mat-stroked-button type="button" [disabled]="busy()" (click)="saveAndPost()"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">task_alt</mat-icon> Comptabiliser</button>
            }
            @if (entry()) {
              <button mat-button class="danger" type="button" [disabled]="busy()" (click)="remove()">Supprimer le brouillon</button>
            }
          </div>
        </form>
      } @else if (entry(); as e) {
        <p class="muted">
          {{ e.journalCode }} · {{ e.date }}
          @if (e.reference) {
            · Réf. {{ e.reference }}
          }
          @if (e.reversalOfId) {
            · Contrepassation d'une écriture
          }
          @if (e.reversedById) {
            · Contrepassée par une écriture liée
          }
        </p>
        <table class="table">
          <caption class="sr-only">Lignes de l'écriture</caption>
          <thead>
            <tr>
              <th scope="col">Compte</th>
              <th scope="col">Libellé</th>
              <th scope="col">Projet</th>
              <th scope="col">Qui ?</th>
              <th scope="col" class="amount">Débit</th>
              <th scope="col" class="amount">Crédit</th>
            </tr>
          </thead>
          <tbody>
            @for (line of e.lines; track line.position) {
              <tr>
                <td>{{ line.accountNumber }} — {{ line.accountLabel }}</td>
                <td>{{ line.label }}</td>
                <td>{{ projectsOf(line.allocations) }}</td>
                <td>{{ line.thirdParty?.name ?? '' }}</td>
                <td class="amount num">{{ line.debit === '0.00' ? '' : format(line.debit) }}</td>
                <td class="amount num">{{ line.credit === '0.00' ? '' : format(line.credit) }}</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4">Totaux</td>
              <td class="amount num">{{ format(e.totalDebit) }}</td>
              <td class="amount num">{{ format(e.totalCredit) }}</td>
            </tr>
          </tfoot>
        </table>
        <p class="muted">Une écriture comptabilisée ne se modifie plus : pour corriger, contrepassez-la puis saisissez-en une nouvelle.</p>

        @if (canReverse()) {
          <form class="row" [formGroup]="reverseForm" (ngSubmit)="reverse()" novalidate>
            <mat-form-field appearance="outline">
              <mat-label>Date de la contrepassation</mat-label>
              <input matInput type="date" formControlName="date" />
            </mat-form-field>
            <button mat-stroked-button class="danger" type="submit" [disabled]="busy()">Contrepasser</button>
          </form>
        }
      }
    </section>
  `,
})
export class EntryEditor {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly notifier = inject(Notifier);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly dialogs = inject(Dialogs);
  private readonly fb = inject(FormBuilder).nonNullable;

  /** Identifiant de l'écriture à ouvrir, ou `null` pour une nouvelle. */
  readonly entryId = input<string | null>(null);
  readonly journals = input.required<JournalInfo[]>();
  readonly accounts = input.required<AccountInfo[]>();
  /** Projets proposés pour la ventilation (non archivés) ; vide si l'utilisateur ne peut pas les consulter. */
  readonly projects = input<ProjectInfo[]>([]);
  /** Tiers proposés (ADR 0030) : adhérents, financeurs, fournisseurs…; vide si la personne ne peut pas les consulter. */
  readonly thirdParties = input<ThirdPartyInfo[]>([]);
  /** Tiers ajoutés depuis cet écran ou déjà portés par l'écriture ouverte (même archivés, pour qu'ils restent lisibles). */
  private readonly addedParties = signal<ThirdPartyInfo[]>([]);
  protected readonly partyOptions = computed(() => {
    const seen = new Set<string>();
    return [...this.thirdParties(), ...this.addedParties()].filter((p) => !seen.has(p.id) && seen.add(p.id));
  });
  /** Émis quand la liste doit être rechargée ; `id` désigne l'écriture à garder ouverte, absent si elle disparaît. */
  readonly changed = output<{ id: string | null }>();
  readonly closed = output<void>();

  protected readonly entry = signal<EntryInfo | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly canCreate = computed(() => {
    this.auth.permissions();
    return this.auth.can('entries:create');
  });
  protected readonly canPost = computed(() => {
    this.auth.permissions();
    return this.auth.can('entries:post');
  });
  protected readonly editable = computed(() => {
    const current = this.entry();
    return this.canCreate() && (current === null || current.status === 'DRAFT');
  });
  protected readonly canReverse = computed(() => {
    const current = this.entry();
    return this.canPost() && current?.status === 'POSTED' && current.kind !== 'REVERSAL';
  });

  protected readonly form = this.fb.group({
    journalId: ['', [Validators.required]],
    date: ['', [Validators.required]],
    label: ['', [Validators.required]],
    reference: [''],
    lines: this.fb.array([this.newLine(), this.newLine()]),
  });
  protected readonly reverseForm = this.fb.group({ date: [''] });

  private readonly linesChanged = signal(0);
  protected readonly totals = computed(() => {
    this.linesChanged();
    let debit = 0;
    let credit = 0;
    let invalid = false;
    for (const line of this.lines.getRawValue()) {
      const d = parseAmountToCents(line.debit);
      const c = parseAmountToCents(line.credit);
      if (d === null || c === null || (d > 0 && c > 0)) {
        invalid = true;
        continue;
      }
      debit += d;
      credit += c;
    }
    return {
      debit: formatCents(debit),
      credit: formatCents(credit),
      invalid,
      balanced: !invalid && debit === credit && debit > 0,
      gap: formatCents(Math.abs(debit - credit)),
    };
  });

  /** Règle « projet obligatoire » en vigueur : sans elle, aucune aide n'est affichée. Inconnue (droit manquant) = absente. */
  private readonly projectRule = signal(false);
  /** Lignes de charge ou de produit sans projet, tant que la règle l'exige. */
  protected readonly missingProject = computed(() => {
    this.linesChanged();
    if (!this.projectRule() || !this.editable()) return [];
    return this.lines.controls.map((_, i) => i).filter((i) => this.needsProject(i) && this.lines.at(i).getRawValue().projectId === '');
  });
  protected readonly missingLines = computed(() => this.missingProject().map((i) => i + 1).join(', '));
  protected readonly permanentProject = computed(() => this.projects().find((p) => p.permanent && p.status !== 'ARCHIVED') ?? null);

  protected attachToPermanent(): void {
    const permanent = this.permanentProject();
    if (!permanent) return;
    for (const index of this.missingProject()) this.lines.at(index).patchValue({ projectId: permanent.id });
    this.form.markAsDirty();
  }

  protected readonly format = formatApiAmount;
  protected readonly multi = MULTI_PROJECT;

  constructor() {
    this.form.valueChanges.subscribe(() => this.linesChanged.update((n) => n + 1));
    this.api
      .accountingSettings()
      .then((rules) => this.projectRule.set(rules.projectRequired))
      .catch(() => undefined);
    effect(() => {
      const id = this.entryId();
      void this.open(id);
    });
  }

  protected get lines(): FormArray {
    return this.form.controls.lines;
  }

  protected statusLabel(status: EntryInfo['status']): string {
    return ENTRY_STATUS_LABELS[status];
  }

  /** Une ligne de charge ou de produit (classes 6 et 7) se ventile par projet ; les autres non. */
  protected needsProject(index: number): boolean {
    const id = this.lines.at(index).getRawValue().accountId;
    return /^[67]/.test(this.accounts().find((a) => a.id === id)?.number ?? '');
  }

  /** Le tiers se demande sur les comptes de tiers (classe 4) et là où il est déjà renseigné. */
  protected needsParty(index: number): boolean {
    const raw = this.lines.at(index).getRawValue();
    return raw.thirdPartyId !== '' || /^4/.test(this.accounts().find((a) => a.id === raw.accountId)?.number ?? '');
  }

  protected canAddParty(): boolean {
    return this.auth.can('entries:create');
  }

  protected async addParty(): Promise<void> {
    const created = await this.dialogs.open<ThirdPartyInfo>(ThirdPartyDialog, { size: 'md' });
    if (created) {
      this.addedParties.update((list) => [...list, created]);
      this.notifier.success(`« ${created.name} » ajouté aux tiers.`);
    }
  }

  protected isSplit(index: number): boolean {
    return this.lines.at(index).getRawValue().projectId === MULTI_PROJECT;
  }

  protected projectsOf(allocations: AllocationInfo[]): string {
    return allocations.map((a) => (allocations.length > 1 ? `${a.projectCode} (${formatApiAmount(a.amount)})` : a.projectCode)).join(', ');
  }

  protected addLine(): void {
    this.lines.push(this.newLine());
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
  }

  protected save(): Promise<EntryInfo | null> {
    return this.run(async () => {
      const body = this.body();
      if (!body) return null;
      const current = this.entry();
      const saved = current
        ? await this.api.updateEntry(current.id, { ...body, version: current.version })
        : await this.api.createEntry(body);
      this.show(saved);
      this.notifier.success('Brouillon enregistré.');
      this.changed.emit({ id: saved.id });
      return saved;
    });
  }

  protected async saveAndPost(): Promise<void> {
    // Une écriture équilibrée va être figée : on montre la conséquence avant (sinon l'enregistrement signalera ce qui manque).
    if (this.totals().balanced) {
      const confirmed = await this.dialogs.confirm({
        title: 'Comptabiliser cette écriture ?',
        message: `Total : ${this.totals().debit} € au débit et au crédit. Une fois comptabilisée, l’écriture reçoit son numéro et ne peut plus être modifiée ni supprimée. En cas d’erreur, vous pourrez la contrepasser (l’annuler par une écriture inverse) puis en saisir une nouvelle.`,
        confirmLabel: 'Comptabiliser',
      });
      if (!confirmed) return;
    }
    const saved = await this.save();
    if (!saved) return;
    await this.run(async () => {
      const posted = await this.api.postEntry(saved.id);
      this.show(posted);
      this.notifier.success(`Écriture comptabilisée : ${posted.journalCode} n° ${posted.number}.`);
      this.changed.emit({ id: posted.id });
      return posted;
    });
  }

  protected async remove(): Promise<void> {
    const current = this.entry();
    if (!current) return;
    await this.run(async () => {
      await this.api.deleteEntry(current.id);
      this.notifier.success('Brouillon supprimé.');
      this.changed.emit({ id: null });
      this.closed.emit();
      return null;
    });
  }

  protected async reverse(): Promise<void> {
    const current = this.entry();
    if (!current) return;
    const date = this.reverseForm.getRawValue().date;
    await this.run(async () => {
      const reversal = await this.api.reverseEntry(current.id, date ? { date } : {});
      this.show(await this.api.getEntry(current.id));
      this.notifier.success(`Contrepassation comptabilisée : ${reversal.journalCode} n° ${reversal.number}.`);
      this.changed.emit({ id: current.id });
      return reversal;
    });
  }

  private async open(id: string | null): Promise<void> {
    // L'écriture vient d'être enregistrée ici même : inutile de la recharger (et de perdre le message affiché).
    if (id !== null && this.entry()?.id === id) return;
    this.error.set(null);
    this.details.set([]);
    if (id === null) {
      this.entry.set(null);
      this.reset();
      return;
    }
    this.loading.set(true);
    try {
      this.show(await this.api.getEntry(id));
    } catch (failure) {
      this.setError(failure, "Impossible de charger l'écriture.");
    } finally {
      this.loading.set(false);
    }
  }

  private show(entry: EntryInfo): void {
    this.entry.set(entry);
    this.reset(entry);
  }

  private reset(entry?: EntryInfo): void {
    this.lines.clear();
    const source = entry?.lines ?? [];
    for (const line of source) {
      this.lines.push(
        this.newLine({
          accountId: line.accountId,
          label: line.label ?? '',
          debit: line.debit === '0.00' ? '' : line.debit,
          credit: line.credit === '0.00' ? '' : line.credit,
          projectId: line.allocations.length === 0 ? '' : line.allocations.length === 1 ? line.allocations[0]!.projectId : MULTI_PROJECT,
          splits: line.allocations,
          thirdPartyId: line.thirdParty?.id ?? '',
        }),
      );
      if (line.thirdParty) {
        const known = line.thirdParty;
        this.addedParties.update((list) => (list.some((p) => p.id === known.id) ? list : [...list, { id: known.id, kind: known.kind, name: known.name, memberId: null, funderId: null, note: '', archived: false }]));
      }
    }
    while (this.lines.length < 2) this.lines.push(this.newLine());
    this.form.patchValue({
      journalId: entry?.journalId ?? this.journals().find((j) => j.active && j.type === 'MISC')?.id ?? '',
      date: entry?.date ?? '',
      label: entry?.label ?? '',
      reference: entry?.reference ?? '',
    });
    this.reverseForm.patchValue({ date: entry?.date ?? '' });
  }

  private newLine(
    value: { accountId?: string; label?: string; debit?: string; credit?: string; projectId?: string; splits?: AllocationInfo[]; thirdPartyId?: string } = {},
  ) {
    return this.fb.group({
      accountId: [value.accountId ?? '', [Validators.required]],
      label: [value.label ?? ''],
      debit: [value.debit ?? ''],
      credit: [value.credit ?? ''],
      projectId: [value.projectId ?? ''],
      thirdPartyId: [value.thirdPartyId ?? ''],
      // Ventilation entre plusieurs projets, conservée telle quelle tant que l'utilisateur ne la remplace pas.
      splits: [value.splits ?? ([] as AllocationInfo[])],
    });
  }

  /** Corps envoyé à l'API, ou `null` (avec un message) si la saisie est incomplète ou invalide. */
  private body(): EntryDraftBody | null {
    const raw = this.form.getRawValue();
    if (!raw.journalId || !raw.date || raw.label.trim() === '') {
      this.error.set('Renseignez le journal, la date et le libellé.');
      return null;
    }
    const lines: EntryDraftBody['lines'] = [];
    for (const [index, line] of raw.lines.entries()) {
      const debit = parseAmountToCents(line.debit);
      const credit = parseAmountToCents(line.credit);
      const empty = !line.accountId && !debit && !credit;
      if (empty) continue;
      if (!line.accountId) {
        this.error.set(`Ligne ${index + 1} : choisissez un compte.`);
        return null;
      }
      if (debit === null || credit === null) {
        this.error.set(`Ligne ${index + 1} : montant invalide (ex. 12,50).`);
        return null;
      }
      if (debit > 0 && credit > 0) {
        this.error.set(`Ligne ${index + 1} : un débit et un crédit à la fois ne sont pas permis.`);
        return null;
      }
      if (debit === 0 && credit === 0) {
        this.error.set(`Ligne ${index + 1} : saisissez un montant.`);
        return null;
      }
      const amount = centsToApi(debit > 0 ? debit : credit);
      const analytic = /^[67]/.test(this.accounts().find((a) => a.id === line.accountId)?.number ?? '');
      const allocations: AllocationInfo[] =
        !analytic || line.projectId === ''
          ? []
          : line.projectId === MULTI_PROJECT
            ? line.splits.map((s) => ({ projectId: s.projectId, amount: s.amount }))
            : [{ projectId: line.projectId, amount }];
      lines.push({
        accountId: line.accountId,
        debit: centsToApi(debit),
        credit: centsToApi(credit),
        ...(line.label.trim() !== '' && { label: line.label.trim() }),
        ...(allocations.length > 0 && { allocations }),
        ...(line.thirdPartyId !== '' && { thirdPartyId: line.thirdPartyId }),
      });
    }
    return {
      journalId: raw.journalId,
      date: raw.date,
      label: raw.label.trim(),
      reference: raw.reference.trim() === '' ? null : raw.reference.trim(),
      lines,
    };
  }

  private async run<T>(action: () => Promise<T>): Promise<T | null> {
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      return await action();
    } catch (failure) {
      this.setError(failure, "L'opération a échoué. Réessayez.");
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  private setError(failure: unknown, fallback: string): void {
    const described = describeHttpError(failure, fallback);
    this.error.set(described.message);
    this.details.set(described.details);
    // Le formulaire est long : le bouton d'action est en bas, le message en haut. On amène le message à l'écran.
    setTimeout(() => this.host.nativeElement.querySelector('[role="alert"]')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }));
  }
}

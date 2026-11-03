import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { debounceTime } from 'rxjs';
import { AdminApiService, type GrantInfo, type GrantScheduleInfo, type MemberInfo, type MembershipInfo } from '../admin/admin-api.service';
import { formatApiAmount, parseAmountToCents } from '../accounting/amount';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { FrDatePipe } from '../ui/fr-date.pipe';

/** Ce à quoi l'argent reçu est rattaché, en plus de son enregistrement dans les comptes (ADR 0023 et 0024 : deux mécanismes distincts). */
export type LinkTarget =
  | { kind: 'MEMBERSHIP'; membershipId: string; memberName: string; campaignName: string }
  | { kind: 'GRANT'; grantId: string; scheduleId: string | null; funderName: string; title: string };

export interface LinkPick {
  target: LinkTarget | null;
  /** Description proposée (« Cotisation de Marie Dupont »), reprise si la personne n'a encore rien écrit. */
  label?: string;
  /** Montant proposé en centimes (le reste dû), repris si la personne n'a encore rien écrit. */
  amountCents?: number;
}

/**
 * « De qui vient cet argent ? » dans la saisie « J'ai reçu de l'argent » (#4) : pour une cotisation, on choisit le membre et sa
 * cotisation ; pour une subvention, la subvention accordée et, facultativement, l'échéance. Le rattachement n'est qu'un
 * complément : on peut toujours enregistrer l'argent sans le rattacher. Rien ne s'affiche sans le droit correspondant.
 */
@Component({
  selector: 'app-operation-link',
  imports: [FrDatePipe, ReactiveFormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    @if (usage() === 'MEMBERSHIP' && canMembers()) {
      <fieldset class="link">
        <legend>De quel membre ?</legend>
        <p class="muted">Choisissez la personne : sa cotisation sera marquée comme payée, en plus de l’enregistrement de l’argent.</p>
        <mat-form-field appearance="outline">
          <mat-label>Nom ou prénom du membre (facultatif)</mat-label>
          <input matInput [formControl]="search" [matAutocomplete]="members" autocomplete="off" />
          <mat-autocomplete #members="matAutocomplete" (optionSelected)="chooseMember($event.option.value)" [displayWith]="memberName">
            @for (member of memberResults(); track member.id) {
              <mat-option [value]="member">{{ member.lastName }} {{ member.firstName }}@if (member.email) { <span class="muted"> — {{ member.email }}</span> }</mat-option>
            }
          </mat-autocomplete>
          @if (searching()) {
            <mat-hint>Recherche…</mat-hint>
          } @else if (typed().length >= 2 && !member() && memberResults().length === 0) {
            <mat-hint>Aucun membre actuel ne correspond. L’argent sera enregistré sans être rattaché à une cotisation.</mat-hint>
          }
        </mat-form-field>
        @if (member(); as chosen) {
          @if (dueMemberships().length > 0) {
            <mat-form-field appearance="outline">
              <mat-label>Quelle cotisation ?</mat-label>
              <mat-select [formControl]="membershipId" (selectionChange)="pickMembership()">
                @for (m of dueMemberships(); track m.id) {
                  <mat-option [value]="m.id">{{ m.campaignName }} — reste {{ amount(m.balance) }} €</mat-option>
                }
                <mat-option value="">Ne pas rattacher à une cotisation</mat-option>
              </mat-select>
              <mat-hint>Seules les cotisations qui restent à payer sont proposées.</mat-hint>
            </mat-form-field>
          } @else if (!loadingMemberships()) {
            <p class="muted" role="status">
              {{ chosen.firstName }} {{ chosen.lastName }} n’a aucune cotisation à payer pour le moment. L’argent sera enregistré sans être rattaché ; pour
              inscrire cette personne à une saison, ouvrez « Membres et cotisations ».
            </p>
          }
        }
        @if (error(); as message) {
          <p class="alert" role="alert">{{ message }}</p>
        }
      </fieldset>
    }

    @if (usage() === 'GRANT' && canGrants()) {
      <fieldset class="link">
        <legend>De quelle subvention ?</legend>
        <p class="muted">Choisissez la subvention accordée : le versement sera noté dans son suivi, en plus de l’enregistrement de l’argent.</p>
        @if (grants().length === 0 && !loadingGrants()) {
          <p class="muted" role="status">Aucune subvention accordée à rattacher pour le moment. L’argent sera enregistré sans être rattaché.</p>
        } @else {
          <mat-form-field appearance="outline">
            <mat-label>Subvention (facultatif)</mat-label>
            <mat-select [formControl]="grantId" (selectionChange)="pickGrant()">
              <mat-option value="">Ne pas rattacher à une subvention</mat-option>
              @for (grant of grants(); track grant.id) {
                <mat-option [value]="grant.id">{{ grant.funder.name }} — {{ grant.title }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        @if (grantId.value && schedule().length > 0) {
          <mat-form-field appearance="outline">
            <mat-label>Quelle échéance ? (facultatif)</mat-label>
            <mat-select [formControl]="scheduleId" (selectionChange)="pickSchedule()">
              <mat-option value="">Aucune échéance en particulier</mat-option>
              @for (line of schedule(); track line.id) {
                <mat-option [value]="line.id">{{ line.dueOn | frDate }} — {{ amount(line.amount) }} € attendus</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        @if (error(); as message) {
          <p class="alert" role="alert">{{ message }}</p>
        }
      </fieldset>
    }
  `,
  styles: `
    .link {
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 8px 12px;
    }
    .link legend {
      font-weight: 500;
      padding: 0 4px;
    }
    .link p {
      margin: 0;
    }
  `,
})
export class OperationLink {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);

  readonly usage = input<'MEMBERSHIP' | 'GRANT' | null>(null);
  readonly picked = output<LinkPick>();

  protected readonly amount = formatApiAmount;
  protected readonly canMembers = computed(() => {
    this.auth.permissions();
    return this.auth.can('members:view') && this.auth.can('members:manage');
  });
  protected readonly canGrants = computed(() => {
    this.auth.permissions();
    return this.auth.can('grants:view') && this.auth.can('grants:manage');
  });
  protected readonly error = signal<string | null>(null);

  // Cotisation
  protected readonly search = new FormControl<string | MemberInfo>('', { nonNullable: true });
  protected readonly membershipId = new FormControl('', { nonNullable: true });
  protected readonly member = signal<MemberInfo | null>(null);
  protected readonly memberResults = signal<MemberInfo[]>([]);
  protected readonly searching = signal(false);
  protected readonly loadingMemberships = signal(false);
  private readonly memberships = signal<MembershipInfo[]>([]);
  protected readonly dueMemberships = computed(() => this.memberships().filter((m) => m.status !== 'CANCELLED' && (parseAmountToCents(m.balance) ?? 0) > 0));

  // Subvention
  protected readonly grantId = new FormControl('', { nonNullable: true });
  protected readonly scheduleId = new FormControl('', { nonNullable: true });
  protected readonly grants = signal<GrantInfo[]>([]);
  protected readonly loadingGrants = signal(false);
  protected readonly schedule = signal<GrantScheduleInfo[]>([]);
  private grantsRequested = false;

  constructor() {
    this.search.valueChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe((value) => void this.lookup(value));
    // Un changement de catégorie efface le rattachement choisi pour l'autre rôle.
    effect(() => {
      const usage = this.usage();
      untracked(() => {
        this.reset();
        if (usage === 'GRANT' && this.canGrants() && !this.grantsRequested) void this.loadGrants();
      });
    });
  }

  /** Texte tapé dans la recherche (la valeur est un membre une fois choisi dans la liste). */
  protected typed(): string {
    const value = this.search.value;
    return typeof value === 'string' ? value.trim() : '';
  }

  protected memberName = (value: MemberInfo | string | null): string => (value && typeof value !== 'string' ? `${value.lastName} ${value.firstName}` : (value ?? ''));

  private reset(): void {
    this.error.set(null);
    this.member.set(null);
    this.memberships.set([]);
    this.memberResults.set([]);
    this.search.setValue('', { emitEvent: false });
    this.membershipId.setValue('', { emitEvent: false });
    this.grantId.setValue('', { emitEvent: false });
    this.scheduleId.setValue('', { emitEvent: false });
    this.schedule.set([]);
    this.picked.emit({ target: null });
  }

  private async lookup(value: string | MemberInfo): Promise<void> {
    if (typeof value !== 'string') return; // une personne vient d'être choisie dans la liste
    // Retaper le nom après un choix annule ce choix : le rattachement ne doit pas rester sur la personne précédente.
    if (this.member()) {
      this.member.set(null);
      this.memberships.set([]);
      this.membershipId.setValue('', { emitEvent: false });
      this.picked.emit({ target: null });
    }
    const text = value.trim();
    if (text.length < 2) {
      this.memberResults.set([]);
      return;
    }
    this.searching.set(true);
    try {
      this.memberResults.set((await this.api.listMembers({ q: text, status: 'ACTIVE' })).members.slice(0, 20));
    } catch {
      this.memberResults.set([]);
    } finally {
      this.searching.set(false);
    }
  }

  protected async chooseMember(chosen: MemberInfo): Promise<void> {
    this.member.set(chosen);
    this.error.set(null);
    this.loadingMemberships.set(true);
    try {
      this.memberships.set(await this.api.listMemberMemberships(chosen.id));
    } catch (failure) {
      this.memberships.set([]);
      this.error.set(describeHttpError(failure, 'Impossible de charger les cotisations de ce membre. L’argent peut être enregistré sans être rattaché.').message);
    } finally {
      this.loadingMemberships.set(false);
    }
    // Une seule cotisation à payer : c'est forcément celle-là.
    const due = this.dueMemberships();
    this.membershipId.setValue(due.length === 1 ? due[0]!.id : '', { emitEvent: false });
    this.pickMembership();
  }

  protected pickMembership(): void {
    const chosen = this.member();
    const membership = this.dueMemberships().find((m) => m.id === this.membershipId.value);
    if (!chosen || !membership) {
      this.picked.emit({ target: null, ...(chosen && { label: `Cotisation de ${chosen.firstName} ${chosen.lastName}` }) });
      return;
    }
    this.picked.emit({
      target: { kind: 'MEMBERSHIP', membershipId: membership.id, memberName: `${chosen.firstName} ${chosen.lastName}`, campaignName: membership.campaignName },
      label: `Cotisation de ${chosen.firstName} ${chosen.lastName}`,
      ...(parseAmountToCents(membership.balance) ? { amountCents: parseAmountToCents(membership.balance)! } : {}),
    });
  }

  private async loadGrants(): Promise<void> {
    this.grantsRequested = true;
    this.loadingGrants.set(true);
    try {
      this.grants.set(await this.api.listGrants({ status: 'GRANTED' }));
    } catch (failure) {
      this.grants.set([]);
      this.error.set(describeHttpError(failure, 'Impossible de charger les subventions. L’argent peut être enregistré sans être rattaché.').message);
    } finally {
      this.loadingGrants.set(false);
    }
  }

  protected async pickGrant(): Promise<void> {
    this.scheduleId.setValue('', { emitEvent: false });
    this.schedule.set([]);
    const grant = this.grants().find((g) => g.id === this.grantId.value);
    if (!grant) {
      this.picked.emit({ target: null });
      return;
    }
    this.error.set(null);
    try {
      this.schedule.set((await this.api.grantFinance(grant.id)).schedule.filter((line) => line.state !== 'RECEIVED'));
    } catch {
      this.schedule.set([]); // sans échéance, le versement se rattache à la subvention seule
    }
    this.emitGrant(grant, null);
  }

  protected pickSchedule(): void {
    const grant = this.grants().find((g) => g.id === this.grantId.value);
    if (grant) this.emitGrant(grant, this.schedule().find((line) => line.id === this.scheduleId.value) ?? null);
  }

  private emitGrant(grant: GrantInfo, line: GrantScheduleInfo | null): void {
    const remaining = line ? (parseAmountToCents(line.amount) ?? 0) - (parseAmountToCents(line.received) ?? 0) : 0;
    this.picked.emit({
      target: { kind: 'GRANT', grantId: grant.id, scheduleId: line?.id ?? null, funderName: grant.funder.name, title: grant.title },
      label: `Versement de ${grant.funder.name}`,
      ...(remaining > 0 ? { amountCents: remaining } : {}),
    });
  }
}

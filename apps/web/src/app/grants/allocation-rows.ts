import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import type { AllocationBody, GrantAllocationInfo } from '../admin/admin-api.service';
import { centsToApi, formatCents, parseAmountToCents } from '../accounting/amount';

export type AllocationRow = FormGroup<{ projectId: FormControl<string>; amount: FormControl<string> }>;

const positiveAmount = (control: { value: string }) => {
  const cents = parseAmountToCents(control.value);
  return cents === null || cents <= 0 ? { amount: true } : null;
};

/** Une ligne de répartition : un projet et la part qui lui revient. */
export function newAllocationRow(initial?: { projectId: string; amount: string }): AllocationRow {
  return new FormGroup({
    projectId: new FormControl(initial?.projectId ?? '', { nonNullable: true, validators: [Validators.required] }),
    amount: new FormControl(initial ? formatCents(parseAmountToCents(initial.amount) ?? 0).replace(/\s/g, '') : '', {
      nonNullable: true,
      validators: [Validators.required, positiveAmount],
    }),
  });
}

export function allocationRows(allocations: readonly GrantAllocationInfo[]): FormArray<AllocationRow> {
  return new FormArray(allocations.map((a) => newAllocationRow(a)));
}

/** Parts saisies, converties en décimales exactes pour l'API. */
export function readAllocations(rows: FormArray<AllocationRow>): AllocationBody[] {
  return rows.getRawValue().map((row) => ({ projectId: row.projectId, amount: centsToApi(parseAmountToCents(row.amount) ?? 0) }));
}

/** Total des parts valides, en centimes entiers. */
export function allocationTotalCents(rows: FormArray<AllocationRow>): number {
  let total = 0;
  for (const row of rows.getRawValue()) {
    const cents = parseAmountToCents(row.amount);
    if (cents !== null && cents > 0) total += cents;
  }
  return total;
}

import { Decimal } from "decimal.js";

const AMOUNT_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/**
 * Montant en euros avec deux décimales exactes. Immuable.
 * Les montants circulent en chaînes décimales ("12.50"), jamais en `number`.
 */
export class Money {
  private constructor(private readonly value: Decimal) {}

  static zero(): Money {
    return new Money(new Decimal(0));
  }

  static parse(input: string): Money {
    if (typeof input !== "string" || !AMOUNT_PATTERN.test(input)) {
      throw new RangeError(`Montant invalide : ${JSON.stringify(input)}`);
    }
    return new Money(new Decimal(input));
  }

  add(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  subtract(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  equals(other: Money): boolean {
    return this.value.equals(other.value);
  }

  compare(other: Money): -1 | 0 | 1 {
    return this.value.comparedTo(other.value) as -1 | 0 | 1;
  }

  toString(): string {
    return this.value.toFixed(2);
  }
}

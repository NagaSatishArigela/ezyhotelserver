import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { LedgerAccount, LedgerDirection, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface LedgerLeg {
  account: LedgerAccount;
  direction: LedgerDirection;
  amountPaise: number;
  memo?: string;
}

export interface LedgerTxn {
  txnRef: string;
  refType: 'booking' | 'payout_item';
  refId: string;
  legs: LedgerLeg[];
}

/**
 * Append-only double-entry ledger (Layer C). Every posted transaction MUST
 * balance: total debits === total credits. This is enforced here so no caller
 * can write a lopsided entry set — the single guarantee that makes the ledger
 * reconcilable.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Balanced set of legs for a transaction. Amounts must be positive integers. */
  private assertBalanced(txn: LedgerTxn): void {
    if (txn.legs.length < 2) {
      throw new InternalServerErrorException('Ledger transaction needs at least two legs.');
    }
    let debit = 0;
    let credit = 0;
    for (const leg of txn.legs) {
      if (!Number.isInteger(leg.amountPaise) || leg.amountPaise <= 0) {
        throw new InternalServerErrorException('Ledger legs must have positive integer paise amounts.');
      }
      if (leg.direction === LedgerDirection.debit) debit += leg.amountPaise;
      else credit += leg.amountPaise;
    }
    if (debit !== credit) {
      throw new InternalServerErrorException(
        `Unbalanced ledger transaction ${txn.txnRef}: debit ${debit} ≠ credit ${credit}.`,
      );
    }
  }

  /**
   * Post a balanced transaction. Pass a Prisma transaction client (`tx`) to
   * write the ledger atomically with the domain state change (booking confirm,
   * payout release); omit it to post standalone.
   */
  async post(txn: LedgerTxn, tx?: Prisma.TransactionClient): Promise<void> {
    this.assertBalanced(txn);
    const client = tx ?? this.prisma;
    await client.ledgerEntry.createMany({
      data: txn.legs.map((leg) => ({
        txnRef: txn.txnRef,
        account: leg.account,
        direction: leg.direction,
        amountPaise: leg.amountPaise,
        refType: txn.refType,
        refId: txn.refId,
        memo: leg.memo ?? null,
      })),
    });
  }

  /**
   * Net balance per account (credit − debit) across the whole ledger, in paise.
   * Used by reconciliation checks/reports.
   */
  async balances(): Promise<Record<string, number>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['account', 'direction'],
      _sum: { amountPaise: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) {
      const amt = r._sum.amountPaise ?? 0;
      const signed = r.direction === LedgerDirection.credit ? amt : -amt;
      out[r.account] = (out[r.account] ?? 0) + signed;
    }
    return out;
  }
}

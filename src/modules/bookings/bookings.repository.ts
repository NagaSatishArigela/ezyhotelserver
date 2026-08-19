import { Injectable } from '@nestjs/common';
import { Booking, BookingStatus, Prisma, Property, RoomType } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';

const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.pending_payment,
  BookingStatus.confirmed,
  BookingStatus.checked_in,
];

export class SlotUnavailableError extends Error {}

@Injectable()
export class BookingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Cross-schema application-level lookups (read-only, no FK) - see
  // schema.prisma "Modular-monolith data isolation rule" comment.
  findProperty(id: string): Promise<Property | null> {
    return this.prisma.property.findUnique({ where: { id } });
  }

  findRoomType(id: string): Promise<RoomType | null> {
    return this.prisma.roomType.findUnique({ where: { id } });
  }

  findById(id: string): Promise<Booking | null> {
    return this.prisma.booking.findUnique({ where: { id } });
  }

  // bookingRef is a UNIQUE column. Generate a candidate with wide entropy and
  // pre-check it against the DB, retrying on the (rare) collision so a clash
  // never surfaces as an unhandled P2002 500 at insert time.
  async generateBookingRef(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const ref = `PPH-B-${randomBytes(5).toString('hex').toUpperCase()}`;
      const existing = await this.prisma.booking.findUnique({
        where: { bookingRef: ref },
        select: { id: true },
      });
      if (!existing) return ref;
    }
    // Astronomically unlikely to reach here; fall back to maximum entropy.
    return `PPH-B-${randomBytes(8).toString('hex').toUpperCase()}`;
  }

  // Used by admin "extend" (M5 spec §3.5): does any other active booking for
  // this room type overlap the proposed new interval?
  async hasOverlap(
    roomTypeId: string,
    checkInAt: Date,
    checkOutAt: Date,
    excludeBookingId: string,
  ): Promise<boolean> {
    const count = await this.prisma.booking.count({
      where: {
        roomTypeId,
        id: { not: excludeBookingId },
        status: { in: ACTIVE_STATUSES },
        checkInAt: { lt: checkOutAt },
        checkOutAt: { gt: checkInAt },
      },
    });
    return count > 0;
  }

  findOverlappingForAvailability(roomTypeId: string, dayStart: Date, dayEnd: Date) {
    return this.prisma.booking.findMany({
      where: {
        roomTypeId,
        status: { in: ACTIVE_STATUSES },
        checkInAt: { lt: dayEnd },
        checkOutAt: { gt: dayStart },
      },
      select: { checkInAt: true, checkOutAt: true },
    });
  }

  async createWithOverlapCheck(
    data: Prisma.BookingCreateInput,
    roomTypeId: string,
    roomCount: number,
    checkInAt: Date,
    checkOutAt: Date,
  ): Promise<Booking> {
    return this.prisma.$transaction(
      async (tx) => {
        const overlapping = await tx.booking.count({
          where: {
            roomTypeId,
            status: { in: ACTIVE_STATUSES },
            checkInAt: { lt: checkOutAt },
            checkOutAt: { gt: checkInAt },
          },
        });
        if (overlapping >= roomCount) {
          throw new SlotUnavailableError();
        }
        return tx.booking.create({ data });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  update(id: string, data: Prisma.BookingUpdateInput): Promise<Booking> {
    return this.prisma.booking.update({ where: { id }, data });
  }

  // Conditional update: only applies `data` if the row is still in one of
  // `fromStatuses`. Returns null if another request/job already moved it
  // (M3 spec §8: "row-level lock - whichever commits first wins, the loser
  // gets 409 and re-fetches current status").
  async updateIfStatus(
    id: string,
    fromStatuses: BookingStatus[],
    data: Prisma.BookingUpdateInput,
  ): Promise<Booking | null> {
    const result = await this.prisma.booking.updateMany({
      where: { id, status: { in: fromStatuses } },
      data,
    });
    if (result.count === 0) return null;
    return this.prisma.booking.findUnique({ where: { id } });
  }

  findManyByGuest(
    guestId: string,
    status: BookingStatus | undefined,
    skip: number,
    take: number,
  ): Promise<[Booking[], number]> {
    const where: Prisma.BookingWhereInput = { guestId, ...(status ? { status } : {}) };
    return this.prisma.$transaction([
      this.prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.booking.count({ where }),
    ]);
  }

  findManyByProperty(propertyId: string, skip: number, take: number): Promise<[Booking[], number]> {
    const where: Prisma.BookingWhereInput = { propertyId };
    return this.prisma.$transaction([
      this.prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.booking.count({ where }),
    ]);
  }

  // Owner dashboard aggregates for a single property.
  async dashboardStats(
    propertyId: string,
    todayStart: Date,
    todayEnd: Date,
    weekAgo: Date,
    now: Date,
  ): Promise<{ total: number; today: number; upcoming: number; completed: number; revenuePaise: number }> {
    const earning: BookingStatus[] = [
      BookingStatus.confirmed,
      BookingStatus.checked_in,
      BookingStatus.completed,
    ];
    const [total, today, upcoming, completed, revenue] = await this.prisma.$transaction([
      this.prisma.booking.count({ where: { propertyId } }),
      this.prisma.booking.count({
        where: { propertyId, checkInAt: { gte: todayStart, lte: todayEnd }, status: { in: earning } },
      }),
      this.prisma.booking.count({
        where: { propertyId, checkInAt: { gt: now }, status: BookingStatus.confirmed },
      }),
      this.prisma.booking.count({ where: { propertyId, status: BookingStatus.completed } }),
      this.prisma.booking.aggregate({
        _sum: { totalAmountPaise: true },
        where: { propertyId, status: { in: earning }, createdAt: { gte: weekAgo } },
      }),
    ]);
    return { total, today, upcoming, completed, revenuePaise: revenue._sum.totalAmountPaise ?? 0 };
  }

  // Minimal projection for owner analytics aggregation (grouped in the service).
  findForAnalytics(
    propertyId: string,
    since: Date,
  ): Promise<Array<Pick<Booking, 'createdAt' | 'totalAmountPaise' | 'status' | 'bookingType'>>> {
    return this.prisma.booking.findMany({
      where: { propertyId, createdAt: { gte: since } },
      select: { createdAt: true, totalAmountPaise: true, status: true, bookingType: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // --- Scheduled lifecycle jobs (M3 spec §5) ---

  findPendingPaymentTimedOut(cutoff: Date): Promise<Booking[]> {
    return this.prisma.booking.findMany({
      where: { status: BookingStatus.pending_payment, createdAt: { lt: cutoff } },
    });
  }

  findCheckedInPastCheckout(now: Date): Promise<Booking[]> {
    return this.prisma.booking.findMany({
      where: { status: BookingStatus.checked_in, checkOutAt: { lte: now } },
    });
  }

  findConfirmedPastNoShowGrace(graceDeadline: Date): Promise<Booking[]> {
    return this.prisma.booking.findMany({
      where: { status: BookingStatus.confirmed, checkInAt: { lt: graceDeadline } },
    });
  }
}

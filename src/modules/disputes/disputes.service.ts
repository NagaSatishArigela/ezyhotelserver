import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  Dispute,
  DisputeResolutionType,
  DisputeStatus,
  NotificationType,
  PaymentStatus,
  Prisma,
  PropertyRole,
  WalletCreditSourceType,
} from '@prisma/client';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { TypedEventEmitter } from '../../common/events/typed-event-emitter.service';
import { UsersRepository } from '../auth/repositories/user.repository';
import { BookingsRepository } from '../bookings/bookings.repository';
import { PrismaService } from '../database/prisma.service';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { RedisService } from '../redis/redis.service';
import { DisputeFilters, DisputeListRow, DisputesRepository } from './disputes.repository';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { HotelResponseDto } from './dto/hotel-response.dto';
import { ListAdminDisputesQueryDto } from './dto/list-admin-disputes-query.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FILING_WINDOW_MS = 48 * HOUR_MS;
const HOTEL_RESPONSE_WINDOW_MS = 48 * HOUR_MS;
const RESOLUTION_WINDOW_MS = 7 * DAY_MS;

export interface AdminDisputeListItem {
  id: string;
  disputeRef: string;
  bookingRef: string | null;
  guestPhone: string | null;
  propertyName: string | null;
  category: string;
  filedAt: Date;
  resolutionDeadline: Date;
  status: DisputeStatus;
  hoursUntilDeadline: number;
}

export interface AdminDisputeListResult {
  items: AdminDisputeListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface OwnerDisputeListItem {
  id: string;
  disputeRef: string;
  bookingRef: string | null;
  category: string;
  filedAt: Date;
  status: DisputeStatus;
}

export interface OwnerDisputeListResult {
  items: OwnerDisputeListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminDisputeDetail {
  dispute: Dispute;
  booking: {
    bookingRef: string;
    checkInAt: Date;
    checkOutAt: Date;
    totalAmountPaise: number;
    status: BookingStatus;
  } | null;
  guest: { phone: string | null; totalBookings: number; pastDisputeCount: number; hasReview: boolean };
  property: { name: string | null; city: string | null; pastDisputeCount: number };
}

function mapListRow(row: DisputeListRow): AdminDisputeListItem {
  return {
    id: row.id,
    disputeRef: row.dispute_ref,
    bookingRef: row.booking_ref,
    guestPhone: row.guest_phone,
    propertyName: row.property_name,
    category: row.category,
    filedAt: row.filed_at,
    resolutionDeadline: row.resolution_deadline,
    status: row.status,
    hoursUntilDeadline: Math.round((row.resolution_deadline.getTime() - Date.now()) / HOUR_MS),
  };
}

@Injectable()
export class DisputesService {
  constructor(
    private readonly repo: DisputesRepository,
    private readonly bookingsRepo: BookingsRepository,
    private readonly notifications: NotificationsRepository,
    private readonly users: UsersRepository,
    private readonly events: TypedEventEmitter,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** POST /bookings/:id/disputes (M6 spec §3.1). */
  async fileDispute(bookingId: string, guestId: string, dto: CreateDisputeDto): Promise<Dispute> {
    const booking = await this.bookingsRepo.findById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.guestId !== guestId) throw new NotFoundException('Booking not found');

    if (booking.status !== BookingStatus.completed) {
      throw new ConflictException('Disputes can only be filed for completed bookings.');
    }
    if (!booking.checkedOutAt || Date.now() - booking.checkedOutAt.getTime() > FILING_WINDOW_MS) {
      throw new ForbiddenException('The 48-hour window to file a dispute for this booking has closed.');
    }

    const existing = await this.repo.findByBookingId(bookingId);
    if (existing) {
      throw new ConflictException('A dispute has already been filed for this booking.');
    }

    const disputeRef = await this.repo.generateDisputeRef();
    const now = new Date();
    const dispute = await this.repo.create({
      disputeRef,
      bookingId,
      guestId,
      propertyId: booking.propertyId,
      category: dto.category,
      description: dto.description,
      guestEvidence: dto.evidence ?? undefined,
      requestedResolution: dto.requestedResolution,
      status: DisputeStatus.filed,
      filedAt: now,
      resolutionDeadline: new Date(now.getTime() + RESOLUTION_WINDOW_MS),
    });

    this.events.emit(DOMAIN_EVENTS.DISPUTE_FILED, {
      disputeId: dispute.id,
      disputeRef: dispute.disputeRef,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      hotelId: booking.propertyId,
      guestUserId: guestId,
      category: dispute.category,
    });

    return dispute;
  }

  /** GET /admin/disputes (M6 spec §3.2). */
  async list(query: ListAdminDisputesQueryDto): Promise<AdminDisputeListResult> {
    if (query.dateFrom && query.dateTo && new Date(query.dateFrom) > new Date(query.dateTo)) {
      throw new BadRequestException('dateFrom cannot be after dateTo.');
    }

    const filters: DisputeFilters = {
      status: query.status,
      category: query.category,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      propertyId: query.propertyId,
    };

    const { items, total } = await this.repo.findManyForAdmin(
      filters,
      (query.page - 1) * query.limit,
      query.limit,
      query.order,
    );

    return { items: items.map(mapListRow), total, page: query.page, limit: query.limit };
  }

  /** GET /owner/properties/:propertyId/disputes (M6 spec §6.2). */
  async listForOwner(propertyId: string, page: number, limit: number): Promise<OwnerDisputeListResult> {
    const { items, total } = await this.repo.findManyByProperty(propertyId, (page - 1) * limit, limit);

    return {
      items: items.map((row) => ({
        id: row.id,
        disputeRef: row.dispute_ref,
        bookingRef: row.booking_ref,
        category: row.category,
        filedAt: row.filed_at,
        status: row.status,
      })),
      total,
      page,
      limit,
    };
  }

  /** GET /admin/disputes/unresolved-count (M6 spec §3.3). */
  async unresolvedCount(): Promise<{ count: number }> {
    return { count: await this.repo.countUnresolved() };
  }

  /** GET /admin/disputes/:id (M6 spec §3.4). */
  async getDetail(id: string): Promise<AdminDisputeDetail> {
    let dispute = await this.repo.findById(id);
    if (!dispute) throw new NotFoundException('Dispute not found');

    if (dispute.status === DisputeStatus.filed) {
      const updated = await this.repo.updateIfStatus(id, [DisputeStatus.filed], {
        status: DisputeStatus.under_review,
      });
      if (updated) dispute = updated;
    }

    const booking = await this.bookingsRepo.findById(dispute.bookingId);
    const [guest, property, guestDisputeCount, propertyDisputeCount, [, totalBookings]] = await Promise.all([
      this.users.findById(dispute.guestId),
      this.bookingsRepo.findProperty(dispute.propertyId),
      this.repo.countByGuest(dispute.guestId),
      this.repo.countByProperty(dispute.propertyId),
      this.bookingsRepo.findManyByGuest(dispute.guestId, undefined, 0, 1),
    ]);

    return {
      dispute,
      booking: booking
        ? {
            bookingRef: booking.bookingRef,
            checkInAt: booking.checkInAt,
            checkOutAt: booking.checkOutAt,
            totalAmountPaise: booking.totalAmountPaise,
            status: booking.status,
          }
        : null,
      guest: {
        phone: guest?.phone ?? null,
        totalBookings,
        pastDisputeCount: Math.max(0, guestDisputeCount - 1),
        hasReview: false,
      },
      property: {
        name: property?.name ?? null,
        city: property?.city ?? null,
        pastDisputeCount: Math.max(0, propertyDisputeCount - 1),
      },
    };
  }

  /** POST /admin/disputes/:id/request-response (M6 spec §3.5). */
  async requestResponse(id: string): Promise<Dispute> {
    const dispute = await this.findOrThrow(id);

    const updated = await this.repo.updateIfStatus(id, [DisputeStatus.filed, DisputeStatus.under_review], {
      status: DisputeStatus.awaiting_hotel_response,
      hotelResponseDeadline: new Date(Date.now() + HOTEL_RESPONSE_WINDOW_MS),
    });
    if (!updated) {
      throw new ConflictException('A response has already been requested for this dispute.');
    }

    const booking = await this.bookingsRepo.findById(dispute.bookingId);
    if (booking) {
      await this.notifications.create({
        ownerId: booking.ownerId,
        propertyId: dispute.propertyId,
        type: NotificationType.dispute_response_requested,
        title: `Response requested: dispute ${dispute.disputeRef}`,
        body: `A guest has filed a dispute (${dispute.category}) for booking ${booking.bookingRef}. Please respond within 48 hours.`,
        actionUrl: '/owner/disputes',
      });
    }

    return updated;
  }

  /** POST /disputes/:id/hotel-response (M6 spec §3.6). */
  async submitHotelResponse(id: string, userId: string, dto: HotelResponseDto): Promise<Dispute> {
    const dispute = await this.findOrThrow(id);

    const allowed = await this.users.hasPropertyRole(userId, dispute.propertyId, [
      PropertyRole.OWNER,
      PropertyRole.MANAGER,
    ]);
    if (!allowed) {
      throw new ForbiddenException('Insufficient property role');
    }

    if (
      dispute.status !== DisputeStatus.awaiting_hotel_response ||
      !dispute.hotelResponseDeadline ||
      Date.now() > dispute.hotelResponseDeadline.getTime()
    ) {
      throw new ConflictException('The response window for this dispute has closed.');
    }

    const updated = await this.repo.updateIfStatus(id, [DisputeStatus.awaiting_hotel_response], {
      hotelResponse: dto.response,
      hotelEvidence: dto.evidence ?? undefined,
      status: DisputeStatus.under_review,
    });
    if (!updated) {
      throw new ConflictException('The response window for this dispute has closed.');
    }

    return updated;
  }

  /** PATCH /admin/disputes/:id/resolve (M6 spec §3.7). */
  async resolve(id: string, adminId: string, dto: ResolveDisputeDto): Promise<Dispute> {
    const dispute = await this.findOrThrow(id);
    const booking = await this.bookingsRepo.findById(dispute.bookingId);
    if (!booking) throw new NotFoundException('Booking not found');

    let status: DisputeStatus;
    let refundAmountPaise: number | undefined;

    switch (dto.resolutionType) {
      case DisputeResolutionType.full_refund:
        status = DisputeStatus.resolved_guest;
        refundAmountPaise = booking.totalAmountPaise;
        break;
      case DisputeResolutionType.partial_refund:
        if (!dto.refundAmountPaise || dto.refundAmountPaise <= 0) {
          throw new BadRequestException('refundAmountPaise is required for a partial refund.');
        }
        if (dto.refundAmountPaise > booking.totalAmountPaise) {
          throw new BadRequestException(
            `Refund amount cannot exceed ₹${(booking.totalAmountPaise / 100).toFixed(2)} (booking total).`,
          );
        }
        status = DisputeStatus.resolved_partial;
        refundAmountPaise = dto.refundAmountPaise;
        break;
      case DisputeResolutionType.no_action:
        status = DisputeStatus.resolved_hotel;
        break;
      case DisputeResolutionType.wallet_credit:
        if (!dto.walletCreditAmountPaise || dto.walletCreditAmountPaise <= 0) {
          throw new BadRequestException('walletCreditAmountPaise is required for a wallet credit resolution.');
        }
        status = DisputeStatus.resolved_wallet_credit;
        break;
      case DisputeResolutionType.escalated:
        status = DisputeStatus.escalated;
        break;
      default:
        throw new BadRequestException('Unsupported resolutionType.');
    }

    const allowedStatuses = [
      DisputeStatus.filed,
      DisputeStatus.under_review,
      DisputeStatus.awaiting_hotel_response,
    ];
    const resolveData = {
      status,
      resolutionType: dto.resolutionType,
      refundAmountPaise: refundAmountPaise ?? null,
      adminNotes: dto.adminNotes,
      resolvedBy: adminId,
      resolvedAt: new Date(),
    };

    let updated: Dispute | null;

    if (refundAmountPaise) {
      // Atomically update the dispute status and apply the booking refund so they
      // cannot diverge if the process crashes between the two writes.
      const bookingId = booking.id;
      const refund = refundAmountPaise;
      updated = await this.prisma.$transaction(async (tx) => {
        const r = await tx.dispute.updateMany({
          where: { id, status: { in: allowedStatuses } },
          data: resolveData,
        });
        if (r.count === 0) return null;

        const b = await tx.booking.findUnique({ where: { id: bookingId } });
        if (b) {
          await tx.booking.update({
            where: { id: bookingId },
            data: {
              refundAmountPaise: (b.refundAmountPaise ?? 0) + refund,
              paymentStatus: PaymentStatus.refunded,
            },
          });
        }

        return tx.dispute.findUnique({ where: { id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } else {
      updated = await this.repo.updateIfStatus(id, allowedStatuses, resolveData);
    }

    if (!updated) {
      throw new ConflictException('This dispute has already been resolved.');
    }

    if (dto.resolutionType === DisputeResolutionType.wallet_credit && dto.walletCreditAmountPaise) {
      await this.repo.createWalletCredit({
        userId: dispute.guestId,
        amountPaise: dto.walletCreditAmountPaise,
        reason: `Dispute ${dispute.disputeRef} resolution`,
        sourceType: WalletCreditSourceType.dispute,
        sourceId: dispute.id,
        createdBy: adminId,
      });
    }

    // dispute_resolved is only sent when the resolution has a payout impact
    // (M6 spec §2.3); no_action/wallet_credit/escalated do not affect the
    // owner's payout and are not notified.
    if (
      dto.resolutionType === DisputeResolutionType.full_refund ||
      dto.resolutionType === DisputeResolutionType.partial_refund
    ) {
      await this.notifications.create({
        ownerId: booking.ownerId,
        propertyId: dispute.propertyId,
        type: NotificationType.dispute_resolved,
        title: `Dispute ${dispute.disputeRef} resolved`,
        body: this.resolutionNotificationBody(dto.resolutionType, refundAmountPaise),
        actionUrl: '/owner/disputes',
      });
    }

    return updated;
  }

  /** Background auto-close sweep (M6 spec §4), invoked by DisputeLifecycleScheduler. */
  async runAutoClose(): Promise<number> {
    const release = await this.redis.acquireLock('dispute:auto-close-lock', 5 * 60 * 1000);
    if (!release) return 0;

    try {
      return await this.runAutoCloseInner();
    } finally {
      await release();
    }
  }

  private async runAutoCloseInner(): Promise<number> {
    const expired = await this.repo.findExpired(new Date());
    let closed = 0;

    for (const dispute of expired) {
      const booking = await this.bookingsRepo.findById(dispute.bookingId);
      if (!booking) continue;

      const updated = await this.repo.updateIfStatus(dispute.id, [
        DisputeStatus.filed,
        DisputeStatus.under_review,
        DisputeStatus.awaiting_hotel_response,
      ], {
        status: DisputeStatus.closed_no_response,
        resolutionType: DisputeResolutionType.full_refund,
        refundAmountPaise: booking.totalAmountPaise,
        resolvedAt: new Date(),
        resolvedBy: null,
      });
      if (!updated) continue;

      await this.applyRefundBookkeeping(booking.id, booking.status, booking.totalAmountPaise);

      await this.notifications.create({
        ownerId: booking.ownerId,
        propertyId: dispute.propertyId,
        type: NotificationType.dispute_resolved,
        title: `Dispute ${dispute.disputeRef} auto-resolved`,
        body: `Dispute ${dispute.disputeRef} for booking ${booking.bookingRef} was auto-resolved in the guest's favour after 7 days with no hotel response. Full refund of ₹${(booking.totalAmountPaise / 100).toFixed(2)} processed.`,
        actionUrl: '/owner/disputes',
      });

      closed++;
    }

    return closed;
  }

  private async applyRefundBookkeeping(
    bookingId: string,
    fromStatus: BookingStatus,
    refundAmountPaise: number,
  ): Promise<void> {
    const booking = await this.bookingsRepo.findById(bookingId);
    if (!booking) return;

    await this.bookingsRepo.updateIfStatus(bookingId, [fromStatus], {
      refundAmountPaise: (booking.refundAmountPaise ?? 0) + refundAmountPaise,
      paymentStatus: PaymentStatus.refunded,
    });
  }

  private resolutionNotificationBody(
    resolutionType: DisputeResolutionType,
    refundAmountPaise: number | undefined,
  ): string {
    const amount = ((refundAmountPaise ?? 0) / 100).toFixed(2);
    return resolutionType === DisputeResolutionType.full_refund
      ? `Dispute resolved in the guest's favour. ₹${amount} deducted from your next payout.`
      : `Dispute partially resolved in the guest's favour. ₹${amount} deducted from your next payout.`;
  }

  private async findOrThrow(id: string): Promise<Dispute> {
    const dispute = await this.repo.findById(id);
    if (!dispute) throw new NotFoundException('Dispute not found');
    return dispute;
  }
}

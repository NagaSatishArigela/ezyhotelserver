import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Booking,
  BookingStatus,
  LedgerAccount,
  LedgerDirection,
  PaymentGatewayStatus,
  PaymentStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { TypedEventEmitter } from '../../common/events/typed-event-emitter.service';
import { PrismaService } from '../database/prisma.service';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from '../finance/gateway/payment-gateway.interface';
import { SandboxPaymentGateway } from '../finance/gateway/sandbox-payment-gateway';
import { LedgerLeg, LedgerService } from '../finance/ledger.service';
import { BookingsRepository } from './bookings.repository';
import { VerifyPaymentDto } from './dto/verify-payment.dto';

/**
 * Real payment flow (Layer C), replacing the client-trusted confirm:
 *   1. createOrder  — server mints a gateway order, persists a Payment(created)
 *   2. [checkout]   — guest pays; gateway returns {paymentId, signature}
 *   3. verifyAndCapture — server verifies the signature, then ATOMICALLY flips
 *      the booking to confirmed, marks the Payment captured, and posts the
 *      double-entry ledger. A forged payment cannot pass step 3.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: BookingsRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly ledger: LedgerService,
    private readonly events: TypedEventEmitter,
  ) {}

  private async getPayableBooking(bookingId: string, guestId: string): Promise<Booking> {
    const booking = await this.repo.findById(bookingId);
    if (!booking || booking.guestId !== guestId) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.pending_payment) {
      throw new ConflictException('This booking is not awaiting payment.');
    }
    return booking;
  }

  /** Step 1 — create a gateway order for the booking's total. */
  async createOrder(bookingId: string, guestId: string) {
    const booking = await this.getPayableBooking(bookingId, guestId);

    const order = await this.gateway.createOrder({
      amountPaise: booking.totalAmountPaise,
      receipt: booking.bookingRef,
      notes: { bookingId: booking.id },
    });

    await this.prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: order.provider,
        gatewayOrderId: order.orderId,
        amountPaise: order.amountPaise,
        status: PaymentGatewayStatus.created,
      },
    });

    return {
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      provider: order.provider,
      orderId: order.orderId,
      amountPaise: order.amountPaise,
      keyId: order.keyId,
    };
  }

  /**
   * Sandbox-only helper that stands in for the hosted checkout widget: returns a
   * valid {paymentId, signature} for an order so the demo/e2e can complete a
   * payment without a real gateway. Rejected outside sandbox.
   */
  async simulateCheckout(bookingId: string, guestId: string, orderId: string) {
    if (!(this.gateway instanceof SandboxPaymentGateway)) {
      throw new BadRequestException('Checkout simulation is only available in sandbox mode.');
    }
    const booking = await this.getPayableBooking(bookingId, guestId);
    const payment = await this.prisma.payment.findUnique({ where: { gatewayOrderId: orderId } });
    if (!payment || payment.bookingId !== booking.id) {
      throw new NotFoundException('Payment order not found for this booking.');
    }
    return this.gateway.simulateCheckout(orderId);
  }

  /** Step 3 — verify signature, then atomically capture + confirm + post ledger. */
  async verifyAndCapture(bookingId: string, guestId: string, dto: VerifyPaymentDto): Promise<Booking> {
    const booking = await this.getPayableBooking(bookingId, guestId);

    const payment = await this.prisma.payment.findUnique({ where: { gatewayOrderId: dto.orderId } });
    if (!payment || payment.bookingId !== booking.id) {
      throw new NotFoundException('Payment order not found for this booking.');
    }
    if (payment.status === PaymentGatewayStatus.captured) {
      throw new ConflictException('This payment was already captured.');
    }

    const valid = this.gateway.verifyPaymentSignature({
      orderId: dto.orderId,
      paymentId: dto.paymentId,
      signature: dto.signature,
    });
    if (!valid) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentGatewayStatus.failed, failureReason: 'Invalid payment signature' },
      });
      this.events.emit(DOMAIN_EVENTS.PAYMENT_FAILED, {
        bookingId: booking.id,
        paymentId: dto.paymentId,
        reason: 'Invalid payment signature',
      });
      throw new BadRequestException('Payment verification failed.');
    }

    const qrCode = randomBytes(16).toString('hex');
    const ownerPayablePaise = booking.baseAmountPaise - booking.platformFeePaise;

    // Ledger legs: guest pays total (base + GST); the platform carves its
    // commission out of the base, owner is owed the remainder, GST is a
    // pass-through liability. Drop any zero-amount leg (e.g. 0 commission on
    // legacy bookings) — the set still balances.
    const legs: LedgerLeg[] = [
      { account: LedgerAccount.guest_clearing, direction: LedgerDirection.debit, amountPaise: booking.totalAmountPaise, memo: 'Guest payment captured' },
      { account: LedgerAccount.owner_payable, direction: LedgerDirection.credit, amountPaise: ownerPayablePaise, memo: 'Owner earnings (base − commission)' },
      { account: LedgerAccount.platform_commission, direction: LedgerDirection.credit, amountPaise: booking.platformFeePaise, memo: 'Platform commission' },
      { account: LedgerAccount.gst_payable, direction: LedgerDirection.credit, amountPaise: booking.gstAmountPaise, memo: 'GST collected' },
    ].filter((l) => l.amountPaise > 0);

    const captured = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.booking.updateMany({
        where: { id: booking.id, status: BookingStatus.pending_payment },
        data: {
          status: BookingStatus.confirmed,
          paymentStatus: PaymentStatus.success,
          paymentRef: dto.paymentId,
          qrCode,
        },
      });
      if (upd.count === 0) {
        throw new ConflictException('This booking is no longer awaiting payment.');
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentGatewayStatus.captured,
          gatewayPaymentId: dto.paymentId,
          signature: dto.signature,
          capturedAt: new Date(),
        },
      });

      await this.ledger.post(
        { txnRef: `CAP-${booking.bookingRef}`, refType: 'booking', refId: booking.id, legs },
        tx,
      );

      return tx.booking.findUnique({ where: { id: booking.id } });
    });

    const confirmed = captured as Booking;

    this.events.emit(DOMAIN_EVENTS.PAYMENT_CAPTURED, {
      bookingId: confirmed.id,
      paymentId: dto.paymentId,
      amountPaise: confirmed.totalAmountPaise,
    });
    this.events.emit(DOMAIN_EVENTS.BOOKING_CONFIRMED, {
      bookingId: confirmed.id,
      bookingRef: confirmed.bookingRef,
      hotelId: confirmed.propertyId,
      ownerId: confirmed.ownerId,
      roomId: confirmed.roomTypeId,
      guestUserId: confirmed.guestId,
      bookingType: confirmed.bookingType,
      checkIn: confirmed.checkInAt.toISOString(),
      checkOut: confirmed.checkOutAt.toISOString(),
      amountPaise: confirmed.totalAmountPaise,
    });

    return confirmed;
  }
}

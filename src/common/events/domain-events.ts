/**
 * Cross-domain event contracts for the modular monolith.
 *
 * Rules:
 *  - These are the ONLY shapes that may cross a domain-schema boundary.
 *  - A domain module may import this file (shared kernel) but must NEVER
 *    import another domain module's services/repositories directly.
 *  - Payloads carry primitive ids (UUID strings) and plain data only - never
 *    Prisma model instances - so domains stay decoupled from each other's
 *    persistence shape.
 *  - When extracting a domain into its own service later (strangler-fig),
 *    these event names/payloads become the SQS/event-bus message contracts
 *    with no shape changes required.
 */

export const DOMAIN_EVENTS = {
  // --- Auth domain ---
  USER_REGISTERED: 'user.registered',

  // --- Properties / Onboarding domain ---
  HOTEL_ONBOARDING_SUBMITTED: 'hotel.onboarding.submitted',
  HOTEL_VERIFIED: 'hotel.verified',
  HOTEL_REJECTED: 'hotel.rejected',
  HOTEL_REVISION_REQUESTED: 'hotel.revision_requested',
  HOTEL_DELETION_REQUESTED: 'hotel.deletion.requested',
  HOTEL_DELETION_CANCELLED: 'hotel.deletion.cancelled',
  HOTEL_DELETION_COMPLETED: 'hotel.deletion.completed',

  // --- Bookings domain ---
  BOOKING_CREATED: 'booking.created',
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_CANCELLED: 'booking.cancelled',
  BOOKING_CHECKED_IN: 'booking.checked_in',
  BOOKING_CHECKED_OUT: 'booking.checked_out',
  BOOKING_NO_SHOW: 'booking.no_show',
  BOOKING_VOIDED: 'booking.voided',
  BOOKING_REFUNDED: 'booking.refunded',
  BOOKING_EXTENDED: 'booking.extended',
  BOOKING_FLAGGED: 'booking.flagged',

  // --- Disputes domain (M6) ---
  DISPUTE_FILED: 'dispute.filed',

  // --- Reviews domain (M7) ---
  REVIEW_PUBLISHED: 'review.published',
  REVIEW_FLAGGED_ADMIN: 'review.flagged_admin',
  REVIEW_NEW_ON_PROPERTY: 'review.new_on_property',

  // --- Payouts domain (M8) ---
  PAYOUT_RELEASED: 'payout.released',

  // --- Finance domain ---
  PAYMENT_CAPTURED: 'payment.captured',
  PAYMENT_FAILED: 'payment.failed',
  REFUND_PROCESSED: 'refund.processed',
  PAYOUT_COMPLETED: 'payout.completed',

  // --- Notifications domain (consumer of most events above) ---
  NOTIFICATION_REQUESTED: 'notification.requested',
} as const;

export type DomainEventName = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

export interface UserRegisteredPayload {
  userId: string;
  phone: string;
  email: string;
}

export interface HotelOnboardingSubmittedPayload {
  hotelId: string;
  ownerId: string;
  bookingMode: 'hourly' | 'fullday' | 'both';
  submissionRef: string;
}

export interface HotelVerifiedPayload {
  hotelId: string;
  ownerId: string;
  verifiedBy: string;
}

export interface HotelRejectedPayload {
  hotelId: string;
  ownerId: string;
  rejectedBy: string;
  reason: string;
}

export interface HotelRevisionRequestedPayload {
  hotelId: string;
  ownerId: string;
  requestedBy: string;
  items: { field: string; reason: string }[];
}

export interface HotelDeletionRequestedPayload {
  hotelId: string;
  ownerId: string;
  track: 'fast_72h' | 'standard_30d';
  scheduledFor: string; // ISO timestamp
}

export interface HotelDeletionCancelledPayload {
  hotelId: string;
  ownerId: string;
}

export interface HotelDeletionCompletedPayload {
  hotelId: string;
  ownerId: string;
  archiveId: string;
}

export interface BookingCreatedPayload {
  bookingId: string;
  bookingRef: string;
  hotelId: string;
  ownerId: string;
  roomId: string;
  guestUserId: string;
  bookingType: 'hourly' | 'fullday';
  checkIn: string; // ISO timestamp
  checkOut: string; // ISO timestamp
  amountPaise: number;
}

export interface BookingCancelledPayload {
  bookingId: string;
  bookingRef: string;
  hotelId: string;
  ownerId: string;
  guestUserId: string;
  reason: string;
  refundAmountPaise?: number;
}

export interface BookingCheckInOutPayload {
  bookingId: string;
  bookingRef: string;
  hotelId: string;
  ownerId: string;
  roomId: string;
  guestUserId: string;
  at: string; // ISO timestamp
}

export interface BookingVoidedPayload {
  bookingId: string;
  bookingRef: string;
  hotelId: string;
  ownerId: string;
  guestUserId: string;
  voidedBy: string;
  reason: string;
  refundAmountPaise: number;
}

export interface BookingRefundedPayload {
  bookingId: string;
  bookingRef: string;
  hotelId: string;
  ownerId: string;
  guestUserId: string;
  amountPaise: number;
  isPartial: boolean;
  reason: string;
}

export interface BookingExtendedPayload {
  bookingId: string;
  bookingRef: string;
  hotelId: string;
  ownerId: string;
  guestUserId: string;
  newCheckOutAt: string; // ISO timestamp
  extensionAmountPaise: number;
}

export interface BookingFlaggedPayload {
  bookingId: string;
  bookingRef: string;
  hotelId: string;
  flagType: string;
  flagNotes: string | null;
}

export interface DisputeFiledPayload {
  disputeId: string;
  disputeRef: string;
  bookingId: string;
  bookingRef: string;
  hotelId: string;
  guestUserId: string;
  category: string;
}

export interface PaymentCapturedPayload {
  bookingId: string;
  paymentId: string;
  amountPaise: number;
}

export interface PaymentFailedPayload {
  bookingId: string;
  paymentId: string;
  reason: string;
}

export interface RefundProcessedPayload {
  bookingId: string;
  refundId: string;
  amountPaise: number;
}

export interface PayoutCompletedPayload {
  hotelId: string;
  payoutId: string;
  amountPaise: number;
  periodStart: string;
  periodEnd: string;
}

export interface PayoutReleasedPayload {
  payoutItemId: string;
  ownerId: string;
  propertyId: string;
  netAmountPaise: number;
  batchRef: string;
}

export interface ReviewPublishedPayload {
  reviewId: string;
  bookingId: string;
  propertyId: string;
  guestId: string;
}

export interface ReviewFlaggedAdminPayload {
  reviewId: string;
  propertyId: string;
  flagRole: string;
  reason?: string;
}

export interface ReviewNewOnPropertyPayload {
  reviewId: string;
  propertyId: string;
  ownerId: string;
  scoreOverall: number;
}

export interface NotificationRequestedPayload {
  channel: 'sms' | 'email' | 'push';
  templateId: string;
  recipientUserId: string;
  data: Record<string, string | number | boolean>;
}

/**
 * Maps each event name to its payload type. Used by TypedEventEmitter for
 * compile-time-checked emit()/on() calls.
 */
export interface DomainEventPayloads {
  [DOMAIN_EVENTS.USER_REGISTERED]: UserRegisteredPayload;
  [DOMAIN_EVENTS.HOTEL_ONBOARDING_SUBMITTED]: HotelOnboardingSubmittedPayload;
  [DOMAIN_EVENTS.HOTEL_VERIFIED]: HotelVerifiedPayload;
  [DOMAIN_EVENTS.HOTEL_REJECTED]: HotelRejectedPayload;
  [DOMAIN_EVENTS.HOTEL_REVISION_REQUESTED]: HotelRevisionRequestedPayload;
  [DOMAIN_EVENTS.HOTEL_DELETION_REQUESTED]: HotelDeletionRequestedPayload;
  [DOMAIN_EVENTS.HOTEL_DELETION_CANCELLED]: HotelDeletionCancelledPayload;
  [DOMAIN_EVENTS.HOTEL_DELETION_COMPLETED]: HotelDeletionCompletedPayload;
  [DOMAIN_EVENTS.BOOKING_CREATED]: BookingCreatedPayload;
  [DOMAIN_EVENTS.BOOKING_CONFIRMED]: BookingCreatedPayload;
  [DOMAIN_EVENTS.BOOKING_CANCELLED]: BookingCancelledPayload;
  [DOMAIN_EVENTS.BOOKING_CHECKED_IN]: BookingCheckInOutPayload;
  [DOMAIN_EVENTS.BOOKING_CHECKED_OUT]: BookingCheckInOutPayload;
  [DOMAIN_EVENTS.BOOKING_NO_SHOW]: BookingCancelledPayload;
  [DOMAIN_EVENTS.BOOKING_VOIDED]: BookingVoidedPayload;
  [DOMAIN_EVENTS.BOOKING_REFUNDED]: BookingRefundedPayload;
  [DOMAIN_EVENTS.BOOKING_EXTENDED]: BookingExtendedPayload;
  [DOMAIN_EVENTS.BOOKING_FLAGGED]: BookingFlaggedPayload;
  [DOMAIN_EVENTS.DISPUTE_FILED]: DisputeFiledPayload;
  [DOMAIN_EVENTS.REVIEW_PUBLISHED]: ReviewPublishedPayload;
  [DOMAIN_EVENTS.REVIEW_FLAGGED_ADMIN]: ReviewFlaggedAdminPayload;
  [DOMAIN_EVENTS.REVIEW_NEW_ON_PROPERTY]: ReviewNewOnPropertyPayload;
  [DOMAIN_EVENTS.PAYMENT_CAPTURED]: PaymentCapturedPayload;
  [DOMAIN_EVENTS.PAYMENT_FAILED]: PaymentFailedPayload;
  [DOMAIN_EVENTS.REFUND_PROCESSED]: RefundProcessedPayload;
  [DOMAIN_EVENTS.PAYOUT_COMPLETED]: PayoutCompletedPayload;
  [DOMAIN_EVENTS.PAYOUT_RELEASED]: PayoutReleasedPayload;
  [DOMAIN_EVENTS.NOTIFICATION_REQUESTED]: NotificationRequestedPayload;
}

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Anomaly, AnomalyEntityType, AnomalySeverity, AnomalyStatus } from '@prisma/client';
import { AnomaliesRepository } from '../anomalies.repository';
import { AdminAnomaliesService } from '../admin-anomalies.service';

const now = new Date('2026-06-14T12:00:00.000Z');

function buildAnomaly(overrides: Partial<Anomaly> = {}): Anomaly {
  return {
    id: 'anomaly-1',
    ruleId: 'ANO-001',
    severity: AnomalySeverity.medium,
    entityType: AnomalyEntityType.property,
    entityId: 'prop-1',
    description: 'desc',
    evidence: {},
    status: AnomalyStatus.detected,
    resolutionType: null,
    resolutionNotes: null,
    resolvedBy: null,
    detectedAt: now,
    resolvedAt: null,
    ...overrides,
  } as Anomaly;
}

describe(AdminAnomaliesService.name, () => {
  const repo = {
    findManyForAdmin: jest.fn(),
    countUnresolved: jest.fn(),
    findDetailRow: jest.fn(),
    findBookingSummaries: jest.fn(),
    findAdminActionsForBookings: jest.fn(),
    findById: jest.fn(),
    findUnresolvedByRule: jest.fn(),
    create: jest.fn(),
    updateIfStatus: jest.fn(),
    findHighCancellationRateCandidates: jest.fn(),
    findPaymentFailureSpikeCandidates: jest.fn(),
    findOverbookingPairs: jest.fn(),
    findBookingVelocityCandidates: jest.fn(),
    findNoShowClusterCandidates: jest.fn(),
    findLateNightSpikeCandidates: jest.fn(),
    findRefundAbuseCandidates: jest.fn(),
    findFlaggedBookings: jest.fn(),
    findGuestFavourDisputeCandidates: jest.fn(),
  };

  let service: AdminAnomaliesService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findBookingSummaries.mockResolvedValue([]);
    repo.findAdminActionsForBookings.mockResolvedValue([]);
    repo.findUnresolvedByRule.mockResolvedValue(null);
    repo.findHighCancellationRateCandidates.mockResolvedValue([]);
    repo.findPaymentFailureSpikeCandidates.mockResolvedValue([]);
    repo.findOverbookingPairs.mockResolvedValue([]);
    repo.findBookingVelocityCandidates.mockResolvedValue([]);
    repo.findNoShowClusterCandidates.mockResolvedValue([]);
    repo.findLateNightSpikeCandidates.mockResolvedValue([]);
    repo.findRefundAbuseCandidates.mockResolvedValue([]);
    repo.findFlaggedBookings.mockResolvedValue([]);
    repo.findGuestFavourDisputeCandidates.mockResolvedValue([]);
    service = new AdminAnomaliesService(repo as unknown as AnomaliesRepository);
  });

  describe('list', () => {
    it('maps rows and passes through filters/pagination', async () => {
      repo.findManyForAdmin.mockResolvedValue({
        items: [
          {
            id: 'anomaly-1',
            rule_id: 'ANO-001',
            severity: AnomalySeverity.critical,
            entity_type: AnomalyEntityType.property,
            entity_id: 'prop-1',
            description: 'desc',
            evidence: {},
            status: AnomalyStatus.detected,
            resolution_type: null,
            resolution_notes: null,
            resolved_by: null,
            detected_at: now,
            resolved_at: null,
            entity_label: 'Sunrise Hotel',
          },
        ],
        total: 1,
      });

      const result = await service.list({ page: 1, limit: 50, sort: 'severity', order: 'desc' });

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 'anomaly-1',
        ruleId: 'ANO-001',
        severity: AnomalySeverity.critical,
        entityLabel: 'Sunrise Hotel',
      });
      expect(repo.findManyForAdmin).toHaveBeenCalledWith(expect.any(Object), 0, 50, 'severity', 'desc');
    });
  });

  describe('unresolvedCount', () => {
    it('returns the repo count', async () => {
      repo.countUnresolved.mockResolvedValue(3);
      await expect(service.unresolvedCount()).resolves.toEqual({ count: 3 });
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundException when the anomaly does not exist', async () => {
      repo.findDetailRow.mockResolvedValue(null);
      await expect(service.getDetail('missing')).rejects.toThrow(NotFoundException);
    });

    it('auto-transitions a detected anomaly to investigating', async () => {
      repo.findDetailRow.mockResolvedValue({
        id: 'anomaly-1',
        rule_id: 'ANO-001',
        severity: AnomalySeverity.medium,
        entity_type: AnomalyEntityType.property,
        entity_id: 'prop-1',
        description: 'desc',
        evidence: {},
        status: AnomalyStatus.detected,
        resolution_type: null,
        resolution_notes: null,
        resolved_by: null,
        detected_at: now,
        resolved_at: null,
        entity_label: 'Sunrise Hotel',
      });
      repo.findById.mockResolvedValue(buildAnomaly({ evidence: {}, status: AnomalyStatus.investigating }));

      const detail = await service.getDetail('anomaly-1');

      expect(repo.updateIfStatus).toHaveBeenCalledWith('anomaly-1', [AnomalyStatus.detected], {
        status: AnomalyStatus.investigating,
      });
      expect(detail.entity).toMatchObject({
        type: AnomalyEntityType.property,
        id: 'prop-1',
        label: 'Sunrise Hotel',
        href: '/admin/bookings?propertyId=prop-1',
      });
    });

    it('does not re-transition an investigating anomaly', async () => {
      repo.findDetailRow.mockResolvedValue({
        id: 'anomaly-1',
        rule_id: 'ANO-001',
        severity: AnomalySeverity.medium,
        entity_type: AnomalyEntityType.property,
        entity_id: 'prop-1',
        description: 'desc',
        evidence: {},
        status: AnomalyStatus.investigating,
        resolution_type: null,
        resolution_notes: null,
        resolved_by: null,
        detected_at: now,
        resolved_at: null,
        entity_label: 'Sunrise Hotel',
      });
      repo.findById.mockResolvedValue(buildAnomaly({ status: AnomalyStatus.investigating }));

      await service.getDetail('anomaly-1');

      expect(repo.updateIfStatus).not.toHaveBeenCalled();
    });

    it('resolves sampleBookingIds into booking summaries and gathers related actions', async () => {
      repo.findDetailRow.mockResolvedValue({
        id: 'anomaly-1',
        rule_id: 'ANO-001',
        severity: AnomalySeverity.medium,
        entity_type: AnomalyEntityType.property,
        entity_id: 'prop-1',
        description: 'desc',
        evidence: { cancelledCount: 1, totalCount: 5, rate: 30, windowDays: 7, sampleBookingIds: ['booking-1'] },
        status: AnomalyStatus.investigating,
        resolution_type: null,
        resolution_notes: null,
        resolved_by: null,
        detected_at: now,
        resolved_at: null,
        entity_label: 'Sunrise Hotel',
      });
      repo.findById.mockResolvedValue(
        buildAnomaly({
          status: AnomalyStatus.investigating,
          evidence: { cancelledCount: 1, totalCount: 5, rate: 30, windowDays: 7, sampleBookingIds: ['booking-1'] },
        }),
      );
      repo.findBookingSummaries.mockResolvedValue([
        {
          id: 'booking-1',
          booking_ref: 'PPH-B-00001',
          status: 'cancelled',
          total_amount_paise: 100000,
          check_in_at: now,
          check_out_at: now,
        },
      ]);
      repo.findAdminActionsForBookings.mockResolvedValue([{ id: 'action-1' }]);

      const detail = await service.getDetail('anomaly-1');

      expect(detail.evidence.sampleBookingIds).toEqual([
        expect.objectContaining({ id: 'booking-1', bookingRef: 'PPH-B-00001' }),
      ]);
      expect(repo.findBookingSummaries).toHaveBeenCalledWith(['booking-1']);
      expect(repo.findAdminActionsForBookings).toHaveBeenCalledWith(['booking-1']);
      expect(detail.relatedActions).toEqual([{ id: 'action-1' }]);
    });
  });

  describe('updateStatus', () => {
    it('throws NotFoundException for a missing anomaly', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.updateStatus('missing', 'admin-1', { status: AnomalyStatus.investigating })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException for resolved_action without resolutionType/notes', async () => {
      repo.findById.mockResolvedValue(buildAnomaly());
      await expect(
        service.updateStatus('anomaly-1', 'admin-1', { status: AnomalyStatus.resolved_action }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for resolved_fp without notes', async () => {
      repo.findById.mockResolvedValue(buildAnomaly());
      await expect(
        service.updateStatus('anomaly-1', 'admin-1', { status: AnomalyStatus.resolved_fp }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for escalated without notes', async () => {
      repo.findById.mockResolvedValue(buildAnomaly());
      await expect(
        service.updateStatus('anomaly-1', 'admin-1', { status: AnomalyStatus.escalated }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when the anomaly was already resolved', async () => {
      repo.findById.mockResolvedValue(buildAnomaly({ status: AnomalyStatus.resolved_fp }));
      repo.updateIfStatus.mockResolvedValue(null);

      await expect(
        service.updateStatus('anomaly-1', 'admin-1', {
          status: AnomalyStatus.resolved_fp,
          resolutionNotes: 'note',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('transitions to investigating without resolution fields', async () => {
      repo.findById.mockResolvedValue(buildAnomaly());
      repo.updateIfStatus.mockResolvedValue(buildAnomaly({ status: AnomalyStatus.investigating }));

      await service.updateStatus('anomaly-1', 'admin-1', { status: AnomalyStatus.investigating });

      expect(repo.updateIfStatus).toHaveBeenCalledWith('anomaly-1', [AnomalyStatus.detected], {
        status: AnomalyStatus.investigating,
      });
    });

    it('resolves as action taken with resolvedBy/resolvedAt set', async () => {
      repo.findById.mockResolvedValue(buildAnomaly({ status: AnomalyStatus.investigating }));
      repo.updateIfStatus.mockResolvedValue(buildAnomaly({ status: AnomalyStatus.resolved_action }));

      await service.updateStatus('anomaly-1', 'admin-1', {
        status: AnomalyStatus.resolved_action,
        resolutionType: 'voided_booking',
        resolutionNotes: 'Voided the booking.',
      });

      expect(repo.updateIfStatus).toHaveBeenCalledWith(
        'anomaly-1',
        [AnomalyStatus.detected, AnomalyStatus.investigating],
        expect.objectContaining({
          status: AnomalyStatus.resolved_action,
          resolutionType: 'voided_booking',
          resolutionNotes: 'Voided the booking.',
          resolvedBy: 'admin-1',
          resolvedAt: expect.any(Date),
        }),
      );
    });
  });

  describe('runDetection', () => {
    it('returns 0 when no rule produces candidates', async () => {
      await expect(service.runDetection()).resolves.toBe(0);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('creates an ANO-001 anomaly when the cancellation rate exceeds 30%', async () => {
      repo.findHighCancellationRateCandidates.mockResolvedValue([
        { entity_id: 'prop-1', entity_label: 'Sunrise Hotel', total_count: 10, cancelled_count: 4, sample_ids: ['b1'] },
      ]);

      const created = await service.runDetection();

      expect(created).toBe(1);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: 'ANO-001',
          severity: AnomalySeverity.medium,
          entityType: AnomalyEntityType.property,
          entityId: 'prop-1',
          evidence: expect.objectContaining({ cancelledCount: 4, totalCount: 10, rate: 40, windowDays: 7 }),
        }),
      );
    });

    it('skips ANO-001 candidates at or below the 30% threshold', async () => {
      repo.findHighCancellationRateCandidates.mockResolvedValue([
        { entity_id: 'prop-1', entity_label: 'Sunrise Hotel', total_count: 10, cancelled_count: 3, sample_ids: [] },
      ]);

      const created = await service.runDetection();

      expect(created).toBe(0);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('skips creation when an unresolved anomaly for the same rule/entity already exists', async () => {
      repo.findHighCancellationRateCandidates.mockResolvedValue([
        { entity_id: 'prop-1', entity_label: 'Sunrise Hotel', total_count: 10, cancelled_count: 4, sample_ids: [] },
      ]);
      repo.findUnresolvedByRule.mockResolvedValue(buildAnomaly());

      const created = await service.runDetection();

      expect(created).toBe(0);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('creates an ANO-003 overbooking anomaly from overlapping booking pairs', async () => {
      repo.findOverbookingPairs.mockResolvedValue([
        {
          booking_id_a: 'booking-a',
          booking_id_b: 'booking-b',
          booking_ref_a: 'PPH-B-00001',
          booking_ref_b: 'PPH-B-00002',
          room_type_id: 'room-1',
          overlap_start: now,
          overlap_end: now,
        },
      ]);

      const created = await service.runDetection();

      expect(created).toBe(1);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: 'ANO-003',
          severity: AnomalySeverity.critical,
          entityType: AnomalyEntityType.booking,
          entityId: 'booking-a',
          evidence: expect.objectContaining({ bookingIdA: 'booking-a', bookingIdB: 'booking-b' }),
        }),
      );
    });

    it('creates an ANO-010 anomaly for a manually flagged booking', async () => {
      repo.findFlaggedBookings.mockResolvedValue([
        { id: 'booking-1', booking_ref: 'PPH-B-00001', property_id: 'prop-1', flag_type: 'suspicious', flag_notes: 'note' },
      ]);

      const created = await service.runDetection();

      expect(created).toBe(1);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: 'ANO-010',
          severity: AnomalySeverity.medium,
          entityType: AnomalyEntityType.booking,
          entityId: 'booking-1',
          evidence: { bookingId: 'booking-1', flagType: 'suspicious', flagNotes: 'note' },
        }),
      );
    });

    it('creates an ANO-011 anomaly for repeated guest-favour dispute resolutions', async () => {
      repo.findGuestFavourDisputeCandidates.mockResolvedValue([
        { entity_id: 'prop-1', entity_label: 'Sunrise Hotel', dispute_count: 6, sample_ids: ['d1', 'd2'] },
      ]);

      const created = await service.runDetection();

      expect(created).toBe(1);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: 'ANO-011',
          severity: AnomalySeverity.high,
          entityType: AnomalyEntityType.property,
          entityId: 'prop-1',
          evidence: { disputeCount: 6, windowDays: 30, sampleDisputeIds: ['d1', 'd2'] },
        }),
      );
    });

    it('skips creating an ANO-011 anomaly when one is already unresolved for the property', async () => {
      repo.findGuestFavourDisputeCandidates.mockResolvedValue([
        { entity_id: 'prop-1', entity_label: 'Sunrise Hotel', dispute_count: 6, sample_ids: ['d1'] },
      ]);
      repo.findUnresolvedByRule.mockResolvedValue(buildAnomaly());

      const created = await service.runDetection();

      expect(created).toBe(0);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('creates an ANO-009 anomaly when the refund rate exceeds 40%', async () => {
      repo.findRefundAbuseCandidates.mockResolvedValue([
        { entity_id: 'guest-1', entity_label: '9876543210', total_count: 10, refunded_count: 5, sample_ids: ['b1'] },
      ]);

      const created = await service.runDetection();

      expect(created).toBe(1);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: 'ANO-009',
          severity: AnomalySeverity.high,
          entityType: AnomalyEntityType.customer,
          entityId: 'guest-1',
          evidence: expect.objectContaining({ refundedCount: 5, totalCount: 10, rate: 50, windowDays: 90 }),
        }),
      );
    });
  });
});

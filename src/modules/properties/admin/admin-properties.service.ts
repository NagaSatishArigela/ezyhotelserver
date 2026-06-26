import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ModerationAction,
  Prisma,
  Property,
  PropertyPhoto,
  PropertyStatus,
  RoomType,
} from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';
import { TypedEventEmitter } from '../../../common/events/typed-event-emitter.service';
import {
  AdminComplianceSummary,
  ComplianceService,
} from '../compliance/compliance.service';
import { PropertiesRepository } from '../properties.repository';
import { RevisionItemDto } from './dto/request-revision.dto';

const REVISION_CYCLE_CAP = 3;

export interface PropertyQueueItem {
  id: string;
  name: string;
  ownerId: string;
  status: PropertyStatus;
  submissionRef: string | null;
  submittedAt: Date | null;
  revisionCount: number;
}

export interface PropertyQueueResult {
  items: PropertyQueueItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminPropertyDetail {
  property: Property;
  roomTypes: RoomType[];
  photos: PropertyPhoto[];
  compliance: AdminComplianceSummary | null;
}

export interface ModerationResult {
  propertyId: string;
  status: PropertyStatus;
}

@Injectable()
export class AdminPropertiesService {
  constructor(
    private readonly repo: PropertiesRepository,
    private readonly compliance: ComplianceService,
    private readonly events: TypedEventEmitter,
  ) {}

  /** GET /admin/properties - moderation queue (M2B spec §4.2). */
  async listQueue(
    status: PropertyStatus,
    page: number,
    limit: number,
  ): Promise<PropertyQueueResult> {
    const { items, total } = await this.repo.findManyByStatus(
      status,
      (page - 1) * limit,
      limit,
    );

    return {
      items: items.map((property) => ({
        id: property.id,
        name: property.name,
        ownerId: property.ownerId,
        status: property.status,
        submissionRef: property.submissionRef,
        submittedAt: property.submittedAt,
        revisionCount: property.revisionCount,
      })),
      total,
      page,
      limit,
    };
  }

  /** GET /admin/properties/:id - full detail incl. decrypted compliance. */
  async getDetail(propertyId: string): Promise<AdminPropertyDetail> {
    const property = await this.findPropertyOrThrow(propertyId);
    const [roomTypes, photos, compliance] = await Promise.all([
      this.repo.findRoomTypes(propertyId),
      this.repo.findPhotos(propertyId),
      this.compliance.getAdminSummary(propertyId),
    ]);

    return { property, roomTypes, photos, compliance };
  }

  /** POST /admin/properties/:id/approve - emits `hotel.verified`. */
  async approve(propertyId: string, adminId: string): Promise<ModerationResult> {
    const property = await this.findPropertyOrThrow(propertyId);
    this.assertPendingReview(property);

    const updated = await this.repo.update(propertyId, {
      status: PropertyStatus.approved,
    });
    await this.repo.createModerationLog({
      propertyId,
      adminId,
      action: ModerationAction.approved,
    });

    this.events.emit(DOMAIN_EVENTS.HOTEL_VERIFIED, {
      hotelId: property.id,
      ownerId: property.ownerId,
      verifiedBy: adminId,
    });

    return { propertyId: updated.id, status: updated.status };
  }

  /** POST /admin/properties/:id/reject - emits `hotel.rejected`. */
  async reject(
    propertyId: string,
    adminId: string,
    reason: string,
  ): Promise<ModerationResult> {
    const property = await this.findPropertyOrThrow(propertyId);
    this.assertPendingReview(property);

    const updated = await this.repo.update(propertyId, {
      status: PropertyStatus.rejected,
    });
    await this.repo.createModerationLog({
      propertyId,
      adminId,
      action: ModerationAction.rejected,
      reason,
    });

    this.events.emit(DOMAIN_EVENTS.HOTEL_REJECTED, {
      hotelId: property.id,
      ownerId: property.ownerId,
      rejectedBy: adminId,
      reason,
    });

    return { propertyId: updated.id, status: updated.status };
  }

  /**
   * POST /admin/properties/:id/request-revision - M2B spec edge case 3:
   * caps the revision cycle at 3. Reaching the cap moves the property to the
   * terminal `escalated` status instead of `needs_revision` and does NOT
   * emit `hotel.revision_requested` (no owner-facing template defined for
   * escalation yet).
   */
  async requestRevision(
    propertyId: string,
    adminId: string,
    items: RevisionItemDto[],
  ): Promise<ModerationResult> {
    const property = await this.findPropertyOrThrow(propertyId);
    this.assertPendingReview(property);

    await this.repo.createModerationLog({
      propertyId,
      adminId,
      action: ModerationAction.revision_requested,
      revisionItems: items as unknown as Prisma.InputJsonValue,
    });

    if (property.revisionCount + 1 > REVISION_CYCLE_CAP) {
      const updated = await this.repo.update(propertyId, {
        status: PropertyStatus.escalated,
      });
      return { propertyId: updated.id, status: updated.status };
    }

    const existingNotes = Array.isArray(property.revisionNotes)
      ? (property.revisionNotes as unknown[])
      : [];
    const revisionNotes = [
      ...existingNotes,
      { adminId, timestamp: new Date().toISOString(), items },
    ];

    const updated = await this.repo.update(propertyId, {
      status: PropertyStatus.needs_revision,
      revisionCount: property.revisionCount + 1,
      revisionNotes: revisionNotes as object,
    });

    this.events.emit(DOMAIN_EVENTS.HOTEL_REVISION_REQUESTED, {
      hotelId: property.id,
      ownerId: property.ownerId,
      requestedBy: adminId,
      items,
    });

    return { propertyId: updated.id, status: updated.status };
  }

  private async findPropertyOrThrow(propertyId: string): Promise<Property> {
    const property = await this.repo.findById(propertyId);
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    return property;
  }

  // M2B spec edge case 1: approve/reject/request-revision all require
  // status = pending_review.
  private assertPendingReview(property: Property): void {
    if (property.status !== PropertyStatus.pending_review) {
      throw new ConflictException(
        'Only properties with status "pending_review" can be moderated',
      );
    }
  }
}

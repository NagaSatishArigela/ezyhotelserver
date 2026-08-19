import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingPolicy,
  BusinessEntity,
  DocumentType,
  Prisma,
  Property,
  PropertyStatus,
  PropertyType,
  RoomType,
} from '@prisma/client';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { TypedEventEmitter } from '../../common/events/typed-event-emitter.service';
import { ComplianceService, ComplianceSummary } from './compliance/compliance.service';
import { REQUIRES_FSSAI } from './constants/amenities';
import { PropertiesRepository } from './properties.repository';
import {
  MAX_STEP,
  MIN_STEP,
  PHOTO_CATEGORIES,
  STEP_DTO_MAP,
  Step1BasicsDto,
  Step2LocationDto,
  Step3RoomsPoliciesDto,
  Step4PhotosDto,
} from './dto/step.dto';
import { Step5LegalDto } from './dto/step5-legal.dto';
import { UpdateOwnerSettingsDto } from './dto/owner-settings.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { validateStepPayload } from './utils/validate-step';

const MAX_PHOTOS_PER_CATEGORY = 10;

// businessEntity values for which a GSTIN is NOT required at submit time.
const GSTIN_EXEMPT_ENTITIES: BusinessEntity[] = [
  BusinessEntity.individual,
  BusinessEntity.sole_proprietor,
];

// Entity -> extra compliance documents required at submit time (in addition
// to the always-required fire_safety_cert and food-gated fssai_license).
// individual / sole_proprietor require no extra entity documents.
const ENTITY_REQUIRED_DOCUMENTS: Partial<Record<BusinessEntity, DocumentType[]>> = {
  [BusinessEntity.partnership]: [DocumentType.partnership_deed],
  [BusinessEntity.llp]: [
    DocumentType.llp_agreement,
    DocumentType.incorporation_certificate,
  ],
  [BusinessEntity.private_limited]: [
    DocumentType.incorporation_certificate,
    DocumentType.board_resolution,
  ],
  [BusinessEntity.public_limited]: [
    DocumentType.incorporation_certificate,
    DocumentType.board_resolution,
  ],
};

// Human-readable labels for entity-document errors.
const DOCUMENT_LABELS: Record<string, string> = {
  [DocumentType.partnership_deed]: 'Partnership deed',
  [DocumentType.llp_agreement]: 'LLP agreement',
  [DocumentType.incorporation_certificate]: 'Certificate of incorporation',
  [DocumentType.board_resolution]: 'Board resolution',
};

const NON_EDITABLE_STATUSES: PropertyStatus[] = [
  PropertyStatus.pending_review,
  PropertyStatus.approved,
];

const DECIDED_STATUSES: PropertyStatus[] = [
  PropertyStatus.approved,
  PropertyStatus.rejected,
  PropertyStatus.suspended,
];

export interface CreateDraftResult {
  propertyId: string;
}

export interface DraftView {
  propertyId: string;
  status: PropertyStatus;
  draftStep: number | null;
  draftData: Record<string, unknown>;
  compliance: ComplianceSummary | null;
}

export interface SaveStepResult {
  propertyId: string;
  draftStep: number | null;
  draftData: Record<string, unknown>;
  compliance?: ComplianceSummary;
}

export interface SubmitResult {
  propertyId: string;
  status: PropertyStatus;
  submissionRef: string;
  submittedAt: Date;
}

export interface TimelineEntry {
  label: string;
  status: 'done' | 'current' | 'pending';
  at: Date | null;
}

export interface StatusView {
  status: PropertyStatus;
  submissionRef: string | null;
  submittedAt: Date | null;
  revisionCount: number;
  revisionNotes: unknown;
  timeline: TimelineEntry[];
}

export interface OwnerSettingsView {
  defaultCheckinTime: string | null;
  defaultCheckoutTime: string | null;
  minBookingHours: number | null;
  isActive: boolean;
  houseRules: unknown;
}

interface MaterializedSubmission {
  propertyUpdate: Prisma.PropertyUpdateInput;
  roomTypes: Array<Omit<Prisma.RoomTypeCreateManyInput, 'propertyId'>>;
  photos: Array<Omit<Prisma.PropertyPhotoCreateManyInput, 'propertyId'>>;
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly repo: PropertiesRepository,
    private readonly compliance: ComplianceService,
    private readonly events: TypedEventEmitter,
  ) {}

  /**
   * POST /properties/draft - per M1 spec edge case 12, always creates a new
   * Property (multi-property owners are allowed) and grants the caller
   * OWNER on it.
   */
  async createDraft(ownerId: string): Promise<CreateDraftResult> {
    const property = await this.repo.create({
      name: 'Untitled property',
      ownerId,
      status: PropertyStatus.draft,
      amenities: [],
    });
    await this.repo.createOwnerRole(ownerId, property.id);
    return { propertyId: property.id };
  }

  /**
   * GET /properties/:id/draft - returns the accumulated wizard state for
   * resume-from-draft. Step-5 (compliance) summary is added by
   * ComplianceService once it lands (M1 Gate 1c).
   */
  async getDraft(propertyId: string): Promise<DraftView> {
    const property = await this.findPropertyOrThrow(propertyId);
    return {
      propertyId: property.id,
      status: property.status,
      draftStep: property.draftStep,
      draftData: this.draftDataOf(property),
      compliance: await this.compliance.getSummary(propertyId),
    };
  }

  /**
   * PATCH /properties/:id/step/:stepNum - steps 1-4 merge into draftData;
   * step 5 is delegated to the compliance module (M1 Gate 1c).
   */
  async saveStep(
    propertyId: string,
    stepNum: number,
    body: unknown,
  ): Promise<SaveStepResult> {
    if (!Number.isInteger(stepNum) || stepNum < MIN_STEP || stepNum > MAX_STEP) {
      throw new BadRequestException('Invalid step number');
    }

    const property = await this.findPropertyOrThrow(propertyId);
    this.assertDraftEditable(property);

    if (stepNum === 5) {
      return this.saveStep5(property, body);
    }

    const dtoClass = STEP_DTO_MAP[stepNum as 1 | 2 | 3 | 4];
    const validated = await validateStepPayload(stepNum, dtoClass, body);

    if (stepNum === 3) {
      this.assertAtLeastOneRoomCounted(stepNum, validated);
    }
    if (stepNum === 4) {
      this.assertPhotoCategoryLimits(stepNum, validated as unknown as Step4PhotosDto);
    }

    const draftData = {
      ...this.draftDataOf(property),
      [`step${stepNum}`]: validated,
    };
    const draftStep = Math.max(property.draftStep ?? 0, stepNum);

    const updateData: Prisma.PropertyUpdateInput = {
      draftData: draftData as Prisma.InputJsonValue,
      draftStep,
    };
    if (stepNum === 1) {
      // Keep the canonical `name` column in sync with step 1's
      // propertyName for listings/search before submission.
      const step1 = validated as unknown as Step1BasicsDto;
      updateData.name = step1.propertyName;
    }

    const updated = await this.repo.update(propertyId, updateData);

    return {
      propertyId: updated.id,
      draftStep: updated.draftStep,
      draftData: this.draftDataOf(updated),
    };
  }

  /**
   * Step 5 (legal/payout) writes directly to PropertyComplianceDoc /
   * PropertyDocument (compliance schema) via ComplianceService rather than
   * draftData - see M1 spec Section 3.
   */
  private async saveStep5(property: Property, body: unknown): Promise<SaveStepResult> {
    const dto = await validateStepPayload(5, Step5LegalDto, body);
    const summary = await this.compliance.saveStep5(
      property.id,
      dto as unknown as Step5LegalDto,
    );

    const draftStep = Math.max(property.draftStep ?? 0, 5);
    const updated = await this.repo.update(property.id, { draftStep });

    return {
      propertyId: updated.id,
      draftStep: updated.draftStep,
      draftData: this.draftDataOf(updated),
      compliance: summary,
    };
  }

  /**
   * POST /properties/:id/submit - first submission. Re-validates steps 1-5
   * (M1 spec edge case 5), materializes RoomType/PropertyPhoto rows and the
   * Property's onboarding columns, then flips status to `pending_review` and
   * emits `hotel.onboarding.submitted`.
   */
  async submit(propertyId: string): Promise<SubmitResult> {
    const property = await this.findPropertyOrThrow(propertyId);
    if (property.status !== PropertyStatus.draft) {
      throw new ConflictException('Only draft properties can be submitted');
    }

    const materialized = await this.validateAndMaterialize(property);
    const submissionRef = await this.repo.generateSubmissionRef();
    const submittedAt = new Date();

    const updated = await this.repo.update(propertyId, {
      ...materialized.propertyUpdate,
      status: PropertyStatus.pending_review,
      submissionRef,
      submittedAt,
      draftData: Prisma.DbNull,
      draftStep: null,
    });
    await this.repo.replaceRoomTypes(propertyId, materialized.roomTypes);
    await this.repo.replacePhotos(propertyId, materialized.photos);

    this.emitSubmitted(updated, submissionRef);

    return {
      propertyId: updated.id,
      status: updated.status,
      submissionRef,
      submittedAt,
    };
  }

  /**
   * PATCH /properties/:id/revise - resubmission after `needs_revision`.
   * Re-runs the same validation/materialization as `submit`, but keeps the
   * existing `submissionRef` and does NOT increment `revisionCount` (M1
   * spec Section 3).
   */
  async revise(propertyId: string): Promise<SubmitResult> {
    const property = await this.findPropertyOrThrow(propertyId);
    if (property.status !== PropertyStatus.needs_revision) {
      throw new ConflictException('Only properties marked needs_revision can be resubmitted');
    }

    const materialized = await this.validateAndMaterialize(property);
    const submittedAt = new Date();

    const updated = await this.repo.update(propertyId, {
      ...materialized.propertyUpdate,
      status: PropertyStatus.pending_review,
      submittedAt,
      draftData: Prisma.DbNull,
      draftStep: null,
    });
    await this.repo.replaceRoomTypes(propertyId, materialized.roomTypes);
    await this.repo.replacePhotos(propertyId, materialized.photos);

    const submissionRef = updated.submissionRef as string;
    this.emitSubmitted(updated, submissionRef);

    return {
      propertyId: updated.id,
      status: updated.status,
      submissionRef,
      submittedAt,
    };
  }

  /**
   * GET /properties/:id/status - submission status + derived timeline for
   * the owner-facing tracker.
   */
  async getStatus(propertyId: string): Promise<StatusView> {
    const property = await this.findPropertyOrThrow(propertyId);
    return {
      status: property.status,
      submissionRef: property.submissionRef,
      submittedAt: property.submittedAt,
      revisionCount: property.revisionCount,
      revisionNotes: property.revisionNotes,
      timeline: this.buildTimeline(property),
    };
  }

  /** GET /owner/.../settings — owner-editable operational settings. */
  async getSettings(propertyId: string): Promise<OwnerSettingsView> {
    const p = await this.findPropertyOrThrow(propertyId);
    return {
      defaultCheckinTime: p.defaultCheckinTime,
      defaultCheckoutTime: p.defaultCheckoutTime,
      minBookingHours: p.minBookingHours,
      isActive: p.isActive,
      houseRules: p.houseRules,
    };
  }

  /** PATCH /owner/.../settings — narrow, safe operational edits on a live property. */
  async updateSettings(propertyId: string, dto: UpdateOwnerSettingsDto): Promise<OwnerSettingsView> {
    await this.findPropertyOrThrow(propertyId);
    const data: Prisma.PropertyUpdateInput = {};
    if (dto.defaultCheckinTime !== undefined) data.defaultCheckinTime = dto.defaultCheckinTime;
    if (dto.defaultCheckoutTime !== undefined) data.defaultCheckoutTime = dto.defaultCheckoutTime;
    if (dto.minBookingHours !== undefined) data.minBookingHours = dto.minBookingHours;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    const updated = await this.repo.update(propertyId, data);
    return this.getSettings(updated.id);
  }

  /** GET /owner/.../rooms — the property's room types. */
  async getRooms(propertyId: string): Promise<RoomType[]> {
    await this.findPropertyOrThrow(propertyId);
    return this.repo.findRoomTypes(propertyId);
  }

  /** PATCH /owner/.../rooms/:roomId — edit count/rates/occupancy (rupees → paise). */
  async updateRoom(propertyId: string, roomId: string, dto: UpdateRoomDto): Promise<RoomType> {
    await this.findPropertyOrThrow(propertyId);
    const data: Prisma.RoomTypeUpdateInput = {};
    if (dto.count !== undefined) data.count = dto.count;
    if (dto.maxOccupancy !== undefined) data.maxOccupancy = dto.maxOccupancy;
    if (dto.hourlyRate !== undefined) data.hourlyRatePaise = dto.hourlyRate * 100;
    if (dto.fulldayRate !== undefined) data.fulldayRatePaise = dto.fulldayRate * 100;
    const updated = await this.repo.updateRoomType(roomId, propertyId, data);
    if (!updated) throw new NotFoundException('Room not found for this property');
    return updated;
  }

  private emitSubmitted(property: Property, submissionRef: string): void {
    this.events.emit(DOMAIN_EVENTS.HOTEL_ONBOARDING_SUBMITTED, {
      hotelId: property.id,
      ownerId: property.ownerId,
      bookingMode: property.bookingPolicy as 'hourly' | 'fullday' | 'both',
      submissionRef,
    });
  }

  // M1 spec edge cases 5/6/13: re-validates steps 1-5 against their DTOs,
  // applies cross-step conditional requirements deferred from step-save
  // time, and converts wizard data into the columns/rows submission writes.
  private async validateAndMaterialize(property: Property): Promise<MaterializedSubmission> {
    const draftData = this.draftDataOf(property);

    const step1 = await this.validateStoredStep<Step1BasicsDto>(
      1,
      STEP_DTO_MAP[1],
      draftData.step1,
    );
    const step2 = await this.validateStoredStep<Step2LocationDto>(
      2,
      STEP_DTO_MAP[2],
      draftData.step2,
    );
    const step3 = await this.validateStoredStep<Step3RoomsPoliciesDto>(
      3,
      STEP_DTO_MAP[3],
      draftData.step3,
    );
    const step4 = await this.validateStoredStep<Step4PhotosDto>(
      4,
      STEP_DTO_MAP[4],
      draftData.step4,
    );

    const compliance = await this.compliance.getSummary(property.id);
    if (!compliance) {
      throw new BadRequestException({
        step: 5,
        errors: [
          {
            field: 'documents',
            constraints: ['Step 5 (legal & payout details) is incomplete'],
          },
        ],
      });
    }

    this.assertConditionalFields(step1, step3, compliance);

    const roomTypes = step3.rooms
      .filter((room) => room.count > 0)
      .map((room) => ({
        type: room.type,
        count: room.count,
        hourlyRatePaise: room.hourlyRate != null ? Math.round(room.hourlyRate * 100) : null,
        fulldayRatePaise: room.fulldayRate != null ? Math.round(room.fulldayRate * 100) : null,
        maxOccupancy: room.maxOccupancy ?? null,
      }));

    const photos = step4.photos.map((photo, index) => ({
      category: photo.category,
      url: photo.url,
      isPrimary: photo.isPrimary ?? false,
      sortOrder: photo.sortOrder ?? index,
    }));

    const propertyUpdate: Prisma.PropertyUpdateInput = {
      name: step1.propertyName,
      propertyType: step1.propertyType,
      bookingPolicy: step1.bookingPolicy,
      businessEntity: step1.businessEntity,
      ownerFirstName: step1.ownerFirstName,
      ownerMiddleName: step1.ownerMiddleName ?? null,
      ownerLastName: step1.ownerLastName,
      category: step1.category,
      description: step1.description ?? null,
      latitude: step2.latitude,
      longitude: step2.longitude,
      addressLine1: step2.addressLine1,
      addressLine2: step2.addressLine2,
      pincode: step2.pincode,
      city: step2.city,
      state: step2.state,
      landmark: step2.landmark ?? null,
      specialNote: step2.specialNote ?? null,
      amenities: step3.amenities,
      houseRules: step3.houseRules as unknown as Prisma.InputJsonValue,
      minBookingHours: step3.minBookingHours ? Number(step3.minBookingHours) : null,
      defaultCheckinTime: step3.defaultCheckinTime ?? '12:00',
      defaultCheckoutTime: step3.defaultCheckoutTime ?? '11:00',
      seatingCapacity: step3.seatingCapacity ?? null,
    };

    return { propertyUpdate, roomTypes, photos };
  }

  // Re-validates a stored draftData.stepN payload against its DTO at
  // submission time (edge case 5) - missing/invalid step -> 400 {step, errors}.
  private async validateStoredStep<T>(
    stepNum: number,
    dtoClass: new () => object,
    data: unknown,
  ): Promise<T> {
    if (data == null || typeof data !== 'object') {
      throw new BadRequestException({
        step: stepNum,
        errors: [{ field: '_step', constraints: [`Step ${stepNum} is incomplete`] }],
      });
    }
    return (await validateStepPayload(stepNum, dtoClass, data)) as unknown as T;
  }

  // M1 spec edge case 6: conditional fields deferred from individual step
  // saves are validated here at submission time.
  private assertConditionalFields(
    step1: Step1BasicsDto,
    step3: Step3RoomsPoliciesDto,
    compliance: ComplianceSummary,
  ): void {
    const step3Errors: Array<{ field: string; constraints: string[] }> = [];

    if (step1.bookingPolicy !== BookingPolicy.fullday && !step3.minBookingHours) {
      step3Errors.push({
        field: 'minBookingHours',
        constraints: ['minBookingHours is required unless bookingPolicy is "fullday"'],
      });
    }

    step3.rooms
      .filter((room) => room.count > 0)
      .forEach((room, index) => {
        if (
          (step1.bookingPolicy === BookingPolicy.hourly ||
            step1.bookingPolicy === BookingPolicy.both) &&
          room.hourlyRate == null
        ) {
          step3Errors.push({
            field: `rooms[${index}].hourlyRate`,
            constraints: ['hourlyRate is required for this booking policy'],
          });
        }
        if (
          (step1.bookingPolicy === BookingPolicy.fullday ||
            step1.bookingPolicy === BookingPolicy.both) &&
          room.fulldayRate == null
        ) {
          step3Errors.push({
            field: `rooms[${index}].fulldayRate`,
            constraints: ['fulldayRate is required for this booking policy'],
          });
        }
      });

    if (step1.propertyType === PropertyType.banquet && step3.seatingCapacity == null) {
      step3Errors.push({
        field: 'seatingCapacity',
        constraints: ['seatingCapacity is required for banquet properties'],
      });
    }

    if (step3Errors.length > 0) {
      throw new BadRequestException({ step: 3, errors: step3Errors });
    }

    const documentTypes = new Set(compliance.documents.map((document) => document.type));
    const step5Errors: Array<{ field: string; constraints: string[] }> = [];

    // GSTIN is entity-only: required unless the entity is individual /
    // sole_proprietor. compliance.gstinMasked is null when no GSTIN was stored.
    if (!GSTIN_EXEMPT_ENTITIES.includes(step1.businessEntity) && !compliance.gstinMasked) {
      step5Errors.push({
        field: 'gstin',
        constraints: [`GSTIN is required for ${step1.businessEntity} entities`],
      });
    }

    if (!documentTypes.has(DocumentType.fire_safety_cert)) {
      step5Errors.push({
        field: 'documents',
        constraints: ['Fire safety certificate is required'],
      });
    }

    const fssaiIds = REQUIRES_FSSAI as readonly string[];
    const requiresFssai = step3.amenities.some((amenity) => fssaiIds.includes(amenity));
    if (requiresFssai && !documentTypes.has(DocumentType.fssai_license)) {
      step5Errors.push({
        field: 'documents',
        constraints: ['FSSAI license is required for the selected amenities'],
      });
    }

    // Entity -> required documents matrix.
    const requiredEntityDocs = ENTITY_REQUIRED_DOCUMENTS[step1.businessEntity] ?? [];
    for (const docType of requiredEntityDocs) {
      if (!documentTypes.has(docType)) {
        const label = DOCUMENT_LABELS[docType] ?? docType;
        step5Errors.push({
          field: 'documents',
          constraints: [`${label} is required for ${step1.businessEntity} entities`],
        });
      }
    }

    if (step5Errors.length > 0) {
      throw new BadRequestException({ step: 5, errors: step5Errors });
    }
  }

  // M1 spec Section 3: derives the Submitted/Under Review/Decision/Live
  // tracker shown to owners on GET /properties/:id/status.
  private buildTimeline(property: Property): TimelineEntry[] {
    const isDecided = DECIDED_STATUSES.includes(property.status);

    const submitted: TimelineEntry = {
      label: 'Submitted',
      status: property.submittedAt ? 'done' : 'pending',
      at: property.submittedAt,
    };

    const underReview: TimelineEntry = {
      label: 'Under Review',
      status: !property.submittedAt ? 'pending' : isDecided ? 'done' : 'current',
      at: property.submittedAt,
    };

    const decision: TimelineEntry = {
      label: 'Decision',
      status: isDecided ? 'done' : 'pending',
      at: isDecided ? property.updatedAt : null,
    };

    const live: TimelineEntry = {
      label: 'Live',
      status: property.status === PropertyStatus.approved && property.isActive ? 'done' : 'pending',
      at: property.status === PropertyStatus.approved ? property.updatedAt : null,
    };

    return [submitted, underReview, decision, live];
  }

  private async findPropertyOrThrow(propertyId: string): Promise<Property> {
    const property = await this.repo.findById(propertyId);
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    return property;
  }

  // M1 spec edge case 4: drafts are editable in `draft`/`needs_revision`;
  // `pending_review`/`approved` reject edits with 409.
  private assertDraftEditable(property: Property): void {
    if (NON_EDITABLE_STATUSES.includes(property.status)) {
      throw new ConflictException(
        'Cannot edit this property while it is under review or approved',
      );
    }
  }

  private draftDataOf(property: Property): Record<string, unknown> {
    return (property.draftData as Record<string, unknown> | null) ?? {};
  }

  // step3Schema.refine: at least one room type must have count > 0
  private assertAtLeastOneRoomCounted(
    stepNum: number,
    validated: Record<string, unknown>,
  ): void {
    const rooms = (validated.rooms as Array<{ count: number }> | undefined) ?? [];
    if (!rooms.some((room) => room.count > 0)) {
      throw new BadRequestException({
        step: stepNum,
        errors: [
          {
            field: 'rooms',
            constraints: ['At least one room type must have a count greater than 0'],
          },
        ],
      });
    }
  }

  // M1 spec edge case 14: 1-5 photos per category, 25 total. Total is
  // enforced by @ArrayMaxSize on Step4PhotosDto; per-category here.
  private assertPhotoCategoryLimits(
    stepNum: number,
    validated: { photos?: Array<{ category: string }> },
  ): void {
    const counts = new Map<string, number>();
    for (const photo of validated.photos ?? []) {
      counts.set(photo.category, (counts.get(photo.category) ?? 0) + 1);
    }
    const overLimit = PHOTO_CATEGORIES.filter(
      (category) => (counts.get(category) ?? 0) > MAX_PHOTOS_PER_CATEGORY,
    );
    if (overLimit.length > 0) {
      throw new BadRequestException({
        step: stepNum,
        errors: overLimit.map((category) => ({
          field: 'photos',
          constraints: [
            `category "${category}" has more than ${MAX_PHOTOS_PER_CATEGORY} photos`,
          ],
        })),
      });
    }
  }
}

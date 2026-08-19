import { ConflictException, Injectable } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { EncryptionService } from '../../../common/crypto/encryption.service';
import { Step5LegalDto } from '../dto/step5-legal.dto';
import { ComplianceRepository } from './compliance.repository';

export interface ComplianceSummary {
  legalBusinessName: string;
  // null when no GSTIN was provided (individual / sole_proprietor).
  gstinMasked: string | null;
  panMasked: string;
  bankAccountNumberMasked: string;
  ifsc: string;
  accountHolderName: string;
  documents: Array<{ type: string; status: DocumentStatus; expiresAt: Date | null }>;
}

export interface AdminComplianceSummary {
  legalBusinessName: string;
  // null when no GSTIN was provided (individual / sole_proprietor).
  gstin: string | null;
  pan: string;
  bankAccountNumber: string;
  ifsc: string;
  accountHolderName: string;
  documents: Array<{
    type: string;
    url: string;
    status: DocumentStatus;
    expiresAt: Date | null;
  }>;
}

@Injectable()
export class ComplianceService {
  constructor(
    private readonly repo: ComplianceRepository,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * PATCH /properties/:id/step/5 - upserts PropertyComplianceDoc (encrypted
   * GSTIN/PAN/bank account) and replaces PropertyDocument rows.
   *
   * M1 spec edge case 7: gstinHash must be unique across
   * PropertyComplianceDoc rows EXCEPT the row for this same propertyId.
   */
  async saveStep5(propertyId: string, dto: Step5LegalDto): Promise<ComplianceSummary> {
    // GSTIN is entity-only: absent for individual/sole_proprietor. When absent
    // we store NULL for both columns (nullable @unique gstin_hash, NULLs never
    // collide) and skip the cross-property GSTIN dedup check.
    const gstinHash = dto.gstin ? this.encryption.lookupHash(dto.gstin) : null;
    const panHash = this.encryption.lookupHash(dto.pan);
    const bankAccountNumberHash = this.encryption.lookupHash(dto.bankAccountNumber);

    if (gstinHash) {
      const existingByGstin = await this.repo.findComplianceDocByGstinHash(gstinHash);
      if (existingByGstin && existingByGstin.propertyId !== propertyId) {
        throw new ConflictException(
          'This GSTIN is already registered with another property.',
        );
      }
    }

    const now = new Date();
    await this.repo.upsertComplianceDoc(propertyId, {
      legalBusinessName: dto.legalBusinessName,
      gstinEncrypted: dto.gstin ? this.encryption.encrypt(dto.gstin) : null,
      gstinHash,
      panEncrypted: this.encryption.encrypt(dto.pan),
      panHash,
      bankAccountNumberEncrypted: this.encryption.encrypt(dto.bankAccountNumber),
      bankAccountNumberHash,
      ifsc: dto.ifsc,
      accountHolderName: dto.accountHolderName,
      tcAcceptedAt: now,
      formCAcknowledgedAt: now,
    });

    await this.repo.replaceDocuments(
      propertyId,
      (dto.documents ?? []).map((doc) => ({
        type: doc.type,
        url: doc.url,
        expiresAt: doc.expiresAt ? new Date(doc.expiresAt) : null,
        status: DocumentStatus.pending,
      })),
    );

    const summary = await this.getSummary(propertyId);
    // Always non-null here - we just upserted it.
    return summary as ComplianceSummary;
  }

  /**
   * GET /properties/:id/draft - masked step-5 summary (M1 spec edge case
   * 15: never return plaintext GSTIN/PAN/bank account number).
   */
  async getSummary(propertyId: string): Promise<ComplianceSummary | null> {
    const doc = await this.repo.findComplianceDocByProperty(propertyId);
    if (!doc) {
      return null;
    }

    const documents = await this.repo.findDocumentsByProperty(propertyId);

    return {
      legalBusinessName: doc.legalBusinessName,
      gstinMasked: doc.gstinEncrypted
        ? this.encryption.maskValue(this.encryption.decrypt(doc.gstinEncrypted), {
            keepStart: 2,
            keepEnd: 5,
          })
        : null,
      panMasked: this.encryption.maskValue(this.encryption.decrypt(doc.panEncrypted), {
        keepStart: 0,
        keepEnd: 4,
      }),
      bankAccountNumberMasked: this.encryption.maskValue(
        this.encryption.decrypt(doc.bankAccountNumberEncrypted),
        { keepStart: 0, keepEnd: 4 },
      ),
      ifsc: doc.ifsc,
      accountHolderName: doc.accountHolderName,
      documents: documents.map((document) => ({
        type: document.type,
        status: document.status,
        expiresAt: document.expiresAt,
      })),
    };
  }

  /**
   * GET /admin/properties/:id - decrypted GSTIN/PAN/bank account for admin
   * verification against uploaded documents. Restricted to ADMIN/SUPER_ADMIN
   * via RolesGuard at the controller level (M2B spec edge case 8).
   */
  async getAdminSummary(propertyId: string): Promise<AdminComplianceSummary | null> {
    const doc = await this.repo.findComplianceDocByProperty(propertyId);
    if (!doc) {
      return null;
    }

    const documents = await this.repo.findDocumentsByProperty(propertyId);

    return {
      legalBusinessName: doc.legalBusinessName,
      gstin: doc.gstinEncrypted ? this.encryption.decrypt(doc.gstinEncrypted) : null,
      pan: this.encryption.decrypt(doc.panEncrypted),
      bankAccountNumber: this.encryption.decrypt(doc.bankAccountNumberEncrypted),
      ifsc: doc.ifsc,
      accountHolderName: doc.accountHolderName,
      documents: documents.map((document) => ({
        type: document.type,
        url: document.url,
        status: document.status,
        expiresAt: document.expiresAt,
      })),
    };
  }
}

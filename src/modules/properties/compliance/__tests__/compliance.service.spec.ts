import { ConflictException } from '@nestjs/common';
import { DocumentStatus, DocumentType, PropertyComplianceDoc, PropertyDocument } from '@prisma/client';
import { Step5LegalDto } from '../../dto/step5-legal.dto';
import { ComplianceService } from '../compliance.service';

const now = new Date('2026-06-11T00:00:00.000Z');

const step5Dto: Step5LegalDto = {
  gstin: '29ABCDE1234F1Z5',
  legalBusinessName: 'Sunrise Hospitality',
  pan: 'ABCDE1234F',
  bankAccountNumber: '123456789012',
  ifsc: 'HDFC0000123',
  accountHolderName: 'Ravi Kumar',
  tcAccepted: true,
  formCAcknowledged: true,
  documents: [{ type: DocumentType.fire_safety_cert, url: 'https://example.com/fire.pdf' }],
};

function buildComplianceDoc(overrides: Partial<PropertyComplianceDoc> = {}): PropertyComplianceDoc {
  return {
    id: 'doc-1',
    propertyId: 'prop-1',
    legalBusinessName: 'Sunrise Hospitality',
    gstinEncrypted: 'enc:gstin',
    gstinHash: 'hash-gstin',
    panEncrypted: 'enc:pan',
    panHash: 'hash-pan',
    bankAccountNumberEncrypted: 'enc:bank',
    bankAccountNumberHash: 'hash-bank',
    ifsc: 'HDFC0000123',
    accountHolderName: 'Ravi Kumar',
    tcAcceptedAt: now,
    formCAcknowledgedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const documentRow: PropertyDocument = {
  id: 'pdoc-1',
  propertyId: 'prop-1',
  type: DocumentType.fire_safety_cert,
  url: 'https://example.com/fire.pdf',
  status: DocumentStatus.pending,
  expiresAt: null,
  rejectionReason: null,
  createdAt: now,
  updatedAt: now,
};

describe(ComplianceService.name, () => {
  const repo = {
    findComplianceDocByProperty: jest.fn(),
    findComplianceDocByGstinHash: jest.fn(),
    upsertComplianceDoc: jest.fn(),
    findDocumentsByProperty: jest.fn(),
    replaceDocuments: jest.fn(),
  };
  const encryption = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
    lookupHash: jest.fn(),
    hashesMatch: jest.fn(),
    maskValue: jest.fn(),
  };

  let service: ComplianceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ComplianceService(repo as never, encryption as never);

    encryption.lookupHash.mockImplementation((value: string) => `hash-${value}`);
    encryption.encrypt.mockImplementation((value: string) => `enc:${value}`);
    encryption.decrypt.mockImplementation((value: string) => value.replace(/^enc:/, ''));
    encryption.maskValue.mockImplementation((value: string) => `masked:${value}`);
    repo.upsertComplianceDoc.mockResolvedValue(buildComplianceDoc());
    repo.replaceDocuments.mockResolvedValue(undefined);
  });

  describe('saveStep5', () => {
    it('rejects a GSTIN already registered to a different property', async () => {
      repo.findComplianceDocByGstinHash.mockResolvedValue(buildComplianceDoc({ propertyId: 'other-property' }));

      await expect(service.saveStep5('prop-1', step5Dto)).rejects.toThrow(ConflictException);
      expect(repo.upsertComplianceDoc).not.toHaveBeenCalled();
    });

    it('allows re-saving the same property’s own GSTIN', async () => {
      repo.findComplianceDocByGstinHash.mockResolvedValue(buildComplianceDoc({ propertyId: 'prop-1' }));
      repo.findComplianceDocByProperty.mockResolvedValue(buildComplianceDoc());
      repo.findDocumentsByProperty.mockResolvedValue([documentRow]);

      await expect(service.saveStep5('prop-1', step5Dto)).resolves.toBeDefined();
      expect(repo.upsertComplianceDoc).toHaveBeenCalled();
    });

    it('encrypts GSTIN/PAN/bank details, stores lookup hashes, and replaces documents', async () => {
      repo.findComplianceDocByGstinHash.mockResolvedValue(null);
      repo.findComplianceDocByProperty.mockResolvedValue(buildComplianceDoc());
      repo.findDocumentsByProperty.mockResolvedValue([documentRow]);

      const summary = await service.saveStep5('prop-1', step5Dto);

      expect(repo.upsertComplianceDoc).toHaveBeenCalledWith(
        'prop-1',
        expect.objectContaining({
          legalBusinessName: 'Sunrise Hospitality',
          gstinEncrypted: 'enc:29ABCDE1234F1Z5',
          gstinHash: 'hash-29ABCDE1234F1Z5',
          panEncrypted: 'enc:ABCDE1234F',
          panHash: 'hash-ABCDE1234F',
          bankAccountNumberEncrypted: 'enc:123456789012',
          bankAccountNumberHash: 'hash-123456789012',
          ifsc: 'HDFC0000123',
          accountHolderName: 'Ravi Kumar',
        }),
      );
      expect(repo.replaceDocuments).toHaveBeenCalledWith('prop-1', [
        {
          type: DocumentType.fire_safety_cert,
          url: 'https://example.com/fire.pdf',
          expiresAt: null,
          status: DocumentStatus.pending,
        },
      ]);
      expect(summary).not.toBeNull();
      expect(summary?.legalBusinessName).toBe('Sunrise Hospitality');
    });

    it('parses document expiresAt into a Date when provided', async () => {
      repo.findComplianceDocByGstinHash.mockResolvedValue(null);
      repo.findComplianceDocByProperty.mockResolvedValue(buildComplianceDoc());
      repo.findDocumentsByProperty.mockResolvedValue([documentRow]);

      await service.saveStep5('prop-1', {
        ...step5Dto,
        documents: [
          { type: DocumentType.fssai_license, url: 'https://example.com/fssai.pdf', expiresAt: '2027-01-01T00:00:00.000Z' },
        ],
      });

      expect(repo.replaceDocuments).toHaveBeenCalledWith('prop-1', [
        {
          type: DocumentType.fssai_license,
          url: 'https://example.com/fssai.pdf',
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
          status: DocumentStatus.pending,
        },
      ]);
    });
  });

  describe('getSummary', () => {
    it('returns null when no compliance doc exists', async () => {
      repo.findComplianceDocByProperty.mockResolvedValue(null);
      await expect(service.getSummary('prop-1')).resolves.toBeNull();
    });

    it('returns a masked summary built from the decrypted fields', async () => {
      repo.findComplianceDocByProperty.mockResolvedValue(buildComplianceDoc());
      repo.findDocumentsByProperty.mockResolvedValue([documentRow]);

      const summary = await service.getSummary('prop-1');

      expect(summary).toEqual({
        legalBusinessName: 'Sunrise Hospitality',
        gstinMasked: 'masked:gstin',
        panMasked: 'masked:pan',
        bankAccountNumberMasked: 'masked:bank',
        ifsc: 'HDFC0000123',
        accountHolderName: 'Ravi Kumar',
        documents: [{ type: DocumentType.fire_safety_cert, status: DocumentStatus.pending, expiresAt: null }],
      });
    });
  });
});

import { Injectable } from '@nestjs/common';
import { Prisma, PropertyComplianceDoc, PropertyDocument } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ComplianceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findComplianceDocByProperty(propertyId: string): Promise<PropertyComplianceDoc | null> {
    return this.prisma.propertyComplianceDoc.findUnique({ where: { propertyId } });
  }

  findComplianceDocByGstinHash(gstinHash: string): Promise<PropertyComplianceDoc | null> {
    return this.prisma.propertyComplianceDoc.findUnique({ where: { gstinHash } });
  }

  upsertComplianceDoc(
    propertyId: string,
    data: Omit<Prisma.PropertyComplianceDocCreateInput, 'propertyId'>,
  ): Promise<PropertyComplianceDoc> {
    return this.prisma.propertyComplianceDoc.upsert({
      where: { propertyId },
      create: { propertyId, ...data },
      update: { ...data },
    });
  }

  findDocumentsByProperty(propertyId: string): Promise<PropertyDocument[]> {
    return this.prisma.propertyDocument.findMany({ where: { propertyId } });
  }

  /**
   * Replaces all PropertyDocument rows for a property with the given set
   * (step 5 is re-saveable while in draft/needs_revision - simplest correct
   * semantics is full replace rather than incremental upsert).
   */
  async replaceDocuments(
    propertyId: string,
    documents: Array<Pick<Prisma.PropertyDocumentCreateManyInput, 'type' | 'url' | 'expiresAt'>>,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.propertyDocument.deleteMany({ where: { propertyId } }),
      ...(documents.length > 0
        ? [
            this.prisma.propertyDocument.createMany({
              data: documents.map((doc) => ({ ...doc, propertyId })),
            }),
          ]
        : []),
    ]);
  }
}

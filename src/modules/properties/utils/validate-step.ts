import { BadRequestException } from '@nestjs/common';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

export interface StepValidationError {
  field: string;
  constraints: string[];
}

/**
 * Validates a raw step payload against its DTO class (per M1 spec edge case
 * 5: "Missing/invalid step -> 400 with `{ step, errors }`"). Returns the
 * validated payload as a plain object (safe to store in a Prisma Json
 * column).
 */
export async function validateStepPayload<T extends object>(
  stepNum: number,
  dtoClass: new () => T,
  body: unknown,
): Promise<Record<string, unknown>> {
  const instance = plainToInstance(dtoClass, body ?? {});
  const errors = await validate(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  if (errors.length > 0) {
    throw new BadRequestException({
      step: stepNum,
      errors: flattenValidationErrors(errors),
    });
  }

  return instanceToPlain(instance) as Record<string, unknown>;
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): StepValidationError[] {
  const result: StepValidationError[] = [];
  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    if (error.constraints) {
      result.push({ field: path, constraints: Object.values(error.constraints) });
    }
    if (error.children?.length) {
      result.push(...flattenValidationErrors(error.children, path));
    }
  }
  return result;
}

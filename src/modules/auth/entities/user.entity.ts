import { GlobalRole, PropertyRole, UserStatus } from '@prisma/client';

export { GlobalRole, PropertyRole, UserStatus };

export interface UserEntity {
  id: string;
  phone: string;
  email: string;
  passwordHash: string;
  globalRole: GlobalRole;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

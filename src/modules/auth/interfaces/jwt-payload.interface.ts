import { GlobalRole } from '../entities/user.entity';

export interface JwtPayload {
  id: string;
  phone: string;
  globalRole: GlobalRole;
  sessionId?: string;
}

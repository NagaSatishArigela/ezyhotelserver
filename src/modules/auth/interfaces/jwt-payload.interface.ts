import { GlobalRole } from '../entities/user.entity';

export interface JwtPayload {
  id: string;
  globalRole: GlobalRole;
  sessionId?: string;
}

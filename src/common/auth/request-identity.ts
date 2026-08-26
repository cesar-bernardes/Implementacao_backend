import type {
  GlobalRole,
  OrganizationRole,
} from '../../generated/prisma/enums';
export type RequestIdentity = {
  userId: string;
  sessionId: string;
  globalRole: GlobalRole;
  organizationId?: string;
  organizationRole?: OrganizationRole;
  permissions: readonly string[];
};

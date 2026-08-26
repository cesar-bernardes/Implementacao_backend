export type ApiStatus = {
  status: 'ok';
  service: 'gd-tech-api';
  timestamp: string;
};

export type GlobalRole = 'GLOBAL_ADMIN' | 'GLOBAL_RESTRICTED' | 'USER';

export type OrganizationRole =
  'OWNER' | 'SUPERVISOR' | 'IMPLEMENTATION_RESPONSIBLE' | 'VISITOR';

import { ForbiddenException, Injectable } from '@nestjs/common';
import { GlobalRole, OrganizationRole } from '../../generated/prisma/enums';
import type { RequestIdentity } from './request-identity';
@Injectable()
export class AuthorizationPolicy {
  assertOrganizationAccess(identity: RequestIdentity, organizationId: string) {
    if (
      identity.globalRole !== GlobalRole.GLOBAL_ADMIN &&
      identity.organizationId !== organizationId
    )
      throw new ForbiddenException('Acesso negado para esta empresa.');
  }
  canManageOrganization(identity: RequestIdentity) {
    return (
      identity.globalRole === GlobalRole.GLOBAL_ADMIN ||
      identity.organizationRole === OrganizationRole.OWNER ||
      identity.organizationRole === OrganizationRole.SUPERVISOR
    );
  }

  /**
   * Perguntas da implementação são colaborativas: qualquer membro ativo da
   * empresa pode consultar e responder, enquanto os administradores globais
   * podem fazer isso em qualquer empresa.
   */
  canViewAndRespondImplementationQuestions(
    identity: RequestIdentity,
    organizationId: string,
  ) {
    return (
      identity.globalRole === GlobalRole.GLOBAL_ADMIN ||
      identity.globalRole === GlobalRole.GLOBAL_RESTRICTED ||
      identity.organizationId === organizationId
    );
  }

  assertCanViewAndRespondImplementationQuestions(
    identity: RequestIdentity,
    organizationId: string,
  ) {
    if (
      !this.canViewAndRespondImplementationQuestions(identity, organizationId)
    )
      throw new ForbiddenException(
        'Acesso às perguntas da implementação não autorizado.',
      );
  }

  /**
   * Clientes podem consultar disponibilidade, mas detalhes do evento ficam
   * visíveis apenas para a GD Tech ou para a empresa dona do próprio evento.
   */
  canViewCalendarEventDetails(
    identity: RequestIdentity,
    organizationId?: string | null,
  ) {
    return (
      identity.globalRole === GlobalRole.GLOBAL_ADMIN ||
      identity.globalRole === GlobalRole.GLOBAL_RESTRICTED ||
      (!!organizationId && identity.organizationId === organizationId)
    );
  }
}

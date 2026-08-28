import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';

/** Mantém o nome legado do arquivo, mas aceita somente JWT real do Supabase. */
@Injectable()
export class DemoAdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Faça login para continuar.');
    const actor = await this.auth.me(authorization.slice(7));
    if (!actor || actor.globalRole !== 'GLOBAL_ADMIN' || !actor.active) {
      throw new ForbiddenException('Apenas administradores globais podem acessar este recurso.');
    }
    return true;
  }
}

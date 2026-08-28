import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SupabaseAuthService } from './supabase-auth.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseAuthService,
  ) {}

  async login(email: string, password: string) {
    const auth = await this.supabase.signIn(email.trim().toLowerCase(), password);
    const user = await this.activateUser(auth.user.id, auth.user.email ?? email);
    return this.sessionResponse(auth.session, user);
  }

  async refresh(refreshToken: string) {
    const auth = await this.supabase.refresh(refreshToken);
    const user = await this.activateUser(auth.user.id, auth.user.email ?? '');
    return this.sessionResponse(auth.session, user);
  }

  async me(accessToken: string) {
    const authUser = await this.supabase.getUser(accessToken);
    return this.activateUser(authUser.id, authUser.email ?? '');
  }

  async definePassword(accessToken: string, password: string) {
    const authUser = await this.supabase.definePassword(accessToken, password);
    const email = authUser.email ?? '';
    await this.activateUser(authUser.id, email);

    // A troca de senha não cria uma nova sessão no navegador. Fazemos um novo
    // login para que o primeiro acesso termine já autenticado no painel.
    const auth = await this.supabase.signIn(email, password);
    const user = await this.activateUser(auth.user.id, auth.user.email ?? email);
    return this.sessionResponse(auth.session, user);
  }

  async definePasswordWithTemporary(email: string, temporaryPassword: string, password: string) {
    const auth = await this.supabase.signIn(email.trim().toLowerCase(), temporaryPassword);
    return this.definePassword(auth.session.access_token, password);
  }

  async accessStatus(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { memberships: true },
    });
    if (!user || !user.active) return { status: 'UNKNOWN' as const };
    const firstAccess = user.memberships.some((membership) => membership.status === 'INVITED');
    return { status: firstAccess ? 'FIRST_ACCESS' as const : 'ACTIVE' as const };
  }

  async requestFirstAccess(email: string, redirectTo: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail }, include: { memberships: true } });
    if (!user || !user.memberships.some((membership) => membership.status === 'INVITED')) {
      return { message: 'Se o usuário estiver aguardando ativação, um novo acesso será enviado.' };
    }
    await this.supabase.resendInvite(normalizedEmail, redirectTo);
    return { message: 'Enviamos a confirmação para o e-mail cadastrado.' };
  }

  async invite(email: string, redirectTo: string) {
    return this.supabase.invite(email.trim().toLowerCase(), redirectTo);
  }

  async updateInvitedUser(authProviderId: string, email: string, name: string) {
    return this.supabase.updateUser(authProviderId, email.trim().toLowerCase(), name.trim());
  }

  async resendInvite(email: string, redirectTo: string) {
    return this.supabase.resendInvite(email.trim().toLowerCase(), redirectTo);
  }

  async generateFirstAccessLink(email: string, redirectTo: string) {
    return this.supabase.generateFirstAccessLink(email.trim().toLowerCase(), redirectTo);
  }

  async setTemporaryPassword(authProviderId: string, password: string) {
    return this.supabase.setTemporaryPassword(authProviderId, password);
  }

  private async activateUser(authProviderId: string, email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ authProviderId }, { email: normalizedEmail }] },
    });
    if (!existing || !existing.active) throw new UnauthorizedException('Usuário sem acesso ao sistema.');
    return this.prisma.user.update({
      where: { id: existing.id },
      data: {
        authProviderId,
        memberships: { updateMany: { where: { status: 'INVITED' }, data: { status: 'ACTIVE' } } },
      },
      include: { memberships: { include: { organization: true } } },
    });
  }

  private sessionResponse(session: { access_token: string; refresh_token: string; expires_at?: number }, user: Awaited<ReturnType<AuthService['activateUser']>>) {
    return { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at, user };
  }
}

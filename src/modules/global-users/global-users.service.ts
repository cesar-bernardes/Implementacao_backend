import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

type GlobalRole = 'GLOBAL_ADMIN' | 'GLOBAL_RESTRICTED';

@Injectable()
export class GlobalUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({
      where: { globalRole: { in: ['GLOBAL_ADMIN', 'GLOBAL_RESTRICTED'] } },
      select: {
        id: true,
        name: true,
        email: true,
        globalRole: true,
        active: true,
        createdAt: true,
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return Promise.all(
      users.map(async (user) => {
        const invitation = await this.auth.invitationStatus(user.email);
        return {
          ...user,
          invitationStatus: invitation.awaitingFirstAccess
            ? 'INVITED'
            : 'ACTIVE',
        };
      }),
    );
  }

  async invite(name: string, email: string, globalRole: GlobalRole) {
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedName || !normalizedEmail)
      throw new BadRequestException('Informe nome e e-mail do usuário.');

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing)
      throw new BadRequestException(
        'Já existe um usuário cadastrado com este e-mail.',
      );

    const pendingUser = await this.prisma.user.create({
      data: {
        authProviderId: `pending-${randomUUID()}`,
        email: normalizedEmail,
        name: normalizedName,
        globalRole,
      },
    });

    try {
      const webOrigin = this.config
        .getOrThrow<string>('WEB_ORIGIN')
        .split(',')[0]
        .trim();
      const authUser = await this.auth.invite(
        normalizedEmail,
        `${webOrigin}/primeiro-acesso`,
      );
      await this.prisma.user.update({
        where: { id: pendingUser.id },
        data: { authProviderId: authUser.id },
      });
    } catch (error) {
      await this.prisma.user.delete({ where: { id: pendingUser.id } });
      throw error;
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: pendingUser.id },
      select: {
        id: true,
        name: true,
        email: true,
        globalRole: true,
        active: true,
        createdAt: true,
      },
    });

    return {
      user: { ...user, invitationStatus: 'INVITED' as const },
      message:
        'Convite enviado. O usuário definirá a senha no primeiro acesso.',
    };
  }
}

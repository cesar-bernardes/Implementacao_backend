import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';

type MemberInput = {
  name: string;
  email: string;
  phone?: string;
  password: string;
  passwordConfirmation: string;
  role: 'OWNER' | 'SUPERVISOR' | 'IMPLEMENTATION_RESPONSIBLE';
};

type CreateOrganizationInput = {
  legalName: string;
  tradeName: string;
  document?: string;
  segment?: string;
  contactEmail?: string;
  phone?: string;
  city?: string;
  state?: string;
  members: MemberInput[];
};

type UpdateOrganizationInput = Omit<CreateOrganizationInput, 'members'> & {
  members: Array<
    Omit<MemberInput, 'password' | 'passwordConfirmation'> & { id: string }
  >;
};

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  list() {
    return this.prisma.organization.findMany({
      orderBy: { tradeName: 'asc' },
      include: {
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                active: true,
                globalRole: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        implementations: { select: { id: true, status: true } },
      },
    });
  }

  listFor(actor: { id: string; globalRole: string }) {
    if (actor.globalRole === 'GLOBAL_ADMIN') return this.list();
    return this.prisma.organization.findMany({
      where: { memberships: { some: { userId: actor.id, status: 'ACTIVE' } } },
      orderBy: { tradeName: 'asc' },
      include: {
        memberships: {
          where: { userId: actor.id },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                active: true,
                globalRole: true,
              },
            },
          },
        },
        implementations: { select: { id: true, status: true } },
      },
    });
  }

  get(id: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id },
      include: {
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                active: true,
                globalRole: true,
                authProviderId: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        implementations: { select: { id: true, status: true } },
      },
    });
  }

  async getFor(id: string, actor: { id: string; globalRole: string }) {
    if (actor.globalRole === 'GLOBAL_ADMIN') return this.get(id);
    const allowed = await this.prisma.membership.findFirst({
      where: { organizationId: id, userId: actor.id, status: 'ACTIVE' },
    });
    if (!allowed)
      throw new ForbiddenException('Você não possui acesso a esta empresa.');
    return this.get(id);
  }

  async update(id: string, input: UpdateOrganizationInput) {
    await this.prisma.organization.update({
      where: { id },
      data: {
        legalName: input.legalName.trim(),
        tradeName: input.tradeName.trim(),
        document: input.document?.trim() || null,
        segment: input.segment?.trim() || null,
        contactEmail: input.contactEmail?.trim().toLowerCase() || null,
        phone: input.phone?.trim() || null,
        city: input.city?.trim() || null,
        state: input.state?.trim().toUpperCase() || null,
      },
    });
    for (const member of input.members) {
      const membership = await this.prisma.membership.findFirstOrThrow({
        where: { id: member.id, organizationId: id },
        include: { user: true },
      });
      const email = member.email.trim().toLowerCase();
      await this.auth.updateInvitedUser(
        membership.user.authProviderId,
        email,
        member.name,
      );
      await this.prisma.user.update({
        where: { id: membership.userId },
        data: { email, name: member.name.trim() },
      });
      await this.prisma.membership.update({
        where: { id: membership.id },
        data: { role: member.role },
      });
    }
    return this.get(id);
  }

  async resendInvite(organizationId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirstOrThrow({
      where: { id: membershipId, organizationId },
      include: { user: true },
    });
    const webOrigin = this.config
      .getOrThrow<string>('WEB_ORIGIN')
      .split(',')[0]
      .trim();
    await this.auth.resendInvite(
      membership.user.email,
      `${webOrigin}/primeiro-acesso`,
    );
    return { message: 'Convite reenviado.', email: membership.user.email };
  }

  async generateFirstAccessLink(organizationId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirstOrThrow({
      where: { id: membershipId, organizationId },
      include: { user: true },
    });
    const webOrigin = this.config
      .getOrThrow<string>('WEB_ORIGIN')
      .split(',')[0]
      .trim();
    const link = await this.auth.generateFirstAccessLink(
      membership.user.email,
      `${webOrigin}/primeiro-acesso`,
    );
    return { link, email: membership.user.email };
  }

  async generateTemporaryAccess(organizationId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirstOrThrow({
      where: { id: membershipId, organizationId },
      include: { user: true },
    });
    const temporaryPassword = `${randomBytes(9).toString('base64url')}Aa1!`;
    await this.auth.setTemporaryPassword(
      membership.user.authProviderId,
      temporaryPassword,
    );
    return { email: membership.user.email, temporaryPassword };
  }

  async create(input: CreateOrganizationInput) {
    const members = input.members.filter(
      (member) => member.name.trim() && member.email.trim(),
    );
    const requiredRoles = ['OWNER', 'SUPERVISOR', 'IMPLEMENTATION_RESPONSIBLE'];
    const missing = requiredRoles.filter(
      (role) => !members.some((member) => member.role === role),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Cargos obrigatórios ausentes: ${missing.join(', ')}`,
      );
    }

    const normalizedEmails = members.map((member) =>
      member.email.trim().toLowerCase(),
    );
    if (new Set(normalizedEmails).size !== normalizedEmails.length) {
      throw new BadRequestException(
        'Cada colaborador deve possuir um e-mail diferente.',
      );
    }
    const invalidPassword = members.find(
      (member) =>
        member.password.length < 8 ||
        member.password !== member.passwordConfirmation,
    );
    if (invalidPassword) {
      throw new BadRequestException(
        `A senha e a confirmação de ${invalidPassword.name} devem ser iguais e possuir ao menos 8 caracteres.`,
      );
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email: { in: normalizedEmails } },
      select: { email: true },
    });
    if (existingUser) {
      throw new BadRequestException(
        `O e-mail ${existingUser.email} já está cadastrado no sistema.`,
      );
    }
    for (const email of normalizedEmails) {
      const authStatus = await this.auth.invitationStatus(email);
      if (authStatus.exists) {
        throw new BadRequestException(
          `O e-mail ${email} já possui uma conta de acesso. Use outro e-mail ou remova a conta antiga no Supabase.`,
        );
      }
    }

    const document = input.document?.trim() || undefined;
    if (
      document &&
      (await this.prisma.organization.findUnique({ where: { document } }))
    ) {
      throw new BadRequestException('Já existe uma empresa com este CNPJ.');
    }

    const createdAuthUserIds: string[] = [];

    try {
      const preparedMembers: Array<
        MemberInput & { email: string; authProviderId: string }
      > = [];
      for (const member of members) {
        const email = member.email.trim().toLowerCase();
        const authUser = await this.auth.createConfirmedUser(
          email,
          member.password,
          member.name,
        );
        createdAuthUserIds.push(authUser.id);
        preparedMembers.push({ ...member, email, authProviderId: authUser.id });
      }

      return await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            legalName: input.legalName.trim(),
            tradeName: input.tradeName.trim(),
            document,
            segment: input.segment?.trim() || undefined,
            contactEmail: input.contactEmail?.trim().toLowerCase() || undefined,
            phone: input.phone?.trim() || undefined,
            city: input.city?.trim() || undefined,
            state: input.state?.trim().toUpperCase() || undefined,
          },
        });

        for (const member of preparedMembers) {
          const user = await tx.user.create({
            data: {
              authProviderId: member.authProviderId,
              email: member.email,
              name: member.name.trim(),
              globalRole: 'USER',
            },
          });
          await tx.membership.create({
            data: {
              organizationId: organization.id,
              userId: user.id,
              role: member.role,
              status: 'ACTIVE',
            },
          });
        }

        return tx.organization.findUniqueOrThrow({
          where: { id: organization.id },
          include: {
            memberships: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    active: true,
                    globalRole: true,
                  },
                },
              },
            },
          },
        });
      });
    } catch (error) {
      await Promise.allSettled(
        createdAuthUserIds.map((userId) => this.auth.deleteUser(userId)),
      );
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        error instanceof Error
          ? `Não foi possível cadastrar a empresa: ${error.message}`
          : 'Não foi possível cadastrar a empresa.',
      );
    }
  }
}

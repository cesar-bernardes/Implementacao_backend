import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrganizationRole } from '../../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';

type MemberInput = {
  name: string;
  email: string;
  phone?: string;
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

type UpdateOrganizationInput = Omit<CreateOrganizationInput, 'members'> & { members: Array<MemberInput & { id: string }> };

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
          include: { user: { select: { id: true, name: true, email: true, active: true, globalRole: true } } },
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
        memberships: { where: { userId: actor.id }, include: { user: { select: { id: true, name: true, email: true, active: true, globalRole: true } } } },
        implementations: { select: { id: true, status: true } },
      },
    });
  }

  get(id: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id },
      include: {
        memberships: {
          include: { user: { select: { id: true, name: true, email: true, active: true, globalRole: true, authProviderId: true } } },
          orderBy: { createdAt: 'asc' },
        },
        implementations: { select: { id: true, status: true } },
      },
    });
  }

  async getFor(id: string, actor: { id: string; globalRole: string }) {
    if (actor.globalRole === 'GLOBAL_ADMIN') return this.get(id);
    const allowed = await this.prisma.membership.findFirst({ where: { organizationId: id, userId: actor.id, status: 'ACTIVE' } });
    if (!allowed) throw new ForbiddenException('Você não possui acesso a esta empresa.');
    return this.get(id);
  }

  async update(id: string, input: UpdateOrganizationInput) {
    await this.prisma.organization.update({
      where: { id },
      data: {
        legalName: input.legalName.trim(), tradeName: input.tradeName.trim(),
        document: input.document?.trim() || null, segment: input.segment?.trim() || null,
        contactEmail: input.contactEmail?.trim().toLowerCase() || null, phone: input.phone?.trim() || null,
        city: input.city?.trim() || null, state: input.state?.trim().toUpperCase() || null,
      },
    });
    for (const member of input.members) {
      const membership = await this.prisma.membership.findFirstOrThrow({ where: { id: member.id, organizationId: id }, include: { user: true } });
      const email = member.email.trim().toLowerCase();
      await this.auth.updateInvitedUser(membership.user.authProviderId, email, member.name);
      await this.prisma.user.update({ where: { id: membership.userId }, data: { email, name: member.name.trim() } });
      await this.prisma.membership.update({ where: { id: membership.id }, data: { role: member.role as OrganizationRole } });
    }
    return this.get(id);
  }

  async resendInvite(organizationId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirstOrThrow({ where: { id: membershipId, organizationId }, include: { user: true } });
    const webOrigin = this.config.getOrThrow<string>('WEB_ORIGIN').split(',')[0].trim();
    await this.auth.resendInvite(membership.user.email, `${webOrigin}/primeiro-acesso`);
    return { message: 'Convite reenviado.', email: membership.user.email };
  }

  async generateFirstAccessLink(organizationId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirstOrThrow({ where: { id: membershipId, organizationId }, include: { user: true } });
    const webOrigin = this.config.getOrThrow<string>('WEB_ORIGIN').split(',')[0].trim();
    const link = await this.auth.generateFirstAccessLink(membership.user.email, `${webOrigin}/primeiro-acesso`);
    return { link, email: membership.user.email };
  }

  async generateTemporaryAccess(organizationId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirstOrThrow({ where: { id: membershipId, organizationId }, include: { user: true } });
    const temporaryPassword = `${randomBytes(9).toString('base64url')}Aa1!`;
    await this.auth.setTemporaryPassword(membership.user.authProviderId, temporaryPassword);
    return { email: membership.user.email, temporaryPassword };
  }

  async create(input: CreateOrganizationInput) {
    const members = input.members.filter((member) => member.name.trim() && member.email.trim());
    const requiredRoles = ['OWNER', 'SUPERVISOR', 'IMPLEMENTATION_RESPONSIBLE'];
    const missing = requiredRoles.filter((role) => !members.some((member) => member.role === role));
    if (missing.length) {
      throw new BadRequestException(`Cargos obrigatórios ausentes: ${missing.join(', ')}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          legalName: input.legalName.trim(),
          tradeName: input.tradeName.trim(),
          document: input.document?.trim() || undefined,
          segment: input.segment?.trim() || undefined,
          contactEmail: input.contactEmail?.trim().toLowerCase() || undefined,
          phone: input.phone?.trim() || undefined,
          city: input.city?.trim() || undefined,
          state: input.state?.trim().toUpperCase() || undefined,
        },
      });

      for (const member of members) {
        const email = member.email.trim().toLowerCase();
        const user = await tx.user.upsert({
          where: { email },
          update: { name: member.name.trim(), active: true },
          create: {
            authProviderId: `pending-${randomUUID()}`,
            email,
            name: member.name.trim(),
            globalRole: 'USER',
          },
        });
        const webOrigin = this.config.getOrThrow<string>('WEB_ORIGIN').split(',')[0].trim();
        const authUser = await this.auth.invite(email, `${webOrigin}/primeiro-acesso`);
        await tx.user.update({ where: { id: user.id }, data: { authProviderId: authUser.id } });
        await tx.membership.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            role: member.role as OrganizationRole,
            status: 'INVITED',
          },
        });
      }

      return tx.organization.findUniqueOrThrow({
        where: { id: organization.id },
        include: {
          memberships: {
            include: { user: { select: { id: true, name: true, email: true, active: true, globalRole: true } } },
          },
        },
      });
    });
  }
}

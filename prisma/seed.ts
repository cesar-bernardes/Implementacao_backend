import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { GlobalRole, MembershipStatus, OrganizationRole, TemplateVersionStatus } from '../src/generated/prisma/enums';
import { gdFrotasTemplateDefinition } from '../src/fixtures/gd-frotas-template';

config({ path: '.env.development' });
config({ path: '.env', override: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const ids = {
  gdTech: '10000000-0000-4000-8000-000000000001',
  horizonte: '10000000-0000-4000-8000-000000000002',
  pantanal: '10000000-0000-4000-8000-000000000003',
  admin: '20000000-0000-4000-8000-000000000001',
  consultant: '20000000-0000-4000-8000-000000000002',
  owner: '20000000-0000-4000-8000-000000000003',
  leader: '20000000-0000-4000-8000-000000000004',
  visitor: '20000000-0000-4000-8000-000000000005',
  product: '30000000-0000-4000-8000-000000000001',
  template: '40000000-0000-4000-8000-000000000001',
  version: '50000000-0000-4000-8000-000000000001',
  implementation: '60000000-0000-4000-8000-000000000001',
};

async function main() {
  await prisma.organization.upsert({ where: { id: ids.gdTech }, update: {}, create: { id: ids.gdTech, legalName: 'GD Tech Demonstração Ltda.', tradeName: 'GD Tech', isPlatformOwner: true } });
  await prisma.organization.upsert({ where: { id: ids.horizonte }, update: {}, create: { id: ids.horizonte, legalName: 'Viação Horizonte Demonstração Ltda.', tradeName: 'Viação Horizonte', document: '00.000.000/0001-01' } });
  await prisma.organization.upsert({ where: { id: ids.pantanal }, update: {}, create: { id: ids.pantanal, legalName: 'Logística Pantanal Fictícia Ltda.', tradeName: 'Logística Pantanal', document: '00.000.000/0002-84' } });

  const users = [
    { id: ids.admin, authProviderId: 'fake-auth-admin', email: 'admin@gdtech.demo', name: 'Ana Admin', globalRole: GlobalRole.GLOBAL_ADMIN },
    { id: ids.consultant, authProviderId: 'fake-auth-consultant', email: 'consultor@gdtech.demo', name: 'Carlos Implementador', globalRole: GlobalRole.USER },
    { id: ids.owner, authProviderId: 'fake-auth-owner', email: 'diretoria@horizonte.demo', name: 'Marina Proprietária', globalRole: GlobalRole.USER },
    { id: ids.leader, authProviderId: 'fake-auth-leader', email: 'operacao@horizonte.demo', name: 'Rafael Champion', globalRole: GlobalRole.USER },
    { id: ids.visitor, authProviderId: 'fake-auth-visitor', email: 'auditoria@horizonte.demo', name: 'Beatriz Visitante', globalRole: GlobalRole.USER },
  ];
  for (const user of users) await prisma.user.upsert({ where: { id: user.id }, update: {}, create: user });

  const memberships = [
    [ids.admin, ids.gdTech, OrganizationRole.OWNER],
    [ids.consultant, ids.gdTech, OrganizationRole.IMPLEMENTATION_RESPONSIBLE],
    [ids.owner, ids.horizonte, OrganizationRole.OWNER],
    [ids.leader, ids.horizonte, OrganizationRole.SUPERVISOR],
    [ids.visitor, ids.horizonte, OrganizationRole.VISITOR],
    [ids.consultant, ids.horizonte, OrganizationRole.IMPLEMENTATION_RESPONSIBLE],
  ] as const;
  for (const [userId, organizationId, role] of memberships) {
    await prisma.membership.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      update: { role, status: MembershipStatus.ACTIVE },
      create: { userId, organizationId, role, status: MembershipStatus.ACTIVE },
    });
  }

  await prisma.product.upsert({ where: { id: ids.product }, update: {}, create: { id: ids.product, name: 'GD Frotas', slug: 'gd-frotas' } });
  await prisma.implementationTemplate.upsert({ where: { id: ids.template }, update: {}, create: { id: ids.template, productId: ids.product, name: 'Implementação GD Frotas' } });
  await prisma.implementationTemplateVersion.upsert({
    where: { id: ids.version },
    update: {},
    create: {
      id: ids.version,
      templateId: ids.template,
      version: 1,
      status: TemplateVersionStatus.PUBLISHED,
      publishedAt: new Date('2026-08-25T12:00:00Z'),
      definition: JSON.parse(JSON.stringify(gdFrotasTemplateDefinition)),
    },
  });
  await prisma.implementation.upsert({
    where: { id: ids.implementation },
    update: {},
    create: {
      id: ids.implementation,
      organizationId: ids.horizonte,
      templateVersionId: ids.version,
      ownerId: ids.consultant,
      name: 'Implantação piloto — Viação Horizonte',
      status: 'ACTIVE',
      startedAt: new Date('2026-08-25'),
      dueAt: new Date('2026-10-04'),
    },
  });
}

main()
  .then(() => console.log('Dados fictícios carregados com sucesso.'))
  .finally(() => prisma.$disconnect());

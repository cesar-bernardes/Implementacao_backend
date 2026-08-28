import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ImplementationsService, TemplateDefinition } from '../implementations/implementations.service';

type ProductQuestion = {
  code: string;
  text: string;
  type: string;
  required: boolean;
  config?: Record<string, unknown>;
};

type ProductPhase = {
  code: string;
  name: string;
  order: number;
  isBase?: boolean;
  durationWeeks?: number;
  meetingsPerWeek?: number;
  questions: ProductQuestion[];
};

type ProductDefinition = { phases: ProductPhase[] };

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly implementations: ImplementationsService,
  ) {}

  async configuration() {
    return this.prisma.product.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        templates: {
          select: {
            id: true,
            name: true,
            versions: {
              where: { status: 'PUBLISHED' },
              orderBy: { version: 'desc' },
              take: 1,
              select: { id: true, version: true, definition: true, publishedAt: true },
            },
          },
        },
      },
    });
  }

  async updateConfiguration(versionId: string, definition: ProductDefinition) {
    const version = await this.prisma.implementationTemplateVersion.findFirst({
      where: { id: versionId, status: 'PUBLISHED', template: { product: { active: true } } },
    });
    if (!version) throw new NotFoundException('Versão publicada do produto não encontrada.');
    if (!Array.isArray(definition.phases) || !definition.phases.length) throw new BadRequestException('O produto precisa ter ao menos um módulo.');

    const codes = new Set<string>();
    const normalized = definition.phases.map((phase, index) => {
      const code = String(phase.code ?? '').trim().toUpperCase();
      if (!code || codes.has(code)) throw new BadRequestException('Cada módulo precisa ter um código único.');
      codes.add(code);
      const durationWeeks = Math.max(1, Math.min(52, Number(phase.durationWeeks) || 1));
      const meetingsPerWeek = Math.max(0, Math.min(7, Number(phase.meetingsPerWeek) || 0));
      const questions = Array.isArray(phase.questions) ? phase.questions.map((question) => {
        const trainingUrl = String(question.config?.trainingUrl ?? '').trim();
        if (trainingUrl && !/^https?:\/\//i.test(trainingUrl)) throw new BadRequestException(`O treinamento de ${question.code} precisa usar um link http ou https.`);
        return {
          ...question,
          code: String(question.code ?? '').trim().toUpperCase(),
          text: String(question.text ?? '').trim(),
          required: Boolean(question.required),
          config: { ...(question.config ?? {}), trainingUrl: trainingUrl || undefined },
        };
      }) : [];
      return {
        ...phase,
        code,
        name: String(phase.name ?? '').trim(),
        order: index + 1,
        isBase: Boolean(phase.isBase),
        durationWeeks,
        meetingsPerWeek,
        questions,
      };
    });

    const normalizedDefinition = { phases: normalized };
    await this.prisma.implementationTemplateVersion.update({
      where: { id: versionId },
      data: { definition: normalizedDefinition },
    });
    await this.implementations.synchronizeVersionStructure(versionId, normalizedDefinition as TemplateDefinition);
    const implementations = await this.prisma.implementation.findMany({
      where: { templateVersionId: versionId },
      select: { id: true },
    });
    await Promise.all(implementations.map((implementation) =>
      this.prisma.$executeRaw`select implementacao.sync_implementation_snapshot(${implementation.id}::uuid)`,
    ));
    return { id: versionId, definition: normalizedDefinition, synchronizedImplementations: implementations.length };
  }
}

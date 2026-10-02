import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ImplementationsService } from '../implementations/implementations.service';

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
type CreateProductInput = {
  name: string;
  templateName?: string;
  initialPhaseName?: string;
};

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
              select: {
                id: true,
                version: true,
                definition: true,
                publishedAt: true,
              },
            },
          },
        },
      },
    });
  }

  async create(input: CreateProductInput) {
    const name = input.name.trim();
    const templateName = input.templateName?.trim() || 'Implantação padrão';
    const initialPhaseName =
      input.initialPhaseName?.trim() || 'Configuração inicial';
    if (!name) throw new BadRequestException('Informe o nome do produto.');

    const duplicate = await this.prisma.product.findFirst({
      where: {
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          { slug: this.slugify(name) },
        ],
      },
    });
    if (duplicate)
      throw new BadRequestException('Já existe um produto com este nome.');

    const definition: ProductDefinition = {
      phases: [
        {
          code: 'F01',
          name: initialPhaseName,
          order: 1,
          isBase: true,
          durationWeeks: 1,
          meetingsPerWeek: 1,
          questions: [],
        },
      ],
    };
    const product = await this.prisma.product.create({
      data: {
        name,
        slug: this.slugify(name),
        templates: {
          create: {
            name: templateName,
            versions: {
              create: {
                version: 1,
                status: 'PUBLISHED',
                definition: definition as never,
                publishedAt: new Date(),
              },
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        templates: {
          select: {
            id: true,
            name: true,
            versions: {
              select: {
                id: true,
                version: true,
                definition: true,
                publishedAt: true,
              },
            },
          },
        },
      },
    });
    const versionId = product.templates[0]?.versions[0]?.id;
    if (versionId)
      await this.implementations.synchronizeVersionStructure(
        versionId,
        definition,
      );
    return product;
  }

  private slugify(value: string) {
    const slug = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug)
      throw new BadRequestException(
        'O nome do produto precisa conter letras ou números.',
      );
    return slug;
  }

  async updateConfiguration(versionId: string, definition: ProductDefinition) {
    const version = await this.prisma.implementationTemplateVersion.findFirst({
      where: {
        id: versionId,
        status: 'PUBLISHED',
        template: { product: { active: true } },
      },
    });
    if (!version)
      throw new NotFoundException(
        'Versão publicada do produto não encontrada.',
      );
    if (!Array.isArray(definition.phases) || !definition.phases.length)
      throw new BadRequestException(
        'O produto precisa ter ao menos um módulo.',
      );

    const codes = new Set<string>();
    const normalized = definition.phases.map((phase, index) => {
      const code = String(phase.code ?? '')
        .trim()
        .toUpperCase();
      if (!code || codes.has(code))
        throw new BadRequestException(
          'Cada módulo precisa ter um código único.',
        );
      codes.add(code);
      const durationWeeks = Math.max(
        1,
        Math.min(52, Number(phase.durationWeeks) || 1),
      );
      const meetingsPerWeek = Math.max(
        0,
        Math.min(7, Number(phase.meetingsPerWeek) || 0),
      );
      const questions = Array.isArray(phase.questions)
        ? phase.questions.map((question) => {
            const rawTrainingUrl = question.config?.trainingUrl;
            if (
              rawTrainingUrl !== undefined &&
              typeof rawTrainingUrl !== 'string'
            ) {
              throw new BadRequestException(
                `O treinamento de ${question.code} precisa ser um texto com link http ou https.`,
              );
            }
            const trainingUrl = rawTrainingUrl?.trim() ?? '';
            if (trainingUrl && !/^https?:\/\//i.test(trainingUrl))
              throw new BadRequestException(
                `O treinamento de ${question.code} precisa usar um link http ou https.`,
              );
            return {
              ...question,
              code: String(question.code ?? '')
                .trim()
                .toUpperCase(),
              text: String(question.text ?? '').trim(),
              required: Boolean(question.required),
              config: {
                ...(question.config ?? {}),
                trainingUrl: trainingUrl || undefined,
              },
            };
          })
        : [];
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
    await this.implementations.synchronizeVersionStructure(
      versionId,
      normalizedDefinition,
    );
    const implementations = await this.prisma.implementation.findMany({
      where: { templateVersionId: versionId },
      select: {
        id: true,
        selectedPhaseCodes: true,
        startedAt: true,
        currentPhaseCode: true,
      },
    });
    await Promise.all(
      implementations.map(async (implementation) => {
        const previouslySelected = Array.isArray(
          implementation.selectedPhaseCodes,
        )
          ? implementation.selectedPhaseCodes.filter(
              (code): code is string => typeof code === 'string',
            )
          : normalized.map((phase) => phase.code);
        let selectedPhaseCodes = normalized
          .filter(
            (phase) => phase.isBase || previouslySelected.includes(phase.code),
          )
          .map((phase) => phase.code);
        if (!selectedPhaseCodes.length && normalized[0])
          selectedPhaseCodes = [normalized[0].code];
        const selectedPhases = normalized.filter((phase) =>
          selectedPhaseCodes.includes(phase.code),
        );
        const estimatedWeeks = selectedPhases.reduce(
          (total, phase) => total + phase.durationWeeks,
          0,
        );
        const plannedMeetings = selectedPhases.reduce(
          (total, phase) => total + phase.durationWeeks * phase.meetingsPerWeek,
          0,
        );
        const dueAt = implementation.startedAt
          ? new Date(
              implementation.startedAt.getTime() +
                estimatedWeeks * 7 * 24 * 60 * 60 * 1000,
            )
          : null;
        const currentPhaseCode = selectedPhaseCodes.includes(
          implementation.currentPhaseCode ?? '',
        )
          ? implementation.currentPhaseCode
          : (selectedPhaseCodes[0] ?? null);
        await this.prisma.implementation.update({
          where: { id: implementation.id },
          data: {
            selectedPhaseCodes,
            estimatedWeeks,
            plannedMeetings,
            dueAt,
            currentPhaseCode,
          },
        });
        await this.prisma
          .$executeRaw`select implementacao.sync_implementation_snapshot(${implementation.id}::uuid)`;
      }),
    );
    return {
      id: versionId,
      definition: normalizedDefinition,
      synchronizedImplementations: implementations.length,
    };
  }
}

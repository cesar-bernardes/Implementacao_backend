import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Actor = { id: string; globalRole: string };
type CreateImplementationInput = {
  organizationId: string;
  templateVersionId: string;
  ownerId?: string;
  selectedPhaseCodes: string[];
  name: string;
  startedAt?: string;
  dueAt?: string;
};
type SaveAnswerInput = { checklistValue?: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_DONE'; numberValue?: number; textValue?: string; notes?: string };
type TemplateDefinition = { phases?: Array<{ code: string; name: string; order: number; isBase?: boolean; durationWeeks?: number; meetingsPerWeek?: number; questions: Array<{ code: string; text: string; type: string; required: boolean; config?: Record<string, unknown> }> }> };
type PhaseRow = { id: string; code: string; name: string; sortOrder: number; startedAt: Date | null; completedAt: Date | null };
type QuestionRow = { id: string; phaseId: string; code: string; prompt: string; responseType: 'CHECKLIST' | 'NUMBER' | 'SHORT_TEXT'; required: boolean; responseConfig: unknown; sortOrder: number; checklistValue: string | null; numberValue: string | null; textValue: string | null; notes: string | null; answeredAt: Date | null; answeredByName: string | null };

const implementationInclude = {
  organization: { select: { id: true, tradeName: true } },
  owner: { select: { id: true, name: true, email: true } },
  templateVersion: {
    select: {
      id: true,
      version: true,
      template: { select: { name: true, product: { select: { id: true, name: true } } } },
    },
  },
} as const;

@Injectable()
export class ImplementationsService {
  constructor(private readonly prisma: PrismaService) {}

  listFor(actor: Actor) {
    return this.prisma.implementation.findMany({
      where: actor.globalRole === 'GLOBAL_ADMIN'
        ? undefined
        : { OR: [{ ownerId: actor.id }, { organization: { memberships: { some: { userId: actor.id, status: 'ACTIVE' } } } }] },
      include: implementationInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async options() {
    const [organizations, products, owners] = await Promise.all([
      this.prisma.organization.findMany({
        where: { active: true, isPlatformOwner: false },
        select: { id: true, tradeName: true },
        orderBy: { tradeName: 'asc' },
      }),
      this.prisma.product.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          templates: {
            select: {
              id: true,
              name: true,
              versions: {
                where: { status: 'PUBLISHED' },
                select: { id: true, version: true, definition: true },
                orderBy: { version: 'desc' },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { active: true, OR: [{ globalRole: { in: ['GLOBAL_ADMIN', 'GLOBAL_RESTRICTED'] } }, { email: { endsWith: '@granddos.tech' } }] },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { organizations, products, owners };
  }

  async create(input: CreateImplementationInput) {
    const [organization, templateVersion, owner] = await Promise.all([
      this.prisma.organization.findFirst({ where: { id: input.organizationId, active: true } }),
      this.prisma.implementationTemplateVersion.findFirst({
        where: { id: input.templateVersionId, status: 'PUBLISHED', template: { product: { active: true } } },
      }),
      input.ownerId
        ? this.prisma.user.findFirst({ where: { id: input.ownerId, active: true, OR: [{ globalRole: { in: ['GLOBAL_ADMIN', 'GLOBAL_RESTRICTED'] } }, { email: { endsWith: '@granddos.tech' } }] } })
        : Promise.resolve(null),
    ]);
    if (!organization) throw new BadRequestException('Selecione uma empresa ativa.');
    if (!templateVersion) throw new BadRequestException('Selecione uma versão publicada do produto.');
    if (input.ownerId && !owner) throw new BadRequestException('Selecione um responsável GD Tech válido.');

    const definition = templateVersion.definition as TemplateDefinition;
    const availablePhases = definition.phases ?? [];
    const requestedCodes = new Set(input.selectedPhaseCodes ?? []);
    const selectedPhases = availablePhases.filter((phase) => phase.isBase || requestedCodes.has(phase.code));
    if (!selectedPhases.length) throw new BadRequestException('Selecione ao menos um módulo do produto.');
    const selectedPhaseCodes = selectedPhases.map((phase) => phase.code);
    const estimatedWeeks = selectedPhases.reduce((total, phase) => total + Math.max(1, Number(phase.durationWeeks) || 1), 0);
    const plannedMeetings = selectedPhases.reduce((total, phase) => {
      const weeks = Math.max(1, Number(phase.durationWeeks) || 1);
      return total + weeks * Math.max(0, Number(phase.meetingsPerWeek) || 0);
    }, 0);
    const startedAt = input.startedAt ? new Date(`${input.startedAt}T00:00:00.000Z`) : null;
    const dueAt = startedAt ? new Date(startedAt.getTime() + estimatedWeeks * 7 * 24 * 60 * 60 * 1000) : null;
    await this.ensureVersionStructure(templateVersion.id, definition);

    const implementation = await this.prisma.implementation.create({
      data: {
        organizationId: input.organizationId,
        templateVersionId: input.templateVersionId,
        ownerId: input.ownerId || null,
        name: input.name.trim(),
        status: startedAt ? 'ACTIVE' : 'PLANNED',
        currentPhaseCode: selectedPhases[0]?.code ?? null,
        selectedPhaseCodes,
        estimatedWeeks,
        plannedMeetings,
        startedAt,
        dueAt,
      },
      include: implementationInclude,
    });
    await this.prisma.$executeRaw`select implementacao.sync_implementation_snapshot(${implementation.id}::uuid)`;
    return implementation;
  }

  async getFor(id: string, actor: Actor) {
    const implementation = await this.authorizedImplementation(id, actor);
    await this.ensureVersionStructure(implementation.templateVersionId, implementation.templateVersion.definition as TemplateDefinition);
    await this.prisma.$executeRaw`select implementacao.sync_implementation_snapshot(${id}::uuid)`;
    const selectedPhaseCodes = this.selectedCodes(implementation.selectedPhaseCodes, implementation.templateVersion.definition as TemplateDefinition);
    const progressState = await this.synchronizeProgressState(id, implementation.status, selectedPhaseCodes);

    const phases = await this.prisma.$queryRaw<PhaseRow[]>`
      select id, code, name, sort_order as "sortOrder", started_at as "startedAt", completed_at as "completedAt"
      from implementacao.implementation_phases
      where implementation_id = ${id}::uuid and active = true
      order by sort_order
    `;
    const questions = await this.prisma.$queryRaw<QuestionRow[]>`
      select iq.id, iq.implementation_phase_id as "phaseId", iq.code, iq.prompt,
             iq.response_type::text as "responseType", iq.required,
             iq.response_config as "responseConfig", iq.sort_order as "sortOrder",
             ia.checklist_value::text as "checklistValue", ia.number_value::text as "numberValue",
             ia.text_value as "textValue", ia.notes, ia.answered_at as "answeredAt",
             u.name as "answeredByName"
      from implementacao.implementation_questions iq
      left join implementacao.implementation_answers ia on ia.implementation_question_id = iq.id
      left join implementacao.users u on u.id = ia.answered_by
      where iq.implementation_id = ${id}::uuid and iq.active = true
      order by iq.implementation_phase_id, iq.sort_order
    `;

    const visiblePhases = phases.filter((phase) => selectedPhaseCodes.includes(phase.code));
    const phaseConfiguration = new Map(
      ((implementation.templateVersion.definition as TemplateDefinition).phases ?? []).map((phase) => [phase.code, phase]),
    );
    return {
      ...implementation,
      ...progressState,
      permissions: {
        canManageCurrentPhase: actor.globalRole === 'GLOBAL_ADMIN' || implementation.ownerId === actor.id,
        canChangeOwner: actor.globalRole === 'GLOBAL_ADMIN',
      },
      phases: visiblePhases.map((phase) => {
        const configuration = phaseConfiguration.get(phase.code);
        return {
          ...phase,
          isBase: configuration?.isBase ?? false,
          durationWeeks: Math.max(1, Number(configuration?.durationWeeks) || 1),
          meetingsPerWeek: Math.max(0, Number(configuration?.meetingsPerWeek) || 0),
          questions: questions.filter((question) => question.phaseId === phase.id),
        };
      }),
    };
  }

  async saveAnswer(id: string, questionId: string, input: SaveAnswerInput, actor: Actor) {
    const implementation = await this.authorizedImplementation(id, actor);
    const selectedPhaseCodes = this.selectedCodes(implementation.selectedPhaseCodes, implementation.templateVersion.definition as TemplateDefinition);
    const [question] = await this.prisma.$queryRaw<Array<{ responseType: 'CHECKLIST' | 'NUMBER' | 'SHORT_TEXT'; phaseCode: string }>>`
      select iq.response_type::text as "responseType", ip.code as "phaseCode"
      from implementacao.implementation_questions iq
      join implementacao.implementation_phases ip on ip.id = iq.implementation_phase_id
      where iq.id = ${questionId}::uuid and iq.implementation_id = ${id}::uuid and iq.active = true
    `;
    if (!question) throw new NotFoundException('Pergunta não encontrada nesta implementação.');
    if (!selectedPhaseCodes.includes(question.phaseCode)) throw new ForbiddenException('Este módulo não foi contratado pela empresa.');

    if (question.responseType === 'CHECKLIST') {
      if (!input.checklistValue) throw new BadRequestException('Selecione Concluído, Em andamento ou Não realizado.');
      await this.prisma.$executeRaw`
        insert into implementacao.implementation_answers (implementation_question_id, checklist_value, notes, answered_by)
        values (${questionId}::uuid, ${input.checklistValue}::implementacao."ChecklistAnswer", ${input.notes ?? null}, ${actor.id}::uuid)
        on conflict (implementation_question_id) do update set checklist_value = excluded.checklist_value,
          number_value = null, text_value = null, notes = excluded.notes, answered_by = excluded.answered_by, updated_at = now()
      `;
    } else if (question.responseType === 'NUMBER') {
      if (input.numberValue === undefined) throw new BadRequestException('Informe um número.');
      await this.prisma.$executeRaw`
        insert into implementacao.implementation_answers (implementation_question_id, number_value, notes, answered_by)
        values (${questionId}::uuid, ${input.numberValue}, ${input.notes ?? null}, ${actor.id}::uuid)
        on conflict (implementation_question_id) do update set number_value = excluded.number_value,
          checklist_value = null, text_value = null, notes = excluded.notes, answered_by = excluded.answered_by, updated_at = now()
      `;
    } else {
      if (!input.textValue?.trim()) throw new BadRequestException('Informe uma resposta de até 100 caracteres.');
      await this.prisma.$executeRaw`
        insert into implementacao.implementation_answers (implementation_question_id, text_value, notes, answered_by)
        values (${questionId}::uuid, ${input.textValue.trim()}, ${input.notes ?? null}, ${actor.id}::uuid)
        on conflict (implementation_question_id) do update set text_value = excluded.text_value,
          checklist_value = null, number_value = null, notes = excluded.notes, answered_by = excluded.answered_by, updated_at = now()
      `;
    }
    return this.getFor(id, actor);
  }

  private async synchronizeProgressState(
    id: string,
    existingStatus: 'PLANNED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELED',
    selectedPhaseCodes: string[],
  ) {
    const phases = await this.prisma.$queryRaw<Array<{ code: string; sortOrder: number; total: number; completed: number; answered: number }>>`
      select ip.code, ip.sort_order as "sortOrder",
             count(iq.id)::int as total,
             count(iq.id) filter (where
               (iq.response_type::text = 'CHECKLIST' and ia.checklist_value::text = 'COMPLETED') or
               (iq.response_type::text = 'NUMBER' and ia.number_value is not null) or
               (iq.response_type::text = 'SHORT_TEXT' and nullif(trim(ia.text_value), '') is not null)
             )::int as completed,
             count(ia.implementation_question_id)::int as answered
      from implementacao.implementation_phases ip
      left join implementacao.implementation_questions iq on iq.implementation_phase_id = ip.id and iq.active = true
      left join implementacao.implementation_answers ia on ia.implementation_question_id = iq.id
      where ip.implementation_id = ${id}::uuid and ip.active = true
      group by ip.code, ip.sort_order
      order by ip.sort_order
    `;
    const selectedPhases = phases.filter((phase) => selectedPhaseCodes.includes(phase.code));
    const currentPhase = selectedPhases.find((phase) => phase.total > 0 && phase.completed < phase.total) ?? selectedPhases.at(-1);
    const total = selectedPhases.reduce((sum, phase) => sum + phase.total, 0);
    const completed = selectedPhases.reduce((sum, phase) => sum + phase.completed, 0);
    const answered = selectedPhases.reduce((sum, phase) => sum + phase.answered, 0);
    const allCompleted = total > 0 && completed === total;
    const status = allCompleted
      ? 'COMPLETED'
      : existingStatus === 'PAUSED' || existingStatus === 'CANCELED'
        ? existingStatus
        : answered > 0
          ? 'ACTIVE'
          : 'PLANNED';
    const currentPhaseCode = currentPhase?.code ?? null;
    await this.prisma.implementation.update({
      where: { id },
      data: { currentPhaseCode, status },
    });
    return { currentPhaseCode, status };
  }

  private selectedCodes(value: unknown, definition: TemplateDefinition) {
    if (Array.isArray(value) && value.every((code) => typeof code === 'string') && value.length) return value as string[];
    return (definition.phases ?? []).map((phase) => phase.code);
  }

  private async authorizedImplementation(id: string, actor: Actor) {
    const implementation = await this.prisma.implementation.findUnique({
      where: { id },
      include: {
        ...implementationInclude,
        templateVersion: { include: { template: { include: { product: true } } } },
      },
    });
    if (!implementation) throw new NotFoundException('Implementação não encontrada.');
    if (actor.globalRole === 'GLOBAL_ADMIN' || implementation.ownerId === actor.id) return implementation;
    const membership = await this.prisma.membership.findFirst({ where: { organizationId: implementation.organizationId, userId: actor.id, status: 'ACTIVE' } });
    if (!membership) throw new ForbiddenException('Você não possui acesso a esta implementação.');
    return implementation;
  }

  private async ensureVersionStructure(versionId: string, definition: TemplateDefinition) {
    for (const phase of definition.phases ?? []) {
      const [phaseRow] = await this.prisma.$queryRaw<Array<{ id: string }>>`
        insert into implementacao.template_phases (template_version_id, code, name, sort_order)
        values (${versionId}::uuid, ${phase.code}, ${phase.name}, ${phase.order})
        on conflict (template_version_id, code) do update set name = excluded.name, sort_order = excluded.sort_order, updated_at = now()
        returning id
      `;
      for (const [index, question] of phase.questions.entries()) {
        const responseType = question.type === 'Número' ? 'NUMBER' : question.type === 'Texto curto' ? 'SHORT_TEXT' : 'CHECKLIST';
        const config = JSON.stringify(question.config ?? (responseType === 'CHECKLIST' ? { options: ['Concluído', 'Em andamento', 'Não realizado'] } : {}));
        await this.prisma.$executeRaw`
          insert into implementacao.template_questions
            (template_version_id, phase_id, code, prompt, response_type, required, response_config, sort_order)
          values (${versionId}::uuid, ${phaseRow.id}::uuid, ${question.code}, ${question.text},
            ${responseType}::implementacao."AnswerType", ${question.required}, ${config}::jsonb, ${index + 1})
          on conflict (template_version_id, code) do update set phase_id = excluded.phase_id, prompt = excluded.prompt,
            response_type = excluded.response_type, required = excluded.required, response_config = excluded.response_config,
            sort_order = excluded.sort_order, updated_at = now()
        `;
      }
    }
  }
}

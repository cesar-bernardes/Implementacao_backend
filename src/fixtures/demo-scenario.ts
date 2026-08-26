export const fakeDemoScenario = {
  organization: {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Viação Horizonte',
    fleetSize: 28,
    supplyModel: 'Posto interno',
  },
  implementation: {
    id: '60000000-0000-4000-8000-000000000001',
    name: 'Implantação piloto — Viação Horizonte',
    mode: 'Online',
    status: 'Em implementação',
    progress: 18,
  },
  team: [
    { name: 'Carlos Implementador', role: 'IMPLEMENTER', side: 'GD Tech' },
    { name: 'Marina Proprietária', role: 'OWNER', side: 'Cliente' },
    { name: 'Rafael Champion', role: 'LEADER', side: 'Cliente' },
    { name: 'Beatriz Visitante', role: 'VISITOR', side: 'Cliente' },
  ],
  methodology: {
    prerequisites: 17,
    requiredPrerequisites: 11,
    phases: 12,
    onlineActivities: 65,
    onsiteActivities: 65,
    trainings: 8,
    acceptanceCriteria: 27,
    risks: 14,
  },
} as const;

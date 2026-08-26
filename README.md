# GD Tech — Backend

API da plataforma de gestão de implementações, construída com NestJS, Prisma e PostgreSQL/Supabase no schema `implementacao`.

## Execução

```bash
pnpm install
pnpm prisma:generate
pnpm dev
```

API: `http://localhost:3001/api/v1`  
Documentação: `http://localhost:3001/docs`

## Banco

- `pnpm prisma:generate`: gera o cliente Prisma.
- `pnpm prisma:migrate`: aplica migrations em desenvolvimento.
- `pnpm prisma:studio`: abre o Prisma Studio.
- `pnpm prisma:seed`: carrega dados fictícios.

O Backend é a autoridade para autenticação, permissões e isolamento multiempresa.

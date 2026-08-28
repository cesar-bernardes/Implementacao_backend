import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type User as SupabaseUser } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAuthService {
  private readonly url: string;
  private readonly serviceKey: string;
  private readonly client;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow<string>('SUPABASE_URL');
    this.serviceKey = config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.client = createClient(this.url, this.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
    return { session: data.session, user: data.user };
  }

  async refresh(refreshToken: string) {
    const { data, error } = await this.client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) throw new UnauthorizedException('Sessão expirada.');
    return { session: data.session, user: data.user };
  }

  async getUser(accessToken: string): Promise<SupabaseUser> {
    const { data, error } = await this.client.auth.getUser(accessToken);
    if (error || !data.user) throw new UnauthorizedException('Sessão inválida.');
    return data.user;
  }

  async invite(email: string, redirectTo: string) {
    const { data, error } = await this.client.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error || !data.user) throw error ?? new Error('Falha ao convidar usuário.');
    return data.user;
  }

  async updateUser(userId: string, email: string, name: string) {
    const { data, error } = await this.client.auth.admin.updateUserById(userId, {
      email,
      user_metadata: { name },
    });
    if (error || !data.user) throw error ?? new Error('Falha ao atualizar usuário no Auth.');
    return data.user;
  }

  async setTemporaryPassword(userId: string, password: string) {
    const { data, error } = await this.client.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error('Falha ao preparar o primeiro acesso.');
  }

  async resendInvite(email: string, redirectTo: string) {
    const users = await this.client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (users.error) throw users.error;
    const authUser = users.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (authUser?.email_confirmed_at) {
      const recovery = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
      if (recovery.error) throw recovery.error;
      return;
    }
    const resent = await this.client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } });
    if (resent.error) throw resent.error;
  }

  async generateFirstAccessLink(email: string, redirectTo: string) {
    const users = await this.client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (users.error) throw users.error;
    const authUser = users.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    const type = authUser?.email_confirmed_at ? 'recovery' as const : 'invite' as const;
    const generated = await this.client.auth.admin.generateLink({ type, email, options: { redirectTo } });
    if (generated.error) throw generated.error;
    return generated.data.properties.action_link;
  }

  async createConfirmedUser(email: string, password: string, name: string) {
    const { data, error } = await this.client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error || !data.user) throw error ?? new Error('Falha ao criar usuário.');
    return data.user;
  }

  async definePassword(accessToken: string, password: string) {
    const response = await fetch(`${this.url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) throw new UnauthorizedException('Convite inválido ou expirado.');
    return response.json() as Promise<SupabaseUser>;
  }
}

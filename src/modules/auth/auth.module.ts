import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { AuthenticatedGuard } from './authenticated.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SupabaseAuthService, AuthenticatedGuard],
  exports: [AuthService, SupabaseAuthService, AuthenticatedGuard],
})
export class AuthModule {}

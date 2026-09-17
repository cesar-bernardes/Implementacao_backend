import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { GlobalUsersController } from './global-users.controller';
import { GlobalUsersService } from './global-users.service';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [GlobalUsersController],
  providers: [GlobalUsersService],
})
export class GlobalUsersModule {}

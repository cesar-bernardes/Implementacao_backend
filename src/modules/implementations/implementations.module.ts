import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ImplementationsController } from './implementations.controller';
import { ImplementationsService } from './implementations.service';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [ImplementationsController],
  providers: [ImplementationsService],
  exports: [ImplementationsService],
})
export class ImplementationsModule {}

import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DemoAdminGuard } from './demo-admin.guard';
import { OrganizationsService } from './organizations.service';
import { AuthenticatedGuard } from '../auth/authenticated.guard';
import type { Request } from 'express';

class MemberDto {
  @IsString() @MinLength(2) name!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() phone?: string;
  @IsIn(['OWNER', 'SUPERVISOR', 'IMPLEMENTATION_RESPONSIBLE']) role!: 'OWNER' | 'SUPERVISOR' | 'IMPLEMENTATION_RESPONSIBLE';
}

class CreateOrganizationDto {
  @IsString() @MinLength(2) legalName!: string;
  @IsString() @MinLength(2) tradeName!: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsString() segment?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => MemberDto) members!: MemberDto[];
}

class UpdateMemberDto extends MemberDto { @IsString() id!: string; }
class UpdateOrganizationDto {
  @IsString() @MinLength(2) legalName!: string;
  @IsString() @MinLength(2) tradeName!: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsString() segment?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => UpdateMemberDto) members!: UpdateMemberDto[];
}

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @UseGuards(AuthenticatedGuard)
  @ApiOperation({ summary: 'Lista empresas visíveis ao administrador global' })
  list(@Req() request: Request & { actor: { id: string; globalRole: string } }) { return this.organizations.listFor(request.actor); }

  @Get(':id')
  @UseGuards(AuthenticatedGuard)
  get(@Param('id') id: string, @Req() request: Request & { actor: { id: string; globalRole: string } }) { return this.organizations.getFor(id, request.actor); }

  @Post()
  @UseGuards(DemoAdminGuard)
  @ApiOperation({ summary: 'Cadastra uma empresa e seus responsáveis' })
  create(@Body() body: CreateOrganizationDto) { return this.organizations.create(body); }

  @Patch(':id')
  @UseGuards(DemoAdminGuard)
  update(@Param('id') id: string, @Body() body: UpdateOrganizationDto) { return this.organizations.update(id, body); }

  @Post(':id/members/:membershipId/resend-invite')
  @UseGuards(DemoAdminGuard)
  resend(@Param('id') id: string, @Param('membershipId') membershipId: string) { return this.organizations.resendInvite(id, membershipId); }

  @Post(':id/members/:membershipId/first-access-link')
  @UseGuards(DemoAdminGuard)
  firstAccessLink(@Param('id') id: string, @Param('membershipId') membershipId: string) { return this.organizations.generateFirstAccessLink(id, membershipId); }

  @Post(':id/members/:membershipId/temporary-access')
  @UseGuards(DemoAdminGuard)
  temporaryAccess(@Param('id') id: string, @Param('membershipId') membershipId: string) { return this.organizations.generateTemporaryAccess(id, membershipId); }
}

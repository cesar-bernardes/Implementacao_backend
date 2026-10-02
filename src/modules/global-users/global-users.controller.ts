import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { DemoAdminGuard } from '../organizations/demo-admin.guard';
import { GlobalUsersService } from './global-users.service';

class InviteGlobalUserDto {
  @IsString() @MinLength(2) name!: string;
  @IsEmail() email!: string;
  @IsIn(['GLOBAL_ADMIN', 'GLOBAL_RESTRICTED']) globalRole!:
    'GLOBAL_ADMIN' | 'GLOBAL_RESTRICTED';
}

@Controller('global-users')
@UseGuards(DemoAdminGuard)
export class GlobalUsersController {
  constructor(private readonly globalUsers: GlobalUsersService) {}

  @Get()
  list() {
    return this.globalUsers.list();
  }

  @Post()
  invite(@Body() body: InviteGlobalUserDto) {
    return this.globalUsers.invite(body.name, body.email, body.globalRole);
  }
}

import { ApiProperty } from '@nestjs/swagger/dist/decorators/api-property.decorator';
import { IsNotEmpty, IsString } from 'class-validator';
export class LogoutDto {
  @ApiProperty({
    description: 'Security code',
    maxLength: 20,
    example: 'abcd1234',
  })
  @IsString()
  @IsNotEmpty()
  cert: string;

  @ApiProperty({
    description: 'Agent ID',
    maxLength: 50,
    example: 'agent001',
  })
  @IsString()
  @IsNotEmpty()
  agentId: string;

  @ApiProperty({
    description: 'Comma separated User IDs',
    maxLength: 500,
    example: 'player123,player456',
  })
  @IsString()
  @IsNotEmpty()
  userIds: string;
}

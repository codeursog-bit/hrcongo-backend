import { IsDateString, IsUUID, Matches } from 'class-validator';
import { CorrectAttendanceDto } from './correct-attendance.dto';

export class CorrectAttendanceDayDto extends CorrectAttendanceDto {
  @IsUUID()
  employeeId: string;

  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;
}

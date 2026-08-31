import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return null;

    // ✅ Compatibilité totale : id ↔ userId
    if (data === 'id' && user.userId) {
      return user.userId;
    }

    return data ? user[data] : user;
  },
);

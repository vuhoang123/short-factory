import type { Request } from 'express';
import { Prisma, type PrismaClient } from '@shorts-factory/database';
import type { AuthContext } from './auth/auth.service.js';
import { ApiError } from './errors.js';
import { mutationIdentity } from './idempotency.js';

export function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }

export async function phase5Mutation(db: PrismaClient, request: Request, context: AuthContext, route: string, input: unknown, work: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const { key, requestHash } = mutationIdentity(request, input);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: context.workspaceId, userId: context.userId } } });
        if (!member || member.role !== context.role) throw new ApiError(403,'FORBIDDEN','Workspace permissions changed.');
        const old = await tx.idempotencyRecord.findUnique({ where: { workspaceId_userId_route_key: { workspaceId: context.workspaceId,userId:context.userId,route,key } } });
        if (old) {
          if (old.requestHash !== requestHash) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','This key was used for different input.');
          return old.response;
        }
        const result = json(await work(tx));
        await tx.idempotencyRecord.create({ data: { workspaceId:context.workspaceId,userId:context.userId,route,key,requestHash,response:result,statusCode:201 } });
        await tx.auditLog.create({ data: { workspaceId:context.workspaceId,actorId:context.userId,action:'PHASE5_MUTATION',resourceType:'Workflow',resourceId:route,metadata:{route} } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt < 3 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2034','P2002'].includes(error.code)) continue;
      throw error;
    }
  }
  throw new ApiError(409,'CONCURRENT_CHANGE','Please retry after the concurrent change.');
}

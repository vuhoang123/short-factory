import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PrismaClient, Role } from '@shorts-factory/database';
import { ApiError, notFound } from '../errors.js';
import { authSchema, registerSchema, switchWorkspaceSchema, workspaceSchema, memberSchema, paginationSchema } from '../validation.js';
import { hashPassword, verifyPassword } from './password.js';
import { mutationIdentity } from '../idempotency.js';

export interface AuthContext {
  sessionId: string;
  userId: string;
  workspaceId: string;
  role: Role;
}

const cookieName = 'sf_session';
const adminRoles: readonly Role[] = ['OWNER', 'ADMIN'];
export const editRoles: readonly Role[] = ['OWNER', 'ADMIN', 'EDITOR'];
export const reviewRoles: readonly Role[] = ['OWNER', 'ADMIN', 'REVIEWER'];
export { adminRoles };

export class AuthService {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(readonly db: PrismaClient) {}

  private limit(request: Request) {
    const key = request.ip ?? 'local';
    const now = Date.now();
    const old = this.attempts.get(key);
    const entry = !old || old.resetAt < now ? { count: 0, resetAt: now + 15 * 60_000 } : old;
    entry.count += 1;
    this.attempts.set(key, entry);
    if (this.attempts.size > 5000) for (const [ip, state] of this.attempts) if (state.resetAt < now) this.attempts.delete(ip);
    if (entry.count > Number(process.env.AUTH_ATTEMPTS_PER_WINDOW ?? '30')) throw new ApiError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again later.');
  }

  async register(request: Request, response: Response, raw: unknown) {
    if (process.env.ALLOW_REGISTRATION === 'false' || (process.env.NODE_ENV === 'production' && process.env.ALLOW_REGISTRATION !== 'true')) throw new ApiError(403, 'REGISTRATION_DISABLED', 'Registration is disabled. Contact the workspace administrator.');
    this.limit(request);
    const input = registerSchema.parse(raw);
    const passwordHash = await hashPassword(input.password);
    const user = await this.db.user.create({ data: { email: input.email, passwordHash, ...(input.name ? { name: input.name } : {}) }, select: { id: true, email: true, name: true } });
    await this.issueSession(user.id, response);
    return { user };
  }

  async login(request: Request, response: Response, raw: unknown) {
    this.limit(request);
    const input = authSchema.parse(raw);
    const user = await this.db.user.findUnique({ where: { email: input.email } });
    const dummy = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? dummy);
    if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    await this.issueSession(user.id, response);
    return { user: { id: user.id, email: user.email, name: user.name } };
  }

  private async issueSession(userId: string, response: Response) {
    const token = randomBytes(32).toString('base64url');
    const membership = await this.db.workspaceMember.findFirst({ where: { userId }, orderBy: { workspaceId: 'asc' } });
    const ttl = Number(process.env.SESSION_TTL_SECONDS ?? '604800');
    await this.db.session.create({ data: { userId, tokenHash: createHash('sha256').update(token).digest('hex'), activeWorkspaceId: membership?.workspaceId ?? null, expiresAt: new Date(Date.now() + ttl * 1000) } });
    response.cookie(cookieName, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ttl * 1000 });
  }

  async session(request: Request) {
    const authorization = request.header('authorization');
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const token = bearer ?? cookie;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const allowedOrigin = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;
      if (request.header('origin') !== allowedOrigin) throw new ApiError(403, 'CSRF_REJECTED', 'The request origin is not allowed.');
    }
    const session = await this.db.session.findUnique({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } });
    if (!session || session.expiresAt.getTime() <= Date.now()) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.');
    return session;
  }

  async context(request: Request, roles?: readonly Role[]): Promise<AuthContext> {
    const session = await this.session(request);
    if (!session.activeWorkspaceId) throw new ApiError(403, 'WORKSPACE_REQUIRED', 'Create or select a workspace first.');
    const member = await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: session.activeWorkspaceId, userId: session.userId } } });
    if (!member || (roles && !roles.includes(member.role))) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action.');
    return { sessionId: session.id, userId: session.userId, workspaceId: member.workspaceId, role: member.role };
  }

  assertWorkspace(context: AuthContext, supplied?: string) {
    if (supplied && supplied !== context.workspaceId) throw new ApiError(403, 'WORKSPACE_MISMATCH', 'The requested workspace is not your active workspace.');
  }

  async me(request: Request) {
    const session = await this.session(request);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { id: true, email: true, name: true } });
    const memberships = await this.db.workspaceMember.findMany({ where: { userId: user.id }, include: { workspace: { select: { id: true, name: true } } }, orderBy: { workspaceId: 'asc' } });
    return { user, activeWorkspaceId: session.activeWorkspaceId, workspaces: memberships.map((member) => ({ ...member.workspace, role: member.role })) };
  }

  async logout(request: Request, response: Response) {
    const session = await this.session(request);
    await this.db.session.delete({ where: { id: session.id } });
    response.clearCookie(cookieName, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    return { signedOut: true };
  }

  async switchWorkspace(request: Request, raw: unknown) {
    const session = await this.session(request);
    const input = switchWorkspaceSchema.parse(raw);
    const membership = await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: session.userId } } });
    if (!membership) throw new ApiError(403, 'FORBIDDEN', 'You are not a member of that workspace.');
    await this.db.session.update({ where: { id: session.id }, data: { activeWorkspaceId: membership.workspaceId } });
    return { activeWorkspaceId: membership.workspaceId };
  }

  async createWorkspace(request: Request, raw: unknown) {
    const session = await this.session(request);
    const input = workspaceSchema.parse(raw);
    const { key, requestHash } = mutationIdentity(request, input);
    return this.db.$transaction(async (tx) => {
      // A user can create the first workspace before there is a tenant to scope the operation to.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${session.userId}, 0))`;
      const old = await tx.idempotencyRecord.findFirst({ where: { userId: session.userId, route: '/workspaces', key } });
      if (old) {
        if (old.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
        return old.response;
      }
      const workspace = await tx.workspace.create({ data: { ...input, members: { create: { userId: session.userId, role: 'OWNER' } } } });
      await tx.session.update({ where: { id: session.id }, data: { activeWorkspaceId: workspace.id } });
      await tx.auditLog.create({ data: { workspaceId: workspace.id, actorId: session.userId, action: 'WORKSPACE_CREATED', resourceType: 'Workspace', resourceId: workspace.id } });
      const response = { id: workspace.id, name: workspace.name, slug: workspace.slug, timezone: workspace.timezone };
      await tx.idempotencyRecord.create({ data: { workspaceId: workspace.id, userId: session.userId, route: '/workspaces', key, requestHash, response, statusCode: 201 } });
      return response;
    });
  }

  async getWorkspace(request: Request, id: string) {
    const session = await this.session(request);
    const membership = await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId: session.userId } }, include: { workspace: true } });
    if (!membership) return notFound();
    return { ...membership.workspace, role: membership.role };
  }

  async addMember(request: Request, workspaceId: string, raw: unknown) {
    const context = await this.context(request, adminRoles);
    this.assertWorkspace(context, workspaceId);
    const input = memberSchema.parse(raw);
    const { key, requestHash } = mutationIdentity(request, input);
    const user = await this.db.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (!user) throw new ApiError(400, 'MEMBER_NOT_REGISTERED', 'The member must register before being added.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`;
      const currentActor = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: context.userId } } });
      if (!currentActor || !adminRoles.includes(currentActor.role)) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action.');
      const route = `/workspaces/${workspaceId}/members`;
      const old = await tx.idempotencyRecord.findUnique({ where: { workspaceId_userId_route_key: { workspaceId, userId: context.userId, route, key } } });
      if (old) {
        if (old.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
        return old.response;
      }
      const existing = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
      if (existing?.role === 'OWNER') throw new ApiError(403, 'OWNER_PROTECTED', 'Owner membership cannot be changed by this endpoint.');
      const membership = await tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId, userId: user.id } }, create: { workspaceId, userId: user.id, role: input.role }, update: { role: input.role } });
      await tx.auditLog.create({ data: { workspaceId, actorId: context.userId, action: 'MEMBERSHIP_CHANGED', resourceType: 'WorkspaceMember', resourceId: user.id, metadata: { role: input.role } } });
      await tx.idempotencyRecord.create({ data: { workspaceId, userId: context.userId, route, key, requestHash, response: membership, statusCode: 201 } });
      return membership;
    });
  }

  async members(request: Request, workspaceId: string, raw: unknown) {
    const context = await this.context(request, adminRoles);
    this.assertWorkspace(context, workspaceId);
    const page = paginationSchema.parse(raw);
    if (page.cursor && !await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: page.cursor } } })) return notFound();
    const members = await this.db.workspaceMember.findMany({ where: { workspaceId }, orderBy: { userId: 'asc' }, take: page.limit + 1, include: { user: { select: { email: true, name: true } } }, ...(page.cursor ? { cursor: { workspaceId_userId: { workspaceId, userId: page.cursor } }, skip: 1 } : {}) });
    await this.db.auditLog.create({ data: { workspaceId, actorId: context.userId, action: 'MEMBERS_READ', resourceType: 'Workspace', resourceId: workspaceId } });
    return { items: members.slice(0, page.limit).map((member) => ({ userId: member.userId, email: member.user.email, name: member.user.name, role: member.role })), nextCursor: members.length > page.limit ? members[page.limit - 1]?.userId ?? null : null };
  }
}

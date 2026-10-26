import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Body, Catch, Controller, Delete, ExceptionFilter, Get, HttpException, Inject, Module, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiCookieAuth, ApiTags, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Prisma, PrismaClient } from '@shorts-factory/database';
import { z, ZodError } from 'zod';
import { AuthService } from './auth/auth.service.js';
import { ContentService } from './content.service.js';
import { DiscoveryService } from './discovery.service.js';
import { ApiError } from './errors.js';

const AUTH = Symbol('AuthService');
const CONTENT = Symbol('ContentService');
const DISCOVERY = Symbol('DiscoveryService');
const DATABASE = Symbol('Database');
type ApiRequest = Request & { requestId: string };

@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<ApiRequest>();
    let status = 500;
    let body: Record<string, unknown> = { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' };
    if (error instanceof ZodError) {
      status = 400;
      body = { code: 'VALIDATION_ERROR', message: 'The request is invalid.', details: { issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } };
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      const detail = error.getResponse();
      const fallbackCode = status === 400 ? 'VALIDATION_ERROR' : status === 404 ? 'NOT_FOUND' : status === 413 ? 'REQUEST_TOO_LARGE' : 'HTTP_ERROR';
      const fallbackMessage = status === 400 ? 'The request is invalid.' : status === 404 ? 'Resource not found.' : status === 413 ? 'The request exceeds the configured size limit.' : 'The request could not be completed.';
      body = typeof detail === 'object' && detail && 'code' in detail ? detail as Record<string, unknown> : { code: fallbackCode, message: fallbackMessage };
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003', 'P2025', 'P2034'].includes(error.code)) {
      status = error.code === 'P2025' ? 404 : 409;
      body = { code: error.code === 'P2002' ? 'CONFLICT' : error.code === 'P2003' ? 'INVALID_RELATION' : error.code === 'P2025' ? 'NOT_FOUND' : 'CONCURRENT_CHANGE', message: 'The resource is unavailable or conflicts with existing data.' };
    } else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
      status = 413;
      body = { code: 'REQUEST_TOO_LARGE', message: 'The request exceeds the configured size limit.' };
    } else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'VALIDATION_ERROR', message: 'Send valid JSON.' };
    }
    if (status >= 500) process.stderr.write(`${JSON.stringify({ level: 'error', requestId: request.requestId, code: body.code })}\n`);
    response.status(status).json({ ...body, requestId: request.requestId });
  }
}

@ApiTags('identity')
@ApiCookieAuth('sf_session')
@Controller('api/v1')
class IdentityController {
  constructor(@Inject(AUTH) private readonly auth: AuthService) {}

  @Post('auth/register') register(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) { return this.auth.register(request, response, body); }
  @Post('auth/login') login(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) { return this.auth.login(request, response, body); }
  @Post('auth/logout') logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) { return this.auth.logout(request, response); }
  @Get('auth/me') me(@Req() request: Request) { return this.auth.me(request); }
  @Post('auth/workspace') switchWorkspace(@Req() request: Request, @Body() body: unknown) { return this.auth.switchWorkspace(request, body); }
  @Post('workspaces') createWorkspace(@Req() request: Request, @Body() body: unknown) { return this.auth.createWorkspace(request, body); }
  @Get('workspaces/:id') workspace(@Req() request: Request, @Param('id') id: string) { z.string().uuid().parse(id); return this.auth.getWorkspace(request, id); }
  @Post('workspaces/:id/members') member(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) { z.string().uuid().parse(id); return this.auth.addMember(request, id, body); }
  @Get('workspaces/:id/members') members(@Req() request: Request, @Param('id') id: string, @Query() query: unknown) { z.string().uuid().parse(id); return this.auth.members(request, id, query); }
}

@ApiTags('manual-content')
@ApiCookieAuth('sf_session')
@Controller('api/v1')
class ContentController {
  constructor(@Inject(CONTENT) private readonly content: ContentService, @Inject(DISCOVERY) private readonly discovery: DiscoveryService) {}

  @Get('channels') channels(@Req() request: Request, @Query() query: unknown) { return this.content.channels(request, query); }
  @Post('channels') createChannel(@Req() request: Request, @Body() body: unknown) { return this.content.createChannel(request, body); }
  @Get('sources') sources(@Req() request: Request, @Query() query: unknown) { return this.content.sources(request, query); }
  @Post('sources') createSource(@Req() request: Request, @Body() body: unknown) { return this.content.createSource(request, body); }
  @Patch('sources/:id') updateSource(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) { z.string().uuid().parse(id); return this.discovery.updateSource(request, id, body); }
  @Delete('sources/:id') deleteSource(@Req() request: Request, @Param('id') id: string) { z.string().uuid().parse(id); return this.discovery.deleteSource(request, id); }
  @Post('sources/:id/verify') verifySource(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) { z.string().uuid().parse(id); return this.discovery.verifySource(request, id, body); }
  @Post('sources/:id/sync') syncSource(@Req() request: Request, @Param('id') id: string) { z.string().uuid().parse(id); return this.discovery.syncSource(request, id); }
  @Get('sources/:id/sync-runs') syncRuns(@Req() request: Request, @Param('id') id: string, @Query() query: unknown) { z.string().uuid().parse(id); return this.discovery.syncRuns(request, id, query); }
  @Get('topic-rules') topicRules(@Req() request: Request, @Query() query: unknown) { return this.discovery.topicRules(request, query); }
  @Post('topic-rules') createTopicRule(@Req() request: Request, @Body() body: unknown) { return this.discovery.createTopicRule(request, body); }
  @Patch('topic-rules/:id') updateTopicRule(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) { z.string().uuid().parse(id); return this.discovery.updateTopicRule(request, id, body); }
  @Delete('topic-rules/:id') deleteTopicRule(@Req() request: Request, @Param('id') id: string) { z.string().uuid().parse(id); return this.discovery.deleteTopicRule(request, id); }
  @Get('candidates') candidates(@Req() request: Request, @Query() query: unknown) { return this.discovery.candidates(request, query); }
  @Post('candidates/:id/review') reviewCandidate(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) { z.string().uuid().parse(id); return this.discovery.reviewCandidate(request, id, body); }
  @Post('imports/manual') import(@Req() request: Request, @Body() body: unknown) { return this.content.importManual(request, body); }
  @Get('posts') posts(@Req() request: Request, @Query() query: unknown) { return this.content.posts(request, query); }
  @Get('posts/:id') post(@Req() request: Request, @Param('id') id: string) { z.string().uuid().parse(id); return this.content.post(request, id); }
  @Get('posts/:id/comments') comments(@Req() request: Request, @Param('id') id: string, @Query() query: unknown) { z.string().uuid().parse(id); return this.content.comments(request, id, query); }
  @Get('posts/:id/eligibility') eligibility(@Req() request: Request, @Param('id') id: string, @Query() query: unknown) { z.string().uuid().parse(id); return this.content.eligibility(request, id, query); }
  @Post('posts/:id/rights/review') review(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) { z.string().uuid().parse(id); return this.content.review(request, id, body); }
  @Post('takedowns') takedown(@Req() request: Request, @Body() body: unknown) { return this.content.takedown(request, body); }
  @Get('dashboard') dashboard(@Req() request: Request) { return this.content.dashboard(request); }
  @Get('audit-logs') auditLogs(@Req() request: Request, @Query() query: unknown) { return this.content.auditLogs(request, query); }
  @Post('publications') publications(@Req() request: Request, @Body() body: unknown) { return this.content.publications(request, body); }
}

@Controller('api/v1')
class HealthController {
  constructor(@Inject(DATABASE) private readonly database: PrismaClient) {}
  @Get('health') async health() {
    try { await this.database.$queryRaw`SELECT 1`; }
    catch { throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.'); }
    return { status: 'ok', database: 'ok', phase: 'PHASE_2', integrations: 'synthetic-demo-and-manual-only' };
  }
}

@Module({})
class AppModule {}

export async function createApp(database = new PrismaClient()) {
  const config = z.object({ APP_URL: z.string().url().default('http://localhost:3000'), ALLOW_REGISTRATION: z.enum(['true', 'false']).default(process.env.NODE_ENV === 'production' ? 'false' : 'true'), SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(31536000).default(604800), AUTH_ATTEMPTS_PER_WINDOW: z.coerce.number().int().min(1).max(10000).default(30), IMPORT_MAX_BYTES: z.coerce.number().int().min(1024).max(10485760).default(262144) }).parse(process.env);
  const auth = new AuthService(database);
  const content = new ContentService(database, auth);
  const discovery = new DiscoveryService(database, auth);
  const app = await NestFactory.create({ module: AppModule, controllers: [IdentityController, ContentController, HealthController], providers: [{ provide: DATABASE, useValue: database }, { provide: AUTH, useValue: auth }, { provide: CONTENT, useValue: content }, { provide: DISCOVERY, useValue: discovery }, { provide: 'DATABASE_LIFECYCLE', useValue: { onApplicationShutdown: () => database.$disconnect() } }] }, { logger: false, bodyParser: false });
  app.use((request: ApiRequest, response: Response, next: NextFunction) => {
    request.requestId = randomUUID();
    response.setHeader('X-Request-ID', request.requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const origin = request.header('origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin && origin !== new URL(config.APP_URL).origin) return next(new ApiError(403, 'CSRF_REJECTED', 'The request origin is not allowed.'));
    next();
  });
  app.use(express.json({ limit: config.IMPORT_MAX_BYTES, strict: true }));
  app.useGlobalFilters(new ErrorFilter());
  if (process.env.NODE_ENV !== 'production') {
    const openapi = new DocumentBuilder().setTitle('Shorts Factory').setVersion('1.0.0').setDescription('Phase 2 content discovery API. Workspace context is derived from authenticated membership. Mutations require Idempotency-Key; publishing remains blocked.').addCookieAuth('sf_session').addBearerAuth().build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openapi));
  }
  await app.init();
  return app;
}

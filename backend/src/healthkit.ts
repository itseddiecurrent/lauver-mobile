import type { Express } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AuthServicing } from './auth.js';
import { authenticated } from './profile-routes.js';

const workoutSchema = z.object({
  id: z.uuid(), sport: z.string().trim().min(1).max(80),
  startedAt: z.iso.datetime({ offset: true }), endedAt: z.iso.datetime({ offset: true }),
  durationSeconds: z.number().int().min(0).max(31_536_000), distanceMeters: z.number().finite().nonnegative().nullable().optional(),
}).strict();
const importSchema = z.object({ workouts: z.array(workoutSchema).max(100) }).strict();

export class HealthKitService {
  constructor(private readonly client: PrismaClient) {}
  async import(userId: string, workouts: z.infer<typeof workoutSchema>[]): Promise<number> {
    for (const workout of workouts) await this.client.healthWorkout.upsert({
      where: { userId_workoutUUID: { userId, workoutUUID: workout.id } },
      create: { userId, workoutUUID: workout.id, sport: workout.sport, startedAt: workout.startedAt, endedAt: workout.endedAt, durationSeconds: workout.durationSeconds, distanceMeters: workout.distanceMeters ?? null },
      update: { sport: workout.sport, startedAt: workout.startedAt, endedAt: workout.endedAt, durationSeconds: workout.durationSeconds, distanceMeters: workout.distanceMeters ?? null },
    });
    return workouts.length;
  }
  async list(userId: string) { return this.client.healthWorkout.findMany({ where: { userId }, orderBy: [{ startedAt: 'desc' }, { workoutUUID: 'desc' }], take: 100, select: { workoutUUID: true, sport: true, startedAt: true, endedAt: true, durationSeconds: true, distanceMeters: true } }); }
  async delete(userId: string) { await this.client.healthWorkout.deleteMany({ where: { userId } }); }
}

export function installHealthKitRoutes(app: Express, deps: { authService: AuthServicing; service: HealthKitService }): void {
  const base = '/v1/integrations/healthkit';
  app.get(`${base}/workouts`, authenticated(deps.authService, async (user, _request, response) => { response.status(200).json({ workouts: await deps.service.list(user.id) }); }));
  app.post(`${base}/workouts`, authenticated(deps.authService, async (user, request, response) => {
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) {
      const fields = parsed.error.issues.map(issue => `${issue.path.join('.') || 'workouts'}: ${issue.message}`).join('; ');
      response.status(422).json({ code: 'validation_failed', message: `Workout summaries are invalid (${fields}).` });
      return;
    }
    const imported = await deps.service.import(user.id, parsed.data.workouts);
    response.status(200).json({ imported });
  }));
  app.delete(`${base}/workouts`, authenticated(deps.authService, async (user, _request, response) => { await deps.service.delete(user.id); response.status(204).send(); }));
}
